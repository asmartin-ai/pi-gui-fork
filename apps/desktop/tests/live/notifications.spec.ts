import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
} from "../helpers/electron-app";

function completionPrompt(label: string, seconds = 4): string {
  return [
    "Use your bash tool and run `python - <<'PY'",
    "import time",
    `print(${JSON.stringify(`${label} start`)})`,
    `time.sleep(${seconds})`,
    `print(${JSON.stringify(`${label} done`)})`,
    "PY` then reply with exactly " + JSON.stringify(`${label} complete`) + ".",
  ].join("\n");
}

async function notificationLog(logPath: string): Promise<string> {
  try {
    return await readFile(logPath, "utf8");
  } catch {
    return "";
  }
}

test("does not log a notification or blue dot for a focused selected session completion", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-focused-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await harness.focusWindow();
    await createNamedThread(window, "Focused Session");
    await selectSession(window, "Focused Session");

    const row = window.locator(".session-row", { hasText: "Focused Session" });
    await window.getByTestId("composer").fill(completionPrompt("Focused", 3));
    await window.getByTestId("composer").press("Enter");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Focused Session")?.status ?? "";
      }, { timeout: 30_000 })
      .toBe("running");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Focused Session")?.status ?? "";
      }, { timeout: 120_000 })
      .toBe("idle");

    await expect(row).toHaveAttribute("data-sidebar-indicator", "none");
    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 5_000 }).toBe("");
  } finally {
    await harness.close();
  }
});

test("logs a notification and blue dot when the selected session completes after the window is backgrounded", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-backgrounded-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await harness.focusWindow();
    await createNamedThread(window, "Backgrounded Session");
    await selectSession(window, "Backgrounded Session");

    const row = window.locator(".session-row", { hasText: "Backgrounded Session" });
    await window.getByTestId("composer").fill(completionPrompt("Backgrounded", 3));
    await window.getByTestId("composer").press("Enter");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Backgrounded Session")?.status ?? "";
      }, { timeout: 30_000 })
      .toBe("running");

    await harness.backgroundWindow();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Backgrounded Session")?.status ?? "";
      }, { timeout: 120_000 })
      .toBe("idle");

    console.log(
      JSON.stringify(
        (await getDesktopState(window)).workspaces[0]?.sessions.find((session) => session.title === "Backgrounded Session"),
        null,
        2,
      ),
    );
    await expect(row).toHaveAttribute("data-sidebar-indicator", "unseen");
    await expect.poll(() => notificationLog(notificationLogPath), { timeout: 30_000 }).toContain("Backgrounded Session");

    await harness.focusWindow();
    await selectSession(window, "Backgrounded Session");
    await expect(row).toHaveAttribute("data-sidebar-indicator", "none");
  } finally {
    await harness.close();
  }
});

test("logs a background completion notification for an unfocused different session", async () => {
  test.setTimeout(180_000);
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
    await createNamedThread(window, "Session A");
    await createNamedThread(window, "Session B");

    await selectSession(window, "Session A");
    await window.getByTestId("composer").fill(completionPrompt("A"));
    await window.getByTestId("composer").press("Enter");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Session A")?.status ?? "";
      }, { timeout: 30_000 })
      .toBe("running");

    await selectSession(window, "Session B");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Session A")?.status ?? "";
      }, { timeout: 120_000 })
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
