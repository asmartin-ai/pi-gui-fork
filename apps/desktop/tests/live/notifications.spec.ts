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

test("logs a background completion notification for an unfocused session", async () => {
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

    const promptA =
      "Use your bash tool and run `python - <<'PY'\nimport time\nprint(\"A start\")\ntime.sleep(4)\nprint(\"A done\")\nPY` then reply with exactly `A complete`.";

    await selectSession(window, "Session A");
    await window.getByTestId("composer").fill(promptA);
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

    await expect
      .poll(async () => {
        try {
          return await readFile(notificationLogPath, "utf8");
        } catch {
          return "";
        }
      }, { timeout: 30_000 })
      .toContain("Session A");
  } finally {
    await harness.close();
  }
});
