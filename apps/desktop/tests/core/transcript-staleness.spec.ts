import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

/**
 * The transcript shown after a relaunch must come straight from pi's session
 * file. An external writer (e.g. the pi CLI continuing the same session, or a
 * crash that outran a cache write) must be reflected on next launch.
 */
test("shows messages appended to the pi session file by an external writer after relaunch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("staleness-workspace");

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let sessionId = "";
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Staleness session");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId;
    sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();
  } finally {
    await firstRun.close();
  }

  const catalogs = JSON.parse(await readFile(join(userDataDir, "catalogs.json"), "utf8")) as {
    sessions: Array<{ sessionRef: { workspaceId: string; sessionId: string }; sessionFilePath?: string }>;
    sessionFiles?: Record<string, string>;
  };
  const sessionFilePath =
    catalogs.sessions.find(
      (session) => session.sessionRef.workspaceId === workspaceId && session.sessionRef.sessionId === sessionId,
    )?.sessionFilePath ?? catalogs.sessionFiles?.[`${workspaceId}:${sessionId}`];
  expect(sessionFilePath).toBeTruthy();

  // Append a user message the way pi itself would, chaining off the current leaf.
  const lines = (await readFile(sessionFilePath as string, "utf8")).split("\n").filter(Boolean);
  const lastEntry = JSON.parse(lines.at(-1) as string) as { id?: string };
  const parentId = lastEntry.id ?? null;
  const externalEntry = {
    type: "message",
    id: "external-writer-entry-1",
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: "external writer message survives relaunch",
      timestamp: Date.now(),
    },
  };
  await appendFile(sessionFilePath as string, `${JSON.stringify(externalEntry)}\n`, "utf8");

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("transcript")).toContainText("external writer message survives relaunch", {
      timeout: 15_000,
    });
  } finally {
    await secondRun.close();
  }
});
