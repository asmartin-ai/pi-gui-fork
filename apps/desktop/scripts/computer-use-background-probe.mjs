import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const defaultHelperPath = path.join(desktopDir, "build", "native", "pi-gui-computer-use-helper");
const installedHelperPath = "/Applications/pi-gui.app/Contents/MacOS/pi-gui-computer-use-helper";
const helperPath = process.argv[2] ?? (await firstExistingPath([defaultHelperPath, installedHelperPath]));
const configuredHelperTimeoutMs = Number.parseInt(process.env.PI_GUI_COMPUTER_USE_PROBE_TIMEOUT_MS ?? "", 10);
const helperTimeoutMs =
  Number.isFinite(configuredHelperTimeoutMs) && configuredHelperTimeoutMs > 0 ? configuredHelperTimeoutMs : 15_000;

await access(helperPath);
await execFileAsync("osascript", ["-e", 'if application "Calculator" is running then tell application "Calculator" to quit']);
await sleep(500);
await activateFinder();

const frontmostBefore = await frontmostApp();
if (frontmostBefore === "Calculator") {
  throw new Error("Could not put a non-target app in front before the Computer Use probe.");
}

await execFileAsync("open", ["-g", "-a", "Calculator"]);
await waitForApp("Calculator");
await assertFrontmostUnchanged("launch Calculator in background", frontmostBefore);

await runWithFocusGuard({ command: "get_app_state", app: "Calculator" }, "get_app_state");

for (const key of ["kp_clear", "kp_clear", "7", "plus", "8", "kp_equal"]) {
  await runWithFocusGuard({ command: "press_key", app: "Calculator", key }, `press_key ${key}`);
}

const finalState = await runWithFocusGuard({ command: "get_app_state", app: "Calculator" }, "final get_app_state");
const finalText = finalState.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") ?? "";
if (!calculatorDisplays(finalText, "15")) {
  throw new Error("Calculator did not expose result 15 after 7 + 8.");
}

console.log(
  `COMPUTER_USE_BACKGROUND_E2E_OK target=Calculator frontmost=${frontmostBefore} result=15 helper=${helperPath}`,
);

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return paths[0];
}

async function activateFinder() {
  await execFileAsync("osascript", ["-e", 'tell application "Finder" to activate']);
  await sleep(300);
}

async function runWithFocusGuard(request, action) {
  await activateFinder();
  const before = await frontmostApp();
  if (before === request.app) {
    throw new Error(`Could not put a non-target app in front before ${action}.`);
  }
  const response = await runHelper(request);
  await assertFrontmostUnchanged(action, before);
  return response;
}

async function waitForApp(appName) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const apps = await listApps();
    if (apps.some((line) => line.startsWith(`${appName} — `) && line.includes("running]"))) {
      return;
    }
    await sleep(150);
  }
  await throwIfLocked(appName);
  throw new Error(`${appName} did not appear as running in Computer Use list_apps output.`);
}

async function throwIfLocked(appName) {
  try {
    await runHelper({ command: "get_app_state", app: appName });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Computer Use is unavailable while the Mac is locked")) {
      throw new Error(message);
    }
  }
}

async function frontmostApp() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'tell application "System Events" to name of first application process whose frontmost is true',
  ]);
  const appName = stdout.trim();
  if (!appName) {
    throw new Error("Could not determine the frontmost app from System Events.");
  }
  return appName;
}

async function assertFrontmostUnchanged(action, expected) {
  const actual = await frontmostApp();
  if (actual !== expected) {
    throw new Error(`${action} changed frontmost app from ${expected} to ${actual}.`);
  }
}

async function listApps() {
  const response = await runHelper({ command: "list_apps" });
  const text = response.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("list_apps returned no text content.");
  }
  return text.split("\n").filter(Boolean);
}

function runHelper(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], {
      env: { ...process.env, PI_GUI_COMPUTER_USE_SHOW_CURSOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Computer Use helper timed out after ${helperTimeoutMs}ms for ${request.command}.`));
    }, helperTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      try {
        const response = JSON.parse(stdout);
        if (!response.ok) {
          finish(new Error(response.error ?? "Computer Use helper failed."));
          return;
        }
        finish(null, response);
      } catch (error) {
        if (code !== 0) {
          finish(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
          return;
        }
        finish(error);
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function calculatorDisplays(stateText, expected) {
  const valuePattern = new RegExp(`(^|[^0-9])${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.0)?([^0-9]|$)`);
  return stateText
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\s+/, ""))
    .some((line) => {
      const lower = line.toLowerCase();
      return (
        !lower.includes("button") &&
        /value|description|display|result|text/.test(lower) &&
        valuePattern.test(line)
      );
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
