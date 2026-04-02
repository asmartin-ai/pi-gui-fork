import { expect, test } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import {
  emitTestSessionEvent,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

type DesktopTestApi = {
  getState: () => Promise<{
    selectedWorkspaceId?: string;
    selectedSessionId?: string;
    workspaces: Array<{
      id: string;
      name: string;
      path: string;
      sessions: Array<{ id: string; title: string }>;
    }>;
  }>;
  createSession: (input: { workspaceId: string; title: string }) => Promise<unknown>;
  selectSession: (target: { workspaceId: string; sessionId: string }) => Promise<unknown>;
};

type SessionContext = {
  readonly sessionRef: SessionRef;
  readonly workspace: {
    readonly workspaceId: string;
    readonly path: string;
    readonly displayName: string;
  };
  readonly title: string;
};

async function setSessionVisibilityOverride(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  mode: "active" | "inactive" | null,
): Promise<void> {
  await harness.electronApp.evaluate((_, nextMode) => {
    const globals = globalThis as { __PI_APP_TEST_SESSION_VISIBILITY__?: "active" | "inactive" };
    if (!nextMode) {
      delete globals.__PI_APP_TEST_SESSION_VISIBILITY__;
      return;
    }
    globals.__PI_APP_TEST_SESSION_VISIBILITY__ = nextMode;
  }, mode);
}

async function createThread(window: Parameters<typeof getDesktopState>[0], title: string): Promise<SessionContext> {
  await window.evaluate(async ({ targetTitle }) => {
    const app = (window as Window & { piApp?: DesktopTestApi }).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    const state = await app.getState();
    const workspaceId = state.selectedWorkspaceId ?? state.workspaces[0]?.id;
    if (!workspaceId) {
      throw new Error("Expected a selected workspace before creating a session");
    }
    await app.createSession({ workspaceId, title: targetTitle });
  }, { targetTitle: title });

  await expect
    .poll(async () => selectedSessionTitle(window), { timeout: 15_000 })
    .toBe(title);

  return requireSessionContext(window, title);
}

async function selectSessionByTitle(window: Parameters<typeof getDesktopState>[0], title: string): Promise<void> {
  await window.evaluate(async ({ targetTitle }) => {
    const app = (window as Window & { piApp?: DesktopTestApi }).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }

    const state = await app.getState();
    for (const workspace of state.workspaces) {
      const session = workspace.sessions.find((entry) => entry.title === targetTitle);
      if (!session) {
        continue;
      }
      await app.selectSession({
        workspaceId: workspace.id,
        sessionId: session.id,
      });
      return;
    }

    throw new Error(`Session not found: ${targetTitle}`);
  }, { targetTitle: title });

  await expect
    .poll(async () => selectedSessionTitle(window), { timeout: 15_000 })
    .toBe(title);
}

async function selectedSessionTitle(window: Parameters<typeof getDesktopState>[0]): Promise<string> {
  const state = await getDesktopState(window);
  const selectedWorkspace = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
  return selectedWorkspace?.sessions.find((session) => session.id === state.selectedSessionId)?.title ?? "";
}

async function requireSessionContext(
  window: Parameters<typeof getDesktopState>[0],
  title: string,
): Promise<SessionContext> {
  const state = await getDesktopState(window);
  for (const workspace of state.workspaces) {
    const session = workspace.sessions.find((entry) => entry.title === title);
    if (!session) {
      continue;
    }
    return {
      sessionRef: {
        workspaceId: workspace.id,
        sessionId: session.id,
      },
      workspace: {
        workspaceId: workspace.id,
        path: workspace.path,
        displayName: workspace.name,
      },
      title,
    };
  }

  throw new Error(`Session not found: ${title}`);
}

async function emitRunStarted(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  session: SessionContext,
  label: string,
  runId: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const event: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
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
  await emitTestSessionEvent(harness, event);
}

async function emitRunCompleted(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  session: SessionContext,
  label: string,
  runId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const delta: Extract<SessionDriverEvent, { type: "assistantDelta" }> = {
    type: "assistantDelta",
    sessionRef: session.sessionRef,
    timestamp,
    runId,
    text: `${label} complete`,
  };
  await emitTestSessionEvent(harness, delta);

  const completion: Extract<SessionDriverEvent, { type: "runCompleted" }> = {
    type: "runCompleted",
    sessionRef: session.sessionRef,
    timestamp: new Date(Date.now() + 1_000).toISOString(),
    runId,
    snapshot: {
      ref: session.sessionRef,
      workspace: session.workspace,
      title: session.title,
      status: "idle",
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
      preview: `${label} complete`,
    },
  };
  await emitTestSessionEvent(harness, completion);
}

