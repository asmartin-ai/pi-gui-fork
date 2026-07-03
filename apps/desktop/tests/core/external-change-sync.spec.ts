import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { appendMessagesToSessionFile, sessionFilePathFromCatalog } from "../helpers/session-file";

/**
 * Acceptance test for CLI ↔ GUI live sync. With the app running and a session
 * selected, an external writer (the pi CLI) appends a turn straight to the pi
 * session JSONL. The GUI's ExternalChangeWatcher must notice, reconcile the
 * workspace, and re-render the selected transcript — WITHOUT the user
 * re-selecting the workspace or session.
 */
test("reflects an external append to the selected session's JSONL while running", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("cli-sync-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "CLI sync session");

    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();

    // Resolve the pi JSONL path from the catalog once the running app has written it.
    let sessionFilePath = "";
    await expect
      .poll(
        async () => {
          try {
            sessionFilePath = await sessionFilePathFromCatalog(userDataDir, { workspaceId, sessionId });
            const contents = await readFile(sessionFilePath, "utf8");
            return contents.split("\n").filter(Boolean).length;
          } catch {
            return 0;
          }
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // Append a turn exactly as the pi CLI would, chaining off the current leaf.
    // No workspace/session re-selection happens after this point.
    await appendMessagesToSessionFile(sessionFilePath, [
      { role: "user", text: "external CLI turn appears live" },
    ]);

    await expect(window.getByTestId("transcript")).toContainText("external CLI turn appears live", {
      timeout: 20_000,
    });

    // The selection must be untouched — the update came from the watcher, not a reselect.
    const afterState = await getDesktopState(window);
    expect(afterState.selectedWorkspaceId).toBe(workspaceId);
    expect(afterState.selectedSessionId).toBe(sessionId);
  } finally {
    await harness.close();
  }
});
