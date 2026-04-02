import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
} from "../helpers/electron-app";
import { createThread, selectSessionByTitle, setSessionVisibilityOverride, type SessionContext } from "./session-event-test-helpers";

async function notificationLog(logPath: string): Promise<string> {
  try {
    return await readFile(logPath, "utf8");
  } catch {
    return "";
  }
}

function completionPrompt(label: string, seconds = 5): string {
  return [
    "Use your bash or shell tool and run `python - <<'PY'",
    "import time",
    `print(${JSON.stringify(`${label} start`)})`,
    `time.sleep(${seconds})`,
    `print(${JSON.stringify(`${label} done`)})`,
    "PY`.",
    `After the tool finishes, reply with exactly ${JSON.stringify(`${label} complete`)} and nothing else.`,
  ].join("\n");
}

async function emitRunLifecycle(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  session: SessionContext,
  label: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + 1_000).toISOString();
  const runId = `${label.toLowerCase()}-${Date.now()}`;

  const runningEvent: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
    type: "sessionUpdated",
    sessionRef: session.sessionRef,
    timestamp: startedAt,
    runId,
    snapshot: {
      ref: session.sessionRef,
      workspace: session.workspace,
      title: session.title,
      status: "running",
      updatedAt: startedAt,
      preview: `${label} running`,
      runningRunId: runId,
    },
  };
  await emitTestSessionEvent(harness, runningEvent);

  const completedEvent: Extract<SessionDriverEvent, { type: "runCompleted" }> = {
    type: "runCompleted",
    sessionRef: session.sessionRef,
    timestamp: completedAt,
    runId,
    snapshot: {
      ref: session.sessionRef,
      workspace: session.workspace,
      title: session.title,
      status: "idle",
      updatedAt: completedAt,
      preview: `${label} complete`,
    },
  };
  await emitTestSessionEvent(harness, completedEvent);
}

test("does not log a notification or blue dot for a focused selected session completion", async () => {
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-focused-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const session = await createThread(window, "Focused Session");
    await setSessionVisibilityOverride(harness, "active");

    const row = window.locator(".session-row", { hasText: "Focused Session" });
    await emitRunLifecycle(harness, session, "Focused");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((entry) => entry.title === "Focused Session")?.status ?? "";
      })
      .toBe("idle");

    await expect(row).toHaveAttribute("data-sidebar-indicator", "none");
    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 5_000 }).toBe("");
  } finally {
    await harness.close();
  }
});

test("logs a completion notification and blue dot for a focused different session", async () => {
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const sessionA = await createThread(window, "Session A");
    await createThread(window, "Session B");
    await setSessionVisibilityOverride(harness, "active");
    await selectSessionByTitle(window, "Session B");

    await emitRunLifecycle(harness, sessionA, "A");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((entry) => entry.title === "Session A")?.status ?? "";
      })
      .toBe("idle");

    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 30_000 }).toContain("Session A");
    await expect(window.locator(".session-row", { hasText: "Session A" })).toHaveAttribute(
      "data-sidebar-indicator",
      "unseen",
    );
    await expect(window.locator(".session-row", { hasText: "Session B" })).toHaveAttribute(
      "data-sidebar-indicator",
      "none",
    );
  } finally {
    await harness.close();
  }
});

test("logs a completion notification and blue dot for a selected session after the window is hidden", async () => {
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-hidden-selected-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const session = await createThread(window, "Selected Session");
    await selectSessionByTitle(window, "Selected Session");
    await setSessionVisibilityOverride(harness, "inactive");

    const row = window.locator(".session-row", { hasText: "Selected Session" });
    await emitRunLifecycle(harness, session, "Hidden");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((entry) => entry.title === "Selected Session")?.status ?? "";
      })
      .toBe("idle");

    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 30_000 }).toContain("Selected Session");
    await expect(row).toHaveAttribute("data-sidebar-indicator", "unseen");
  } finally {
    await harness.close();
  }
});

test("logs a completion notification and blue dot when an existing session completes after the user switches away", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications-existing-session.jsonl");
  const workspacePath = await makeWorkspace("notifications-existing-session-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await harness.focusWindow();
    await createNamedThread(window, "Runtime Session A");
    await createNamedThread(window, "Runtime Session B");

    await selectSession(window, "Runtime Session A");
    const composer = window.getByTestId("composer");
    await composer.fill(completionPrompt("Runtime Session A"));
    await composer.press("Enter");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Runtime Session A")?.status ?? "";
      }, { timeout: 30_000 })
      .toBe("running");

    await selectSession(window, "Runtime Session B");
    await expect(window.locator(".topbar__session")).toHaveText("Runtime Session B");
    await expect(window.locator(".session-row", { hasText: "Runtime Session A" })).toHaveAttribute(
      "data-sidebar-indicator",
      "running",
    );

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Runtime Session A")?.status ?? "";
      }, { timeout: 150_000 })
      .toBe("idle");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const runtimeSession = state.workspaces[0]?.sessions.find((session) => session.title === "Runtime Session A");
        return runtimeSession
          ? {
              hasUnseenUpdate: runtimeSession.hasUnseenUpdate,
              updatedAt: runtimeSession.updatedAt,
              lastViewedAt: runtimeSession.lastViewedAt,
            }
          : null;
      }, { timeout: 30_000 })
      .toMatchObject({
        hasUnseenUpdate: true,
      });

    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 30_000 }).toContain("Runtime Session A");
    await expect(window.locator(".session-row", { hasText: "Runtime Session A" })).toHaveAttribute(
      "data-sidebar-indicator",
      "unseen",
    );
  } finally {
    await harness.close();
  }
});
