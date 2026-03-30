import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("boots an existing workspace and starts a new thread through the real UI", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("core-smoke-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();

    const prompt = window.getByLabel("New thread prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(window.getByRole("heading", { name: "Let's build" })).toBeVisible();

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.locator(".topbar__session")).toHaveText("New thread");
    await expect(window.getByTestId("composer")).toBeFocused();
    await expect(window.getByTestId("transcript")).toContainText("Send a prompt to start the session.");
  } finally {
    await harness.close();
  }
});
