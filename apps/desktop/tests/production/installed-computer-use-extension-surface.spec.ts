import { expect, test } from "@playwright/test";
import {
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  resolveAppBundleExecutable,
} from "../helpers/electron-app";
import { assertComputerUseExtensionSurface } from "./computer-use-extension-surface-assertions";

const installedAppBundle = "/Applications/pi-gui.app";

test("installed app presents built-in Computer Use as a top-level extension", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir("pi-gui-installed-computer-use-extension-surface-");
  const workspacePath = await makeWorkspace("installed-computer-use-extension-surface");
  const executablePath = await resolveAppBundleExecutable(installedAppBundle);
  const harness = await launchDesktopByExecutable(executablePath, userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await expect
      .poll(async () =>
        harness.electronApp.evaluate(() => ({
          defaultApp: Boolean(process.defaultApp),
          execPath: process.execPath,
        })),
      )
      .toEqual({
        defaultApp: false,
        execPath: executablePath,
      });
    await assertComputerUseExtensionSurface(window, workspacePath, "Installed extension mentions");
  } finally {
    await harness.close();
  }
});
