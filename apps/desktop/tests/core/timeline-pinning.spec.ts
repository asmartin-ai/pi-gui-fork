import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  commitAllInGitRepo,
  desktopShortcut,
  getTimelineScrollMetrics,
  initGitRepo,
  jumpTimelineToBottom,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  scrollTimelineAwayFromBottom,
  seedTranscriptMessages,
  startThreadFromSurface,
} from "../helpers/electron-app";

const multilineDraft = [
  "line 1",
  "line 2",
  "line 3",
  "line 4",
  "line 5",
  "line 6",
].join("\n");

test("keeps the latest assistant content visible when the composer grows at the bottom of a thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-bottom");
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, "README.md"), "# timeline pinning\nupdated\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await startThreadFromSurface(window, { prompt: "Bottom pinning session" });

    const finalText = "PIN_FINAL_ROW visible above composer";
    const { messages } = await seedTranscriptMessages(harness, window, {
      count: 14,
      textFactory: (index) => (index === 13 ? finalText : `Pinned seed row ${index} `.repeat(8)),
    });
    await expect(window.getByTestId("transcript")).toContainText(messages.at(-1) ?? finalText);

    await jumpTimelineToBottom(window);
    await expect.poll(() => getTimelineScrollMetrics(window)).toMatchObject({
      remainingFromBottom: expect.any(Number),
    });
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const composer = window.getByTestId("composer");
    const composerShell = window.locator(".composer");
    const finalRow = window.locator(".timeline-item--assistant", { hasText: finalText });

    const beforeComposerHeight = (await composerShell.boundingBox())?.height ?? 0;
    expect(beforeComposerHeight).toBeGreaterThan(0);

    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expect
      .poll(async () => ((await composerShell.boundingBox())?.height ?? 0) - beforeComposerHeight)
      .toBeGreaterThan(40);

    await expect.poll(async () => {
      const [rowBox, composerBox] = await Promise.all([finalRow.boundingBox(), composerShell.boundingBox()]);
      if (!rowBox || !composerBox) {
        return -999;
      }
      return composerBox.y - (rowBox.y + rowBox.height);
    }).toBeGreaterThanOrEqual(-1);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    const diffPanel = window.locator(".diff-panel");
    await window.keyboard.press(desktopShortcut("D"));
    await expect(diffPanel).toBeVisible();
    await expect(window.getByTestId("timeline-pane")).toBeVisible();
    await expect(composerShell).toBeVisible();
    await expect.poll(async () => {
      const [rowBox, composerBox] = await Promise.all([finalRow.boundingBox(), composerShell.boundingBox()]);
      if (!rowBox || !composerBox) {
        return -999;
      }
      return composerBox.y - (rowBox.y + rowBox.height);
    }).toBeGreaterThanOrEqual(-1);
  } finally {
    await harness.close();
  }
});

test("keeps the mid-thread viewport stable when the composer grows away from the bottom", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-pinning-middle");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await startThreadFromSurface(window, { prompt: "Mid-thread pinning session" });

    const sentinelText = "MID_SENTINEL_ROW should stay put";
    const finalText = "MID_FINAL_ROW at thread bottom";
    await seedTranscriptMessages(harness, window, {
      count: 16,
      textFactory: (index) => {
        if (index === 5) return sentinelText;
        if (index === 15) return finalText;
        return `Mid-thread seed row ${index} `.repeat(8);
      },
    });
    await expect(window.getByTestId("transcript")).toContainText(finalText);

    await jumpTimelineToBottom(window);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeLessThanOrEqual(16);

    await scrollTimelineAwayFromBottom(window, 220);
    await expect.poll(async () => (await getTimelineScrollMetrics(window)).remainingFromBottom).toBeGreaterThan(100);

    const composer = window.getByTestId("composer");
    const composerShell = window.locator(".composer");
    const sentinelRow = window.locator(".timeline-item--assistant", { hasText: sentinelText });
    await expect(sentinelRow).toBeVisible();

    const beforeComposerHeight = (await composerShell.boundingBox())?.height ?? 0;
    const beforeSentinelY = (await sentinelRow.boundingBox())?.y ?? 0;
    const beforeScrollTop = (await getTimelineScrollMetrics(window)).scrollTop;

    await composer.fill(multilineDraft);
    await expect(composer).toHaveValue(multilineDraft);
    await expect
      .poll(async () => ((await composerShell.boundingBox())?.height ?? 0) - beforeComposerHeight)
      .toBeGreaterThan(40);

    await expect.poll(async () => {
      const rowBox = await sentinelRow.boundingBox();
      return rowBox ? Math.abs(rowBox.y - beforeSentinelY) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(12);
    await expect.poll(async () => {
      const metrics = await getTimelineScrollMetrics(window);
      return Math.abs(metrics.scrollTop - beforeScrollTop);
    }).toBeLessThanOrEqual(12);
    await expect(window.getByTestId("timeline-jump")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
