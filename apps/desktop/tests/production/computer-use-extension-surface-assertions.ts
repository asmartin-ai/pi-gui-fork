import { expect, type Page } from "@playwright/test";
import { createSessionViaIpc, selectSession, waitForWorkspaceByPath } from "../helpers/electron-app";

export async function assertComputerUseExtensionSurface(
  window: Page,
  workspacePath: string,
  sessionTitle: string,
): Promise<void> {
  await waitForWorkspaceByPath(window, workspacePath);

  await window.getByRole("button", { name: "Extensions", exact: true }).click();
  await expect(window.getByTestId("extensions-surface")).toBeVisible();

  const extensionsList = window.getByTestId("extensions-list");
  const computerUseCard = extensionsList.getByRole("button", {
    name: /Computer Use.*Built-in.*top-level/i,
  });
  await expect(computerUseCard).toBeVisible();
  await computerUseCard.click();

  const detail = window.locator(".skill-detail");
  await expect(detail).toContainText("Computer Use");
  await expect(detail).toContainText("Built-in");
  await expect(detail).toContainText("top-level");
  await expect(detail).not.toContainText("temporary");
  await expect(window.getByRole("button", { name: "Open folder", exact: true })).toHaveCount(0);
  await expect(window.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);

  await createSessionViaIpc(window, workspacePath, sessionTitle);
  await selectSession(window, sessionTitle);

  const composer = window.getByTestId("composer");
  await expect(composer).toBeVisible();
  await composer.fill("@comp");

  const mentionMenu = window.getByTestId("mention-menu");
  await expect(mentionMenu).toBeVisible();
  await expect(mentionMenu.locator(".mention-menu__section-title").first()).toHaveText("Extensions");
  await expect(mentionMenu.locator(".mention-menu__section").first()).toContainText("Computer Use");
  await expect(mentionMenu.locator(".mention-menu__section").first()).not.toContainText("temporary");
}
