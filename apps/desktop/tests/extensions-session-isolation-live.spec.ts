import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { assertExists, createSession, getDesktopState, launchDesktop, makeWorkspace, writeProjectExtension } from "./harness";

const extensionSource = String.raw`
export default function isolationExtension(pi) {
  pi.registerCommand("mark-ui", {
    description: "Mark the current session with extension UI",
    handler: async (_args, ctx) => {
      ctx.ui.setTitle("Marked by extension");
      ctx.ui.setStatus("mark", "Session marked");
      ctx.ui.setWidget("mark-widget", ["Marked widget"]);
      ctx.ui.setWidget("mark-widget-below", ["Marked below"], { placement: "belowEditor" });
      ctx.ui.notify("Session marked", "info");
    },
  });
}
`;

test("keeps extension widgets, status, and title scoped to the active session", async () => {
  test.setTimeout(60_000);
  const userDataDir = await mkdtemp(join(tmpdir(), "pi-gui-user-data-"));
  const workspacePath = await makeWorkspace("extensions-isolation-workspace");
  await writeProjectExtension(workspacePath, "isolation-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, [workspacePath]);

  try {
    const window = await harness.firstWindow();
    const state = await getDesktopState(window);
    const workspace = state.workspaces[0];
    assertExists(workspace, "Expected workspace");
    await createSession(window, workspace.id, "Session A");
    await createSession(window, workspace.id, "Session B");

    const selectSession = async (title: string) => {
      await window.locator(".session-row__select").filter({ hasText: title }).click();
    };

    await selectSession("Session A");
    const composer = window.getByTestId("composer");
    await composer.fill("/mark-ui ");
    await composer.press("Enter");

    await expect(window.locator(".topbar__session")).toHaveText("Marked by extension");
    await expect(window.getByTestId("extension-dock-summary")).toHaveText("Session marked");
    await window.getByTestId("extension-dock-toggle").click();
    await expect(window.getByTestId("extension-dock-body")).toContainText("Marked widget");
    await expect(window.getByTestId("extension-dock-body")).toContainText("Marked below");

    await selectSession("Session B");
    await expect(window.locator(".topbar__session")).toHaveText("Session B");
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);

    await selectSession("Session A");
    await expect(window.locator(".topbar__session")).toHaveText("Marked by extension");
    await expect(window.getByTestId("extension-dock-summary")).toHaveText("Session marked");
    await expect(window.getByTestId("extension-dock-body")).toContainText("Marked widget");
  } finally {
    await harness.close();
  }
});
