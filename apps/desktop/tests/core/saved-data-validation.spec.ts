import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("invalid catalog reports recovery trouble without pruning attachments across restart", async () => {
  const userDataDir = await makeUserDataDir();
  const catalogPath = join(userDataDir, "catalogs.json");
  const original = JSON.stringify({
    version: 2,
    workspaces: [],
    sessions: [null],
    worktrees: [],
    sessionFiles: {},
  });
  await writeFile(catalogPath, original);
  const attachmentPath = join(userDataDir, "attachments", "retained.json");
  await mkdir(join(userDataDir, "attachments"), { recursive: true });
  await writeFile(attachmentPath, "retained attachment evidence");

  for (let attempt = 0; attempt < 2; attempt++) {
    const harness = await launchDesktop(userDataDir, { testMode: "background" });
    try {
      const window = await harness.firstWindow();
      await expect(window.getByTestId("startup-diagnostics")).toContainText(/catalog|sessions/i);
      await expect(window.getByTestId("startup-diagnostics")).toBeVisible();
      expect(await readFile(catalogPath, "utf8")).toBe(original);
      expect(await readFile(attachmentPath, "utf8")).toBe("retained attachment evidence");
    } finally {
      await harness.close();
    }
    expect(await readFile(catalogPath, "utf8")).toBe(original);
    expect(await readFile(attachmentPath, "utf8")).toBe("retained attachment evidence");
  }
});

test("invalid providers show an error and cannot falsely save an endpoint", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspace = await makeWorkspace("invalid-providers");
  await seedAgentDir(agentDir, { enabledModels: [] });
  const modelsPath = join(agentDir, "models.json");
  const original = '{"providers":[],"retained":"user data"}\n';
  await writeFile(modelsPath, original);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspace],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    const section = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Custom endpoints" }),
    });
    await expect(section.locator(".settings-warning")).toContainText(/providers/i);
    await section.getByRole("button", { name: "Add endpoint", exact: true }).click();
    const dialog = window.getByTestId("custom-endpoint-dialog");
    await dialog.getByLabel("Provider ID").fill("saved-data-proof");
    await dialog.getByLabel("Base URL").fill("http://localhost:11434/v1");
    await dialog.getByLabel("Add model ID manually").fill("test-model");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByRole("button", { name: "Add endpoint", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/JSON object for providers/i);
    expect(await readFile(modelsPath, "utf8")).toBe(original);
  } finally {
    await harness.close();
  }
  expect(await readFile(modelsPath, "utf8")).toBe(original);
});