test("runs two sessions in parallel without sidebar status bleed", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("parallel-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const sessionA = await createThread(window, "Session A");
    const sessionB = await createThread(window, "Session B");
    await setSessionVisibilityOverride(harness, "active");

    const runIdA = `run-a-${Date.now()}`;
    const runIdB = `run-b-${Date.now() + 1}`;

    await selectSessionByTitle(window, "Session A");
    await emitRunStarted(harness, sessionA, "A", runIdA);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Session A")?.status ?? "";
      }, { timeout: 30_000 })
      .toBe("running");

    await selectSessionByTitle(window, "Session B");
    await emitRunStarted(harness, sessionA, "A", runIdA);
    await emitRunStarted(harness, sessionB, "B", runIdB);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces[0];
        const currentA = workspace?.sessions.find((session) => session.title === "Session A");
        const currentB = workspace?.sessions.find((session) => session.title === "Session B");
        return {
          sessionAStatus: currentA?.status,
          sessionBStatus: currentB?.status,
        };
      }, { timeout: 45_000 })
      .toEqual({
        sessionAStatus: "running",
        sessionBStatus: "running",
      });

    const sessionARow = window.locator(".session-row", { hasText: "Session A" });
    const sessionBRow = window.locator(".session-row", { hasText: "Session B" });
    await expect(sessionARow).toHaveAttribute("data-sidebar-indicator", "running");
    await expect(sessionARow.locator(".session-row__status--running")).toHaveCount(1);

    const runningAlignedTitles = await Promise.all([
      sessionARow.locator(".session-row__title").boundingBox(),
      sessionBRow.locator(".session-row__title").boundingBox(),
    ]);
    expect(runningAlignedTitles[0]).not.toBeNull();
    expect(runningAlignedTitles[1]).not.toBeNull();
    expect(Math.abs((runningAlignedTitles[0]?.x ?? 0) - (runningAlignedTitles[1]?.x ?? 0))).toBeLessThanOrEqual(1);

    await emitRunCompleted(harness, sessionA, "A", runIdA);
    await emitRunCompleted(harness, sessionB, "B", runIdB);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces[0];
        const currentA = workspace?.sessions.find((session) => session.title === "Session A");
        const currentB = workspace?.sessions.find((session) => session.title === "Session B");
        return {
          sessionAStatus: currentA?.status,
          sessionBStatus: currentB?.status,
        };
      }, { timeout: 120_000 })
      .toEqual({
        sessionAStatus: "idle",
        sessionBStatus: "idle",
      });

    await expect(sessionARow).toHaveAttribute("data-sidebar-indicator", "unseen");
    await expect(sessionARow.locator(".session-row__status--unseen")).toHaveCount(1);
    await expect(sessionBRow).toHaveAttribute("data-sidebar-indicator", "none");

    const alignedTitles = await Promise.all([
      sessionARow.locator(".session-row__title").boundingBox(),
      sessionBRow.locator(".session-row__title").boundingBox(),
    ]);
    expect(alignedTitles[0]).not.toBeNull();
    expect(alignedTitles[1]).not.toBeNull();
    expect(Math.abs((alignedTitles[0]?.x ?? 0) - (alignedTitles[1]?.x ?? 0))).toBeLessThanOrEqual(1);

    await selectSessionByTitle(window, "Session A");
    await expect(sessionARow).toHaveAttribute("data-sidebar-indicator", "none");

    const summarize = (transcript: Awaited<ReturnType<typeof getSelectedTranscript>>) =>
      (transcript?.transcript ?? []).map((item) => {
        switch (item.kind) {
          case "message":
            return `${item.role}:${item.text}`;
          case "tool":
          case "activity":
          case "summary":
            return `${item.kind}:${item.label}`;
          default:
            return item.kind;
        }
      });

    const sessionATranscript = await getSelectedTranscript(window);
    const sessionALines = summarize(sessionATranscript);
    await selectSessionByTitle(window, "Session B");
    const sessionBTranscript = await getSelectedTranscript(window);
    const sessionBLines = summarize(sessionBTranscript);
    expect(sessionALines.some((line) => line.includes("A complete"))).toBe(true);
    expect(sessionBLines.some((line) => line.includes("B complete"))).toBe(true);
    expect(sessionALines.some((line) => line.includes("B complete"))).toBe(false);
    expect(sessionBLines.some((line) => line.includes("A complete"))).toBe(false);
  } finally {
    await harness.close();
  }
});
