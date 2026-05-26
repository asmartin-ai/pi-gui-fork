import { spawn, execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const strictFocusGuard = process.env.PI_GUI_COMPUTER_USE_STRICT_FOCUS_GUARD === "1";
const allowTextEditTakeover = process.env.PI_GUI_COMPUTER_USE_ALLOW_TEXTEDIT_TAKEOVER === "1";

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
await assertTargetDidNotBecomeFrontmost("launch Calculator in background", frontmostBefore, "Calculator");

await runWithFocusGuard({ command: "get_app_state", app: "Calculator" }, "get_app_state");

for (const key of ["kp_clear", "kp_clear", "7", "plus", "8", "kp_equal"]) {
  await runWithFocusGuard({ command: "press_key", app: "Calculator", key }, `press_key ${key}`);
}

const finalState = await runWithFocusGuard({ command: "get_app_state", app: "Calculator" }, "final get_app_state");
const finalText = finalState.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") ?? "";
if (!calculatorDisplays(finalText, "15")) {
  throw new Error("Calculator did not expose result 15 after 7 + 8.");
}

await runTextEditTypingProbe();

console.log(
  `COMPUTER_USE_BACKGROUND_E2E_OK target=Calculator,TextEdit frontmost=${frontmostBefore} result=15 textedit="Alpha Beta" helper=${helperPath}`,
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
  await assertTargetDidNotBecomeFrontmost(action, before, request.app);
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

async function runTextEditTypingProbe() {
  const textEditWasRunning = await isTextEditRunning();
  if (textEditWasRunning && !allowTextEditTakeover) {
    throw new Error(
      "TextEdit is already running; close it before this probe, or set PI_GUI_COMPUTER_USE_ALLOW_TEXTEDIT_TAKEOVER=1 to allow the probe to quit it without saving.",
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "pi-gui-computer-use-textedit-"));
  const documentPath = path.join(tempDir, "background-typing.txt");
  await writeFile(documentPath, "Alpha", "utf8");

  try {
    if (textEditWasRunning) {
      await quitTextEditWithoutSaving();
      await sleep(500);
    }
    await activateFinder();
    const before = await frontmostApp();
    if (before === "TextEdit") {
      throw new Error("Could not put a non-target app in front before the TextEdit probe.");
    }

    await execFileAsync("open", ["-g", "-a", "TextEdit", documentPath]);
    await waitForApp("TextEdit");
    await assertTargetDidNotBecomeFrontmost("launch TextEdit in background", before, "TextEdit");

    const initialState = await runWithFocusGuard({ command: "get_app_state", app: "TextEdit" }, "TextEdit get_app_state");
    const initialText = stateText(initialState);
    const textElementIndex = findEditableTextElementIndex(initialText, "Alpha");
    await runWithFocusGuard(
      {
        command: "select_text",
        app: "TextEdit",
        element_index: textElementIndex,
        text: "Alpha",
        selection: "cursor_after",
      },
      "TextEdit select_text",
    );
    const finalState = await runWithFocusGuard(
      { command: "type_text", app: "TextEdit", element_index: textElementIndex, text: " Beta" },
      "TextEdit type_text",
    );
    if (!stateText(finalState).includes("Alpha Beta")) {
      throw new Error("TextEdit did not expose typed background text Alpha Beta.");
    }
  } finally {
    await quitTextEditWithoutSaving();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function isTextEditRunning() {
  const { stdout } = await execFileAsync("osascript", ["-e", 'application "TextEdit" is running']);
  return stdout.trim() === "true";
}

async function quitTextEditWithoutSaving() {
  await execFileAsync("osascript", [
    "-e",
    'if application "TextEdit" is running then tell application "TextEdit" to quit saving no',
  ]);
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

async function assertTargetDidNotBecomeFrontmost(action, expected, targetApp) {
  const actual = await frontmostApp();
  if (actual === targetApp) {
    throw new Error(`${action} moved target app ${targetApp} to the front.`);
  }
  if (strictFocusGuard && actual !== expected) {
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

function stateText(response) {
  return response.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") ?? "";
}

function findEditableTextElementIndex(text, expectedValue) {
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(text field|text area|combo box)\b.*Value:\s*(.*)$/i);
    if (match && match[3].includes(expectedValue)) {
      return match[1];
    }
  }
  throw new Error(`Could not find editable text element containing ${expectedValue}.`);
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
