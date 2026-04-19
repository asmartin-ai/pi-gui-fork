import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";
import { emitRunningEvent, readOptionalLog } from "../helpers/notification-events";
import { createThread, selectSessionByTitle, setSessionVisibilityOverride } from "./session-event-test-helpers";

type NotificationTestApi = {
  setNotificationPreferences: (preferences: {
    backgroundCompletion: boolean;
    backgroundFailure: boolean;
    attentionNeeded: boolean;
  }) => Promise<unknown>;
};

async function setNotificationPreferences(
  window: Page,
  preferences: { backgroundCompletion: boolean; backgroundFailure: boolean; attentionNeeded: boolean },
): Promise<void> {
  await window.evaluate(async (nextPreferences) => {
    const app = (window as Window & { piApp?: NotificationTestApi }).piApp;
    if (!app) {
      throw new Error("piApp IPC bridge is unavailable");
    }
    await app.setNotificationPreferences(nextPreferences);
  }, preferences);
}

test("requests notification permission when the user switches away from a running session", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-switch.log");
  const workspacePath = await makeWorkspace("notification-onboarding-switch-workspace");
  const harness = await launchDesktop(userDataDir, {
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
    const sessionA = await createThread(window, "Onboarding Session A");
    await createThread(window, "Onboarding Session B");
    await setSessionVisibilityOverride(harness, "active");
    await selectSessionByTitle(window, "Onboarding Session A");
    await emitRunningEvent(harness, sessionA, "Switch");

    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    await selectSessionByTitle(window, "Onboarding Session B");
    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).not.toBe("");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "Notifications", exact: true }).click();
    await expect(window.locator(".settings-view")).toContainText("Enabled");
  } finally {
    await harness.close();
  }
});

test("requests notification permission when the user leaves the threads surface", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-settings.log");
  const workspacePath = await makeWorkspace("notification-onboarding-settings-workspace");
  const harness = await launchDesktop(userDataDir, {
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
    const session = await createThread(window, "Onboarding Settings Session");
    await setSessionVisibilityOverride(harness, "active");
    await selectSessionByTitle(window, "Onboarding Settings Session");
    await emitRunningEvent(harness, session, "Settings");

    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).not.toBe("");
  } finally {
    await harness.close();
  }
});

test("requests notification permission when the user minimizes a running session window", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-minimize.log");
  const workspacePath = await makeWorkspace("notification-onboarding-minimize-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "foreground",
    envOverrides: {
      PI_APP_TEST_NOTIFICATION_PERMISSION_STATUS: "default",
      PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_RESULT: "granted",
      PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_LOG_PATH: requestLogPath,
    },
  });

  try {
    const window = await harness.firstWindow();
    await harness.focusWindow();
    const session = await createThread(window, "Onboarding Minimize Session");
    await selectSessionByTitle(window, "Onboarding Minimize Session");
    await emitRunningEvent(harness, session, "Minimize");

    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    await harness.electronApp.evaluate(({ BrowserWindow }) => {
      const appWindow = BrowserWindow.getAllWindows()[0];
      appWindow?.minimize();
    });
    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).not.toBe("");
  } finally {
    await harness.close();
  }
});

test("requests notification permission after a backgrounded session later flips to running", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-late-running.log");
  const workspacePath = await makeWorkspace("notification-onboarding-late-running-workspace");
  const harness = await launchDesktop(userDataDir, {
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
    const sessionA = await createThread(window, "Late Running Session A");
    await createThread(window, "Late Running Session B");
    await setSessionVisibilityOverride(harness, "active");
    await selectSessionByTitle(window, "Late Running Session A");
    await selectSessionByTitle(window, "Late Running Session B");

    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    await emitRunningEvent(harness, sessionA, "LateRunning");
    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).not.toBe("");
  } finally {
    await harness.close();
  }
});

test("does not request notification permission when all notification categories are disabled", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-disabled.log");
  const workspacePath = await makeWorkspace("notification-onboarding-disabled-workspace");
  const harness = await launchDesktop(userDataDir, {
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
    const sessionA = await createThread(window, "Disabled Session A");
    await createThread(window, "Disabled Session B");
    await setSessionVisibilityOverride(harness, "active");
    await setNotificationPreferences(window, {
      backgroundCompletion: false,
      backgroundFailure: false,
      attentionNeeded: false,
    });
    await selectSessionByTitle(window, "Disabled Session A");
    await emitRunningEvent(harness, sessionA, "Disabled");
    await selectSessionByTitle(window, "Disabled Session B");

    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
  } finally {
    await harness.close();
  }
});

test("does not request notification permission again after macOS already decided", async () => {
  for (const status of ["denied", "granted"] as const) {
    const userDataDir = await makeUserDataDir(`pi-gui-notification-${status}-`);
    const requestLogPath = join(userDataDir, `notification-onboarding-${status}.log`);
    const workspacePath = await makeWorkspace(`notification-onboarding-${status}-workspace`);
    const harness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
      envOverrides: {
        PI_APP_TEST_NOTIFICATION_PERMISSION_STATUS: status,
        PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_RESULT: "granted",
        PI_APP_TEST_NOTIFICATION_PERMISSION_REQUEST_LOG_PATH: requestLogPath,
      },
    });

    try {
      const window = await harness.firstWindow();
      const sessionA = await createThread(window, `${status} Session A`);
      await createThread(window, `${status} Session B`);
      await setSessionVisibilityOverride(harness, "active");
      await selectSessionByTitle(window, `${status} Session A`);
      await emitRunningEvent(harness, sessionA, status);
      await selectSessionByTitle(window, `${status} Session B`);

      await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    } finally {
      await harness.close();
    }
  }
});

test("does not request notification permission on launch before any work is backgrounded", async () => {
  const userDataDir = await makeUserDataDir();
  const requestLogPath = join(userDataDir, "notification-onboarding-startup.log");
  const workspacePath = await makeWorkspace("notification-onboarding-startup-workspace");
  const harness = await launchDesktop(userDataDir, {
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
    await expect(window.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect.poll(() => readOptionalLog(requestLogPath), { timeout: 5_000 }).toBe("");
    expect((await getDesktopState(window)).activeView).toBe("threads");
  } finally {
    await harness.close();
  }
});
