import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace, stubNextOpenDialog } from "../helpers/electron-app";

test("opens the native folder picker and adds the selected workspace", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-open-folder-workspace");
  const harness = await launchDesktop(userDataDir, { testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("empty-state")).toBeVisible();

    await stubNextOpenDialog(harness, [workspacePath]);
    await window.getByRole("button", { name: "Open first folder" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.some((workspace) => workspace.path === workspacePath);
      }, { timeout: 20_000 })
      .toBe(true);

    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await expect(window.locator(".empty-panel")).toContainText("Create a thread for this folder");
  } finally {
    await harness.close();
  }
});
