import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  selectWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("persists workspace, selected session, and draft across app restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("codex-style-folder");
  const draft = "Now summarize the project title in one sentence.";

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Persistence session");

    const composer = window.getByTestId("composer");
    await composer.fill(draft);
    await expect(composer).toHaveValue(draft);
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe(draft);
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await expect(window.locator(".session-row--active")).toContainText("Persistence session");
    await expect(window.getByTestId("composer")).toHaveValue(draft);

    const state = await getDesktopState(window);
    const persistedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    expect(persistedWorkspace?.path).toBeTruthy();
    expect(state.selectedSessionId).not.toBe("");
    expect(state.workspaces.some((workspace) => workspace.path === persistedWorkspace?.path)).toBe(true);
    expect(state.workspaces.some((workspace) => workspace.sessions.some((session) => session.title === "Persistence session"))).toBe(
      true,
    );
  } finally {
    await secondRun.close();
  }
});

test("navigates across folders and sessions through the sidebar", async () => {
  const userDataDir = await makeUserDataDir();
  const alphaPath = await makeWorkspace("alpha-workspace");
  const betaPath = await makeWorkspace("beta-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [alphaPath, betaPath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, alphaPath);
    await waitForWorkspaceByPath(window, betaPath);

    await selectWorkspace(window, basename(alphaPath));
    await createNamedThread(window, "Alpha session one");
    await expect(window.locator(".session-row", { hasText: "Alpha session one" })).toHaveAttribute(
      "data-sidebar-indicator",
      "none",
    );

    await createNamedThread(window, "Alpha session two");
    await selectWorkspace(window, basename(betaPath));
    await createNamedThread(window, "Beta session one");

    await expect(window.locator(".topbar__session")).toHaveText("Beta session one");
    await expect(window.locator(".session-row", { hasText: "Alpha session two" })).toHaveAttribute(
      "data-sidebar-indicator",
      "none",
    );

    await expect(window.getByTestId("workspace-list")).toContainText(basename(alphaPath));
    await expect(window.getByTestId("workspace-list")).toContainText(basename(betaPath));

    await selectWorkspace(window, basename(alphaPath));
    await selectSession(window, "Alpha session one");
    await selectSession(window, "Beta session one");

    const state = await getDesktopState(window);
    const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    expect(selectedWorkspace?.path).toBeTruthy();
    expect(state.selectedSessionId).not.toBe("");
    expect(state.workspaces.find((workspace) => workspace.path === alphaPath)?.sessions).toHaveLength(2);
    expect(state.workspaces.find((workspace) => workspace.path === betaPath)?.sessions).toHaveLength(1);
  } finally {
    await harness.close();
  }
});
