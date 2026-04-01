import type { BrowserWindow } from "electron";
import type { DesktopAppState } from "../src/desktop-state";
import type { SessionRef } from "@pi-gui/session-driver";

export function isSessionActivelyViewed(
  state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
  sessionRef: SessionRef,
  window: BrowserWindow | null,
): boolean {
  if (!state) {
    return false;
  }
  if (state.activeView !== "threads") {
    return false;
  }
  if (state.selectedWorkspaceId !== sessionRef.workspaceId || state.selectedSessionId !== sessionRef.sessionId) {
    return false;
  }
  if (!window || window.isDestroyed() || window.isMinimized() || !window.isVisible()) {
    return false;
  }
  return window.isFocused();
}
