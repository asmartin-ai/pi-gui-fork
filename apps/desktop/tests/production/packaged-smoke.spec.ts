import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  resolvePackagedAppExecutable,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("launches the packaged app bundle and starts a thread through the real UI", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-packaged-user-data-");
  const workspacePath = await makeWorkspace("packaged-smoke-workspace");
  const promptText = "Packaged smoke thread";
  const expectedExecutablePath = await resolvePackagedAppExecutable();
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await expect
      .poll(async () => {
        return harness.electronApp.evaluate(() => ({
          defaultApp: Boolean(process.defaultApp),
          execPath: process.execPath,
        }));
      })
      .toEqual({
        defaultApp: false,
        execPath: expectedExecutablePath,
      });

    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    const prompt = window.getByLabel("New thread prompt");
    await expect(prompt).toBeVisible();
    await prompt.fill(promptText);
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.locator(".topbar__session")).toHaveText(/\S+/);
    await expect(window.getByTestId("composer")).toBeFocused();
    await expect(window.getByTestId("transcript")).toContainText(promptText);
  } finally {
    await harness.close();
  }
});
