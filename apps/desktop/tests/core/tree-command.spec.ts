import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedBranchedTreeSessionFixture,
  seedToolResultTreeSessionFixture,
  selectSession,
  waitForSelectedSessionReady,
} from "../helpers/electron-app";

async function deferAnimationFrames(window: Page): Promise<void> {
  await window.evaluate(() => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    let nextFrameId = -1;

    window.requestAnimationFrame = (callback) => {
      const frameId = nextFrameId;
      nextFrameId -= 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    };
    window.cancelAnimationFrame = (frameId) => {
      if (!queuedFrames.delete(frameId)) {
        originalCancelAnimationFrame(frameId);
      }
    };
    Object.assign(window, {
      __PI_FLUSH_DEFERRED_ANIMATION_FRAMES: () => {
        window.requestAnimationFrame = originalRequestAnimationFrame;
        window.cancelAnimationFrame = originalCancelAnimationFrame;
        const now = performance.now();
        for (const callback of queuedFrames.values()) {
          callback(now);
        }
        queuedFrames.clear();
      },
    });
  });
}

async function flushDeferredAnimationFrames(window: Page): Promise<void> {
  await window.evaluate(() => {
    (
      window as typeof window & {
        __PI_FLUSH_DEFERRED_ANIMATION_FRAMES?: () => void;
      }
    ).__PI_FLUSH_DEFERRED_ANIMATION_FRAMES?.();
  });
}

test("opens /tree from the composer, navigates branches, and blocks it on the new-thread surface", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tree-command-workspace");
  await seedAgentDir(agentDir);
  const fixture = await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    // Hold the session-selection focus restoration until the async tree modal is mounted.
    await deferAnimationFrames(window);
    await selectSession(window, fixture.title);
    await waitForSelectedSessionReady(window, fixture);

    const composer = window.getByTestId("composer");
    await composer.fill("/tre");
    await expect(window.getByTestId("slash-menu")).toContainText("Tree");
    await composer.press("Enter");

    const treeModal = window.getByTestId("tree-modal");
    await expect(treeModal).toBeVisible();
    await flushDeferredAnimationFrames(window);
    await expect(window.getByTestId("tree-modal-search")).toBeFocused();
    await expect(treeModal).not.toContainText("Tree fixture session");
    await expect(treeModal).not.toContainText("gpt-5.4");
    await expect(treeModal).not.toContainText("Thinking");
    await expect
      .poll(
        async () =>
          window.getByTestId("tree-modal-list").evaluate((list) =>
            list instanceof HTMLElement ? list.scrollTop : -1,
          ),
        { timeout: 1_500 },
      )
      .toBeGreaterThan(0);
    const initialScrollState = await window.getByTestId("tree-modal-list").evaluate((list) => {
      if (!(list instanceof HTMLElement)) {
        throw new Error("Expected tree list in modal");
      }
      return {
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
      };
    });
    expect(initialScrollState.scrollTop).toBeGreaterThan(0);
    expect(initialScrollState.scrollTop + initialScrollState.clientHeight).toBeGreaterThan(
      initialScrollState.scrollHeight - 40,
    );

    await treeModal.locator(".tree-row__content", { hasText: "Branch alpha" }).click();
    await treeModal.getByRole("button", { name: "Continue" }).click();
    await expect(window.getByTestId("tree-summary-step")).toBeVisible();
    await treeModal.getByRole("button", { name: "No summary" }).click();
    await treeModal.getByRole("button", { name: "Switch branch" }).click();

    await expect(treeModal).toHaveCount(0);
    await expect(composer).toHaveValue("Branch alpha");
    await expect(window.getByTestId("transcript")).toContainText("Root answer");
    await expect(window.getByTestId("transcript")).not.toContainText("Branch beta");

    await composer.fill("/tree");
    await composer.press("Enter");
    await expect(treeModal).toBeVisible();
    await treeModal.locator(".tree-row__content", { hasText: "Beta answer" }).click();
    await treeModal.getByRole("button", { name: "Continue" }).click();
    await treeModal.getByRole("button", { name: "No summary" }).click();
    await treeModal.getByRole("button", { name: "Switch branch" }).click();

    await expect(treeModal).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(window.getByTestId("transcript")).toContainText("Branch beta");
    await expect(window.getByTestId("transcript")).toContainText("Beta answer");

    await window.keyboard.press(desktopShortcut("Shift+O"));
    const newThreadComposer = window.getByTestId("new-thread-composer");
    await expect(newThreadComposer).toBeVisible();
    await newThreadComposer.fill("/tree");
    await expect(window.getByTestId("slash-menu")).toHaveCount(0);
    await newThreadComposer.press("Enter");
    await expect(window.getByTestId("composer-error-banner")).toContainText(
      "/tree is only available inside an existing session.",
    );
    await expect(newThreadComposer).toHaveValue("/tree");
  } finally {
    await harness.close();
  }
});

test("renders tool results with compact previews in the tree modal", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tree-tool-command-workspace");
  await seedAgentDir(agentDir);
  const fixture = await seedToolResultTreeSessionFixture(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await selectSession(window, fixture.title);
    await waitForSelectedSessionReady(window, fixture);

    const composer = window.getByTestId("composer");
    await composer.fill("/tree");
    await expect(window.getByTestId("slash-menu")).toContainText("Tree");
    await composer.press("Enter");

    const treeModal = window.getByTestId("tree-modal");
    await expect(treeModal).toBeVisible();
    await expect(treeModal).toContainText("[read:");
    await expect(treeModal).toContainText("assistant: README inspected.");
    await expect(treeModal.getByRole("button", { name: "No tools" })).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
