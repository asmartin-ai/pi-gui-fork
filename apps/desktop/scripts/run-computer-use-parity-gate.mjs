import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "..", "..");

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main() {
  console.log("COMPUTER_USE_PARITY_GATE_STEP desktop-unlocked-preflight");
  await assertDesktopUnlockedForBackgroundProbe();

  await runStep("build", "pnpm", ["run", "build"], {
    cwd: desktopDir,
  });

  await runStep("extension-failure-shaping", process.execPath, [
    "packages/computer-use-extension/scripts/test-locked-failure.mjs",
  ], {
    cwd: repoDir,
  });

  await runStep(
    "timeline-failure-ui",
    "pnpm",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/core/review-ux.spec.ts",
      "-g",
      "Computer Use",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  await runStep("package", "pnpm", ["exec", "electron-builder", "--mac", "--dir"], {
    cwd: desktopDir,
  });

  await runStep(
    "packaged-playwright",
    "pnpm",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/production/packaged-computer-use.spec.ts",
      "apps/desktop/tests/production/packaged-computer-use-extension-surface.spec.ts",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  await runStep("background-probe", process.execPath, ["scripts/computer-use-background-probe.mjs", "--packaged"], {
    cwd: desktopDir,
    env: {
      ...process.env,
      PI_GUI_COMPUTER_USE_STRICT_FOCUS_GUARD: "1",
    },
  });

  console.log(
    "COMPUTER_USE_PARITY_GATE_OK packaged-helper-extension-locked-use-extension-surface-failure-timeline-background-cursor",
  );
}

async function assertDesktopUnlockedForBackgroundProbe() {
  if (process.platform !== "darwin") {
    return;
  }

  let stdout = "";
  try {
    stdout = await capture("ioreg", ["-n", "Root", "-d1"], { cwd: desktopDir });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not preflight macOS lock state before the Computer Use background probe: ${detail}`);
    return;
  }

  if (/"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(stdout) || /"IOConsoleLocked"\s*=\s*Yes/.test(stdout)) {
    throw new Error(
      [
        "Computer Use parity gate requires an unlocked desktop for the real background cursor/focus probe.",
        "Packaged helper, extension, locked-use, and @ extension surface checks can still run while locked via test:prod:packaged-computer-use.",
        "Unlock the desktop before running test:prod:packaged-computer-use-parity.",
      ].join("\n"),
    );
  }
}

async function runStep(name, command, args, options) {
  console.log(`COMPUTER_USE_PARITY_GATE_STEP ${name}`);
  await run(command, args, options);
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const exitDetail = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} failed with ${exitDetail}.`));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const exitDetail = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${exitDetail}.`));
    });
  });
}
