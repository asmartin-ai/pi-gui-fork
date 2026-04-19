import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { emitTestSessionEvent, getDesktopState, launchPackagedDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";
import { createThread, selectSessionByTitle, setSessionVisibilityOverride, type SessionContext } from "../live/session-event-test-helpers";

async function permissionRequestLog(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function emitRunningEvent(
  harness: Awaited<ReturnType<typeof launchPackagedDesktop>>,
  session: SessionContext,
  label: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = `${label.toLowerCase()}-${Date.now()}`;
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

test("requests notification permission in the packaged app when active work moves to the background", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-packaged.log");
  const workspacePath = await makeWorkspace("notification-onboarding-packaged-workspace");
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_APP_TEST_NOTIFICATION_PERMISSION_STATUS: "default",
      PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_RESULT: "granted",
      PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_LOG_PATH: requestLogPath,
    },
  });

  try {
    const window = await harness.firstWindow();
    const sessionA = await createThread(window, "Packaged Session A");
    await createThread(window, "Packaged Session B");
    await setSessionVisibilityOverride(harness, "active");
    await selectSessionByTitle(window, "Packaged Session A");
    await emitRunningEvent(harness, sessionA, "Packaged");

    await expect((await getDesktopState(window)).activeView).toBe("threads");
    await expect.poll(() => permissionRequestLog(requestLogPath), { timeout: 5_000 }).toBe("");

    await selectSessionByTitle(window, "Packaged Session B");
    await expect.poll(() => permissionRequestLog(requestLogPath), { timeout: 5_000 }).not.toBe("");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Notifications", exact: true }).click();
    await expect(window.locator(".settings-view")).toContainText("Enabled");
  } finally {
    await harness.close();
  }
});
