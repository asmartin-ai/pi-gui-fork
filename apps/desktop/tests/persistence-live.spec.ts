import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { getDesktopState, launchDesktop, makeWorkspace, type PiAppWindow } from "./harness";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZfXQAAAAASUVORK5CYII=";

test("persists lightweight ui state separately from transcript and draft attachments", async () => {
  test.setTimeout(90_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-user-data-"));
  const workspacePath = await makeWorkspace("persistence-workspace");

  const firstRun = await launchDesktop(userDataDir, [workspacePath]);
  try {
    const window = await firstRun.firstWindow();
    const workspaceId = await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      const state = await app.getState();
      const workspace = state.workspaces[0];
      if (!workspace) throw new Error("Expected workspace");
      await app.createSession({ workspaceId: workspace.id, title: "Persistence session" });
      return workspace.id;
    });

    await window.evaluate(async (data) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.addComposerImages([
        {
          id: "img-persist-1",
          name: "image.png",
          mimeType: "image/png",
          data,
        },
      ]);
      await app.submitComposer("/status");
      await app.updateComposerDraft("draft survives restart");
    }, TINY_PNG_BASE64);

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces[0]?.sessions[0]?.transcript.length ?? 0;
    }).toBeGreaterThan(0);
    const state = await getDesktopState(window);
    const sessionId = state.selectedSessionId;

    const uiStateRaw = await readFile(join(userDataDir, "ui-state.json"), "utf8");
    const uiState = JSON.parse(uiStateRaw) as Record<string, unknown>;
    expect(uiState["transcripts"]).toBeUndefined();
    expect(uiState["composerAttachmentsBySession"]).toBeUndefined();

    const transcriptPath = join(userDataDir, "transcripts", encodeURIComponent(`${workspaceId}:${sessionId}`) + ".json");
    const attachmentPath = join(userDataDir, "attachments", encodeURIComponent(`${workspaceId}:${sessionId}`) + ".json");
    await expect.poll(async () => {
      try {
        return await readFile(transcriptPath, "utf8");
      } catch {
        return "";
      }
    }).toContain("\"kind\": \"activity\"");
    await expect.poll(async () => {
      try {
        return await readFile(attachmentPath, "utf8");
      } catch {
        return "";
      }
    }).toContain("image.png");
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, [workspacePath]);
  try {
    const window = await secondRun.firstWindow();
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces[0];
      const session = workspace?.sessions[0];
      return {
        attachments: state.composerAttachments.length,
        transcriptLines: Math.max(0, session?.transcript.length ?? 0),
      };
    }).toMatchObject({
      attachments: 1,
    });
    const restored = await getDesktopState(window);
    expect(restored.workspaces[0]?.sessions[0]?.transcript.length ?? 0).toBeGreaterThan(0);
  } finally {
    await secondRun.close();
  }
});
