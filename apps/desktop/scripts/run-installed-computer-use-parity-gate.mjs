import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "..", "..");
const installedAppBundle = "/Applications/pi-gui.app";
const realAuthEnvVar = "PI_APP_REAL_AUTH";
const realAuthSourceDirEnvVar = "PI_APP_REAL_AUTH_SOURCE_DIR";

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main() {
  console.log("COMPUTER_USE_INSTALLED_PARITY_GATE_STEP installed-app-preflight");
  await access(installedAppBundle);

  console.log("COMPUTER_USE_INSTALLED_PARITY_GATE_STEP desktop-state-preflight");
  const initialLockState = await desktopLockStateForInstalledLive();
  if (initialLockState.locked) {
    console.warn(
      "Installed Computer Use parity gate detected a locked desktop; installed-app checks will run, then the live background cursor/focus E2E will stop until the desktop is unlocked or Locked Computer Use is enabled.",
    );
  }

  await runPnpmStep("build", ["run", "build"], {
    cwd: desktopDir,
  });

  await runStep("extension-failure-shaping", process.execPath, [
    "packages/computer-use-extension/scripts/test-locked-failure.mjs",
  ], {
    cwd: repoDir,
  });

  await runPnpmStep(
    "timeline-failure-ui",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/core/computer-use-timeline-failures.spec.ts",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  await runPnpmStep(
    "installed-extension-surface",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/production/installed-computer-use-extension-surface.spec.ts",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  await runPnpmStep(
    "installed-locked-use-self-test",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/production/installed-computer-use-locked-use-self-test.spec.ts",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  const lockedReadiness = await runInstalledLockedReadinessStatus();

  const liveLockState = await desktopLockStateForInstalledLive();
  if (liveLockState.locked && !lockedReadiness.ready) {
    throw lockedDesktopForInstalledLiveError();
  }

  await assertRealAuthReadyForInstalledLive();

  await runPnpmStep(
    "installed-live-background-cursor",
    [
      "--dir",
      repoDir,
      "exec",
      "playwright",
      "test",
      "-c",
      "apps/desktop/playwright.config.ts",
      "apps/desktop/tests/production/installed-computer-use-live.spec.ts",
    ],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PI_APP_TEST_MODE: "background",
      },
    },
  );

  console.log(
    "COMPUTER_USE_INSTALLED_PARITY_GATE_OK installed-extension-surface-failure-timeline-locked-use-live-background-cursor",
  );
}

async function runPnpmStep(name, args, options) {
  const invocation = pnpmInvocation(args);
  await runStep(name, invocation.command, invocation.args, options);
}

async function runInstalledLockedReadinessStatus() {
  console.log("COMPUTER_USE_INSTALLED_PARITY_GATE_STEP installed-locked-readiness-status");
  const stdout = await capture(
    process.execPath,
    ["scripts/computer-use-locked-readiness.mjs", "--installed", "--allow-not-enabled"],
    {
      cwd: desktopDir,
    },
  );
  process.stdout.write(stdout);
  return {
    ready: /\bCOMPUTER_USE_LOCKED_READINESS_OK\b/.test(stdout),
  };
}

function pnpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath ?? "";
  if (npmExecPath.includes("pnpm")) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }
  return { command: "npx", args: ["pnpm", ...args] };
}

async function desktopLockStateForInstalledLive() {
  if (process.platform !== "darwin") {
    console.log("COMPUTER_USE_INSTALLED_PARITY_GATE_DESKTOP_STATE state=not-darwin");
    return { locked: false };
  }

  let stdout = "";
  try {
    stdout = await capture("ioreg", ["-n", "Root", "-d1"], { cwd: desktopDir });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not preflight macOS lock state before installed Computer Use live E2E: ${detail}`);
    console.log("COMPUTER_USE_INSTALLED_PARITY_GATE_DESKTOP_STATE state=unknown");
    return { locked: false };
  }

  const locked = /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(stdout) || /"IOConsoleLocked"\s*=\s*Yes/.test(stdout);
  console.log(`COMPUTER_USE_INSTALLED_PARITY_GATE_DESKTOP_STATE state=${locked ? "locked" : "unlocked"}`);
  return { locked };
}

function lockedDesktopForInstalledLiveError() {
  return new Error(
    [
      "COMPUTER_USE_INSTALLED_PARITY_GATE_BLOCKED desktop=locked reason=installed-live-requires-unlocked-or-locked-use-enabled",
      "Installed Computer Use parity requires a real installed-app live background cursor/focus E2E.",
      "Installed-app checks completed before the blocked live E2E: extension failure shaping, timeline failure UI, top-level @ extension surface, locked-use active-turn self-test, and locked-readiness status.",
      "Unlock the desktop or enable Locked Computer Use in pi-gui Settings > Computer Use, then rerun test:prod:installed-computer-use-parity.",
    ].join("\n"),
  );
}

async function assertRealAuthReadyForInstalledLive() {
  if (process.env[realAuthEnvVar] !== "1") {
    throw realAuthBlockedError(`Set ${realAuthEnvVar}=1 and ${realAuthSourceDirEnvVar}=/absolute/path/to/agent.`);
  }

  const rawSourceDir = process.env[realAuthSourceDirEnvVar]?.trim();
  if (!rawSourceDir) {
    throw realAuthBlockedError(`Set ${realAuthSourceDirEnvVar}=/absolute/path/to/agent when ${realAuthEnvVar}=1.`);
  }

  const authPath = path.join(path.resolve(rawSourceDir), "auth.json");
  try {
    await access(authPath);
  } catch {
    throw realAuthBlockedError(`Real-auth source dir is missing required file auth.json: ${authPath}.`);
  }
}

function realAuthBlockedError(detail) {
  return new Error(
    [
      "COMPUTER_USE_INSTALLED_PARITY_GATE_BLOCKED real_auth=not_enabled reason=installed-live-requires-real-auth",
      "Installed Computer Use parity cannot pass by skipping the real live background cursor/focus E2E.",
      detail,
      "Rerun test:prod:installed-computer-use-parity with real auth after the installed preconditions are available.",
    ].join("\n"),
  );
}

async function runStep(name, command, args, options) {
  console.log(`COMPUTER_USE_INSTALLED_PARITY_GATE_STEP ${name}`);
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
