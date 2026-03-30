import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeTinyPng,
} from "../helpers/electron-app";
import { acceptOpenImageDialog } from "../helpers/macos-ui";

test("attaches an image through the native picker and shows the attachment chip", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("native-attach-image-workspace");
  const imageDir = await mkdtemp(join(tmpdir(), "pi-gui-native-image-"));
  const imagePath = join(imageDir, "screenshot.png");
  await writeTinyPng(imagePath);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "foreground",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Image attach session");
    await harness.focusWindow();

    await window.getByRole("button", { name: "Attach image" }).click();
    await acceptOpenImageDialog(imagePath);

    await expect(window.locator(".composer-attachment")).toContainText("screenshot.png");
    await window.getByRole("button", { name: "Remove screenshot.png" }).click();
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
