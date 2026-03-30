import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
} from "../helpers/electron-app";

test("pastes an image into the composer surface and clears the attachment chip on submit", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("paste-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Paste test");

    const composer = window.getByTestId("composer");
    await pasteTinyPng(window);

    const chip = window.locator(".composer-attachment");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".composer-attachment__name")).toContainText("screenshot.png");
    await expect(chip.locator(".composer-attachment__preview")).toBeVisible();

    await composer.fill("test with image");
    await composer.press("Enter");
    await expect(window.locator(".composer-attachment")).toHaveCount(0, { timeout: 2_000 });
    await expect(composer).toHaveValue("");
  } finally {
    await harness.close();
  }
});

test("persists transcript storage separately from ui state and restores the current draft", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("persistence-workspace");

  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Persistence session");

    const composer = window.getByTestId("composer");
    await pasteTinyPng(window);
    await expect(window.locator(".composer-attachment")).toBeVisible();

    await composer.fill("/status");
    await composer.press("Enter");
    await expect(window.getByTestId("transcript")).toContainText("Model");

    await composer.fill("draft survives restart");
    await expect(composer).toHaveValue("draft survives restart");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions[0]?.transcript.length ?? 0;
      })
      .toBeGreaterThan(0);

    const state = await getDesktopState(window);
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    expect(workspaceId).toBeTruthy();
    expect(sessionId).toBeTruthy();

    const uiStateRaw = await readFile(join(userDataDir, "ui-state.json"), "utf8");
    const uiState = JSON.parse(uiStateRaw) as Record<string, unknown>;
    expect(uiState.transcripts).toBeUndefined();
    expect(uiState.composerAttachmentsBySession).toBeUndefined();

    const transcriptPath = join(userDataDir, "transcripts", encodeURIComponent(`${workspaceId}:${sessionId}`) + ".json");
    const attachmentPath = join(userDataDir, "attachments", encodeURIComponent(`${workspaceId}:${sessionId}`) + ".json");
    await expect
      .poll(async () => {
        try {
          return await readFile(transcriptPath, "utf8");
        } catch {
          return "";
        }
      })
      .toContain("\"kind\": \"activity\"");
    await expect
      .poll(async () => {
        try {
          return await readFile(attachmentPath, "utf8");
        } catch {
          return "";
        }
      })
      .toContain("\"mimeType\": \"image/png\"");
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await expect(window.getByTestId("composer")).toHaveValue("draft survives restart");
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces[0];
        const session = workspace?.sessions[0];
        return {
          attachments: state.composerAttachments.length,
          transcriptLines: session?.transcript.length ?? 0,
        };
      })
      .toMatchObject({
        attachments: 1,
      });
  } finally {
    await secondRun.close();
  }
});
