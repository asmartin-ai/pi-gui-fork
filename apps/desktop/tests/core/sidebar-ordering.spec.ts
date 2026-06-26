import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("sidebar thread order is stable after creation and does not flicker", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("ordering-test");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);

    // Create thread A — it should be at the top (most recent updatedAt).
    await createNamedThread(window, "Thread A", { workspaceName: basename(workspacePath) });
    const afterA = await getDesktopState(window);
    const wsAfterA = afterA.workspaces.find((w) => w.id === workspace.id)!;
    expect(wsAfterA.sessions).toHaveLength(1);

    // Small delay so thread B gets a strictly later updatedAt.
    await new Promise((r) => setTimeout(r, 50));

    // Create thread B — it should now be at the top.
    await createNamedThread(window, "Thread B", { workspaceName: basename(workspacePath) });

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces.find((w) => w.id === workspace.id)?.sessions.length ?? 0;
    }).toBe(2);

    const afterB = await getDesktopState(window);
    const wsAfterB = afterB.workspaces.find((w) => w.id === workspace.id)!;
    const sessionB = wsAfterB.sessions.find((s) => s.title === "Thread B")!;
    const sessionA = wsAfterB.sessions.find((s) => s.title === "Thread A")!;

    // Thread B was created/interacted with more recently, so its updatedAt should be >= A's.
    expect(sessionB.updatedAt >= sessionA.updatedAt).toBe(true);

    // Verify sidebar renders B before A (most recent first).
    const rows = window.locator(".session-row__select");
    const titles = await rows.allTextContents();
    const bIndex = titles.findIndex((t) => t.includes("Thread B"));
    const aIndex = titles.findIndex((t) => t.includes("Thread A"));
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeLessThan(aIndex);

    // Record the updatedAt values and verify they remain stable over time.
    // This catches the bug where agent events would continuously update updatedAt.
    const snapshot1B = sessionB.updatedAt;
    const snapshot1A = sessionA.updatedAt;

    // Wait briefly and re-check — updatedAt should NOT have changed without user action.
    await new Promise((r) => setTimeout(r, 500));
    const laterState = await getDesktopState(window);
    const wsLater = laterState.workspaces.find((w) => w.id === workspace.id)!;
    const laterB = wsLater.sessions.find((s) => s.title === "Thread B")!;
    const laterA = wsLater.sessions.find((s) => s.title === "Thread A")!;
    expect(laterB.updatedAt).toBe(snapshot1B);
    expect(laterA.updatedAt).toBe(snapshot1A);

    // Verify sidebar order is unchanged.
    const laterTitles = await rows.allTextContents();
    const laterBIndex = laterTitles.findIndex((t) => t.includes("Thread B"));
    const laterAIndex = laterTitles.findIndex((t) => t.includes("Thread A"));
    expect(laterBIndex).toBeLessThan(laterAIndex);
  } finally {
    await harness.close();
  }
});

test("pinned sidebar threads stay above history, persist across relaunch, and unpin into normal ordering", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("pinned-ordering-test");
  let harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Thread A", { workspaceName: basename(workspacePath) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await createNamedThread(window, "Thread B", { workspaceName: basename(workspacePath) });

    const threadARow = window.locator(".session-row", { hasText: "Thread A" });
    await threadARow.hover();
    await window.getByRole("button", { name: /Pin Thread A/ }).click();

    const pinnedSection = window.getByRole("region", { name: "Pinned threads" });
    await expect(pinnedSection).toBeVisible();
    await expect(pinnedSection.locator(".session-row__title")).toHaveText(["Thread A"]);
    await expect(pinnedSection.locator(".session-row__context")).toHaveText([basename(workspacePath)]);

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return Object.values(state.pinnedAtBySession).length;
    }).toBe(1);

    await harness.close();
    harness = await launchDesktop(userDataDir, { testMode: "background" });

    const reopenedWindow = await harness.firstWindow();
    await waitForWorkspaceByPath(reopenedWindow, workspacePath);
    const reopenedPinnedSection = reopenedWindow.getByRole("region", { name: "Pinned threads" });
    await expect(reopenedPinnedSection).toBeVisible();
    await expect(reopenedPinnedSection.locator(".session-row__title")).toHaveText(["Thread A"]);

    await reopenedPinnedSection.getByRole("button", { name: /Unpin Thread A/ }).click();
    await expect(reopenedWindow.getByRole("region", { name: "Pinned threads" })).toHaveCount(0);

    await expect.poll(async () => {
      const state = await getDesktopState(reopenedWindow);
      return Object.values(state.pinnedAtBySession).length;
    }).toBe(0);

    const rows = reopenedWindow.locator(".session-row__select");
    const titles = await rows.allTextContents();
    const bIndex = titles.findIndex((title) => title.includes("Thread B"));
    const aIndex = titles.findIndex((title) => title.includes("Thread A"));
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeLessThan(aIndex);

    const state = await getDesktopState(reopenedWindow);
    const ws = state.workspaces.find((entry) => entry.id === workspace.id);
    expect(ws?.sessions.find((session) => session.title === "Thread A")?.pinnedAt).toBeUndefined();
  } finally {
    await harness.close();
  }
});
