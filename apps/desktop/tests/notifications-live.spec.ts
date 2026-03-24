import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { getDesktopState, launchDesktop, makeWorkspace, type PiAppWindow } from "./harness";

test("logs a background completion notification for an unfocused session", async () => {
  test.setTimeout(180_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-user-data-"));
  const notificationLogPath = join(userDataDir, "notifications.jsonl");
  const workspacePath = await makeWorkspace("notifications-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    notificationLogPath,
  });

  try {
    const window = await harness.firstWindow();
    const sessions = await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      const state = await app.getState();
      const workspace = state.workspaces[0];
      if (!workspace) throw new Error("Expected workspace");
      await app.createSession({ workspaceId: workspace.id, title: "Session A" });
      await app.createSession({ workspaceId: workspace.id, title: "Session B" });
      const refreshed = await app.getState();
      const currentWorkspace = refreshed.workspaces[0];
      return {
        workspaceId: currentWorkspace?.id ?? "",
        sessionAId: currentWorkspace?.sessions.find((entry) => entry.title === "Session A")?.id ?? "",
        sessionBId: currentWorkspace?.sessions.find((entry) => entry.title === "Session B")?.id ?? "",
      };
    });

    const promptA =
      "Use your bash tool and run `python - <<'PY'\nimport time\nprint(\"A start\")\ntime.sleep(4)\nprint(\"A done\")\nPY` then reply with exactly `A complete`.";

    await window.evaluate(({ workspaceId, sessionId, prompt }) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      void app.selectSession({ workspaceId, sessionId }).then(() => app.submitComposer(prompt));
    }, { workspaceId: sessions.workspaceId, sessionId: sessions.sessionAId, prompt: promptA });

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces.find((entry) => entry.id === sessions.workspaceId);
        return workspace?.sessions.find((session) => session.id === sessions.sessionAId)?.status;
      }, { timeout: 30_000 })
      .toBe("running");

    await window.evaluate(async ({ workspaceId, sessionId }) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.selectSession({ workspaceId, sessionId });
    }, { workspaceId: sessions.workspaceId, sessionId: sessions.sessionBId });

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces.find((entry) => entry.id === sessions.workspaceId);
        return workspace?.sessions.find((session) => session.id === sessions.sessionAId)?.status;
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
