import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { assertExists, createSession, getDesktopState, launchDesktop, makeWorkspace, writeProjectExtension } from "./harness";

const extensionSource = String.raw`
export default function dialogExtension(pi) {
  pi.registerCommand("dialog-confirm", {
    description: "Open a confirmation dialog",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Confirm change?", "Approve this change.");
      ctx.ui.notify(confirmed ? "Confirm accepted" : "Confirm rejected", "info");
    },
  });

  pi.registerCommand("dialog-select", {
    description: "Open a select dialog",
    handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Pick an option", ["Alpha", "Beta"]);
      ctx.ui.notify(value ? "Selected " + value : "Select cancelled", "info");
    },
  });

  pi.registerCommand("dialog-input", {
    description: "Open an input dialog",
    handler: async (_args, ctx) => {
      const value = await ctx.ui.input("Enter a value", "type here");
      ctx.ui.notify(value ? "Input " + value : "Input cancelled", "info");
    },
  });

  pi.registerCommand("dialog-editor", {
    description: "Open an editor dialog",
    handler: async (_args, ctx) => {
      const value = await ctx.ui.editor("Edit note", "Line 1");
      ctx.ui.notify(value ? "Editor lines " + value.split("\n").length : "Editor cancelled", "info");
    },
  });
}
`;

test("renders extension dialogs in the Electron surface and routes responses back to the session", async () => {
  test.setTimeout(60_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-user-data-"));
  const workspacePath = await makeWorkspace("extensions-dialogs-workspace");
  await writeProjectExtension(workspacePath, "dialog-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, [workspacePath]);

  try {
    const window = await harness.firstWindow();
    const state = await getDesktopState(window);
    const workspace = state.workspaces[0];
    assertExists(workspace, "Expected workspace");
    await createSession(window, workspace.id, "Dialog session");

    const composer = window.getByTestId("composer");

    await composer.fill("/dialog-confirm ");
    await composer.press("Enter");
    const dialog = window.getByTestId("extension-dialog");
    await expect(dialog).toContainText("Confirm change?");
    await expect(dialog).toContainText("Approve this change.");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.locator(".timeline")).toContainText("Confirm accepted");

    await composer.fill("/dialog-select ");
    await composer.press("Enter");
    await expect(dialog).toContainText("Pick an option");
    await dialog.getByRole("button", { name: "Beta", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.locator(".timeline")).toContainText("Selected Beta");

    await composer.fill("/dialog-input ");
    await composer.press("Enter");
    await expect(dialog).toContainText("Enter a value");
    await dialog.getByPlaceholder("type here").fill("typed value");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.locator(".timeline")).toContainText("Input typed value");

    await composer.fill("/dialog-editor ");
    await composer.press("Enter");
    await expect(dialog).toContainText("Edit note");
    const editor = dialog.locator("textarea");
    await editor.click();
    await editor.press("Meta+A");
    await editor.press("Backspace");
    await editor.type("Line 1");
    await editor.press("Enter");
    await editor.type("Line 2");
    await expect(editor).toHaveValue("Line 1\nLine 2");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.locator(".timeline")).toContainText("Editor lines 2");
  } finally {
    await harness.close();
  }
});
