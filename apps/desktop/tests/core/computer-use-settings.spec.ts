import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

async function readSettingsLog(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

test("shows Computer Use permission and locked-use status in Settings", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("computer-use-settings-workspace");
  const settingsLogPath = join(userDataDir, "computer-use-settings.log");
  const status = {
    helperAvailable: true,
    helperPath: "/Applications/pi-gui.app/Contents/SharedSupport/pi-gui Computer Use.app/Contents/MacOS/pi-gui-computer-use-helper",
    desktop: "locked",
    accessibility: "denied",
    screenRecording: "granted",
    lockedUse: "not_enabled",
    message: "Locked Computer Use requires a guarded macOS authorization plug-in.",
  };
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_COMPUTER_USE_SETTINGS_LOG_PATH: settingsLogPath,
      PI_APP_TEST_COMPUTER_USE_STATUS_JSON: JSON.stringify(status),
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Computer Use", exact: true }).click();

    await expect(window.locator(".settings-view")).toContainText("Helper");
    await expect(window.locator(".settings-view")).toContainText("Available");
    await expect(window.locator(".settings-view")).toContainText("Locked");
    await expect(window.locator(".settings-view")).toContainText("Not enabled");
    await expect(window.locator(".settings-view")).toContainText("Turned off");
    await expect(window.locator(".settings-view")).toContainText("Enabled");
    await expect(window.locator(".settings-view")).toContainText("guarded macOS authorization plug-in");

    await window.getByRole("button", { name: "Open Settings", exact: true }).click();
    await expect.poll(() => readSettingsLog(settingsLogPath), { timeout: 5_000 }).toContain("accessibility");
  } finally {
    await harness.close();
  }
});
