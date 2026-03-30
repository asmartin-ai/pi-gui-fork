import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";
import { acceptOpenFolderDialog } from "../helpers/macos-ui";

test("opens the native folder picker and adds the selected workspace", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-open-folder-workspace");
  const harness = await launchDesktop(userDataDir, { testMode: "foreground" });

  try {
    const window = await harness.firstWindow();
    await harness.focusWindow();
    await expect(window.getByTestId("empty-state")).toBeVisible();

    await window.getByRole("button", { name: "Open first folder" }).click();
    await acceptOpenFolderDialog(workspacePath);

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
