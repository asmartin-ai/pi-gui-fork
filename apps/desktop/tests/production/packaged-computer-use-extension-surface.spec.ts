import { test } from "@playwright/test";
import { launchPackagedDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";
import { assertComputerUseExtensionSurface } from "./computer-use-extension-surface-assertions";

test("packaged app presents built-in Computer Use as a top-level extension", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("packaged-computer-use-extension-surface");
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await assertComputerUseExtensionSurface(window, workspacePath, "Packaged extension mentions");
  } finally {
    await harness.close();
  }
});
