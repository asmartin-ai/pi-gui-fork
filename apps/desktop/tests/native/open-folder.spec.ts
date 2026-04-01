import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { acceptOpenFolderDialog, cancelOpenDialog, clickMenuItem } from "../helpers/macos-ui";

const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";

test.skip(process.platform !== "darwin", "Open Folder native coverage is macOS-only");

test("opens the native folder picker from the empty state button and adds the selected workspace", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-open-folder-workspace");
  const harness = await launchDesktop(userDataDir, { testMode: "foreground" });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("empty-state")).toBeVisible();
    await harness.focusWindow();

    await Promise.all([
      acceptOpenFolderDialog(workspacePath),
      window.getByRole("button", { name: "Open first folder" }).click(),
    ]);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selectedWorkspace?.path ?? null;
      }, { timeout: 20_000 })
      .toBe(workspacePath);

    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await expect(window.locator(".empty-panel")).toContainText("Create a thread for this folder");
  } finally {
    await harness.close();
  }
});

test("opens a folder from Cmd+O even when the composer is focused", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const initialWorkspacePath = await makeWorkspace("native-open-folder-initial-workspace");
  const openedWorkspacePath = await makeWorkspace("native-open-folder-shortcut-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [initialWorkspacePath],
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Shortcut open folder session");
    await harness.focusWindow();

    const composer = window.getByTestId("composer");
    await composer.click();
    await expect(composer).toBeFocused();

    await Promise.all([
      acceptOpenFolderDialog(openedWorkspacePath),
      window.keyboard.press(desktopShortcut("O")),
    ]);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return {
          selectedPath: selectedWorkspace?.path ?? null,
          workspaceCount: state.workspaces.length,
        };
      }, { timeout: 20_000 })
      .toEqual({
        selectedPath: openedWorkspacePath,
        workspaceCount: 2,
      });

    await expect(window.getByTestId("workspace-list")).toContainText(basename(openedWorkspacePath));
    await expect(window.locator(".empty-panel")).toContainText("Create a thread for this folder");
  } finally {
    await harness.close();
  }
});

test("opens a folder from the File menu and exposes the expected macOS accelerator", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-open-folder-menu-workspace");
  const harness = await launchDesktop(userDataDir, { testMode: "foreground" });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("empty-state")).toBeVisible();
    await harness.focusWindow();

    const menuItem = await harness.electronApp.evaluate(({ Menu }, targetId) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) {
        return null;
      }

      const stack = menu.items.map((item) => ({ item, parentLabel: item.label ?? null }));
      while (stack.length > 0) {
        const entry = stack.shift();
        if (!entry) {
          continue;
        }
        const { item, parentLabel } = entry;
        if (item.id === targetId) {
          return {
            id: item.id,
            label: item.label,
            accelerator: item.accelerator ? String(item.accelerator) : "",
            parentLabel,
          };
        }
        for (const child of item.submenu?.items ?? []) {
          stack.push({ item: child, parentLabel: item.label || parentLabel });
        }
      }

      return null;
    }, OPEN_FOLDER_MENU_ITEM_ID);

    expect(menuItem).toEqual({
      id: OPEN_FOLDER_MENU_ITEM_ID,
      label: "Open Folder…",
      accelerator: "Command+O",
      parentLabel: "File",
    });

    await Promise.all([
      acceptOpenFolderDialog(workspacePath),
      clickMenuItem("File", "Open Folder…"),
    ]);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selectedWorkspace?.path ?? null;
      }, { timeout: 20_000 })
      .toBe(workspacePath);

    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
  } finally {
    await harness.close();
  }
});

test("canceling the native folder picker leaves workspace state unchanged", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-open-folder-cancel-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Cancel open folder session");
    await harness.focusWindow();

    const composer = window.getByTestId("composer");
    await composer.click();
    await expect(composer).toBeFocused();

    const before = await getDesktopState(window);
    const selectedBefore = before.workspaces.find((workspace) => workspace.id === before.selectedWorkspaceId);

    await Promise.all([
      cancelOpenDialog(),
      window.keyboard.press(desktopShortcut("O")),
    ]);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return {
          workspaceCount: state.workspaces.length,
          selectedPath: selectedWorkspace?.path ?? null,
          emptyStateVisible: await window.getByTestId("empty-state").isVisible().catch(() => false),
        };
      }, { timeout: 20_000 })
      .toEqual({
        workspaceCount: before.workspaces.length,
        selectedPath: selectedBefore?.path ?? null,
        emptyStateVisible: false,
      });
  } finally {
    await harness.close();
  }
});
