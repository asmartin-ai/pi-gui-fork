import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { addWorkspace, getDesktopState, launchDesktop, makeWorkspace } from "./harness";

test("supports workspace rename and remove from the sidebar menu", async () => {
  test.setTimeout(60_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-user-data-"));
  const workspaceA = await makeWorkspace("workspace-menu-a");
  const workspaceB = await makeWorkspace("workspace-menu-b");
  const harness = await launchDesktop(userDataDir);

  try {
    const window = await harness.firstWindow();
    await addWorkspace(window, workspaceA);
    await addWorkspace(window, workspaceB);

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspaceA);
    if (!workspace) {
      throw new Error("Expected first workspace");
    }

    await window.getByRole("button", { name: `Workspace actions for ${workspace.name}` }).click();
    await expect(window.getByRole("button", { name: "Open in Finder" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Edit name" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Remove" })).toBeVisible();

    await window.getByRole("button", { name: "Edit name" }).click();
    const renameInput = window.getByLabel(`Rename ${workspace.name}`);
    await renameInput.fill("Renamed workspace");
    await window.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.find((entry) => entry.id === workspace.id)?.name;
    }).toBe("Renamed workspace");

    window.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await window.getByRole("button", { name: "Workspace actions for Renamed workspace" }).click();
    await window.getByRole("button", { name: "Remove" }).click();

    await expect.poll(async () => {
      const latest = await getDesktopState(window);
      return latest.workspaces.some((entry) => entry.id === workspace.id);
    }).toBe(false);
  } finally {
    await harness.close();
  }
});
