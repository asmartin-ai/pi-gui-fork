import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import {
  commitAllInGitRepo,
  createNamedThread,
  desktopShortcut,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);
const proofDir = process.env.PI_APP_CHANGED_FILES_PROOF_DIR;

test("preserves an exact changed-file path through diff and stage actions", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("changed-file-path");
  const filePath = " leading path -> destination.txt";
  await initGitRepo(workspacePath);
  await commitAllInGitRepo(workspacePath, "init");
  await writeFile(join(workspacePath, filePath), "exact path contents\n", "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Changed path test");
    await window.keyboard.press(desktopShortcut("D"));

    const diffPanel = window.locator(".diff-panel");
    const changedRow = diffPanel.locator(".diff-panel__file");
    await expect(changedRow).toHaveCount(1);
    await expect(changedRow).toHaveAttribute("data-file-path", filePath);

    await changedRow.locator(".diff-panel__file-name").click();
    await expect(diffPanel.locator(".diff-inline")).toContainText("exact path contents");

    await changedRow.getByRole("button", { name: "Stage", exact: true }).click();
    await expect(changedRow.getByRole("button", { name: "Staged", exact: true })).toBeDisabled();

    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--cached", "--name-only", "-z", "--", filePath],
      { cwd: workspacePath },
    );
    expect(stdout).toBe(`${filePath}\0`);

    await saveProof(window, "exact-path-staged.png");
  } finally {
    await harness.close();
  }
});

test("shows changed files as unavailable when Git status fails", async () => {
  test.setTimeout(30_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("changed-files-unavailable");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Unavailable status test");
    await window.keyboard.press(desktopShortcut("D"));

    const diffPanel = window.locator(".diff-panel");
    await expect(diffPanel.getByTestId("changed-files-unavailable")).toHaveText(
      "Git status is unavailable for this workspace.",
    );
    await expect(diffPanel.locator(".file-workbench__section-header")).toContainText(/unavailable/i);
    await expect(diffPanel.getByText("No changes", { exact: true })).toHaveCount(0);

    await saveProof(window, "git-status-unavailable.png");
  } finally {
    await harness.close();
  }
});

async function saveProof(
  window: Page,
  fileName: string,
): Promise<void> {
  if (!proofDir) {
    return;
  }
  await mkdir(proofDir, { recursive: true });
  await window.screenshot({ path: join(proofDir, fileName) });
}
