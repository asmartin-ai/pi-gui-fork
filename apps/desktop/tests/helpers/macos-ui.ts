import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 20_000;

const OPEN_PANEL_ACCEPT_SCRIPT = `
on run argv
  set targetPath to item 1 of argv
  set the clipboard to targetPath
  tell application "System Events"
    set targetProcess to first application process whose name is "Electron"
    set frontmost of targetProcess to true
    delay 1.0
    keystroke "g" using {command down, shift down}
    delay 0.75
    keystroke "v" using {command down}
    delay 0.3
    key code 36
    delay 1.0
    key code 36
  end tell
end run
`;

const OPEN_PANEL_CANCEL_SCRIPT = `
tell application "System Events"
  set targetProcess to first application process whose name is "Electron"
  set frontmost of targetProcess to true
  delay 0.6
  key code 53
  delay 0.6
end tell
`;

const MENU_ITEM_CLICK_SCRIPT = `
on run argv
  set menuTitle to item 1 of argv
  set menuItemTitle to item 2 of argv
  tell application "System Events"
    set targetProcess to first application process whose name is "Electron"
    set frontmost of targetProcess to true
    delay 1.0
    click menu item menuItemTitle of menu 1 of menu bar item menuTitle of menu bar 1 of targetProcess
    delay 0.6
  end tell
end run
`;

export async function assertAccessibilityReady(): Promise<void> {
  const { stdout } = await execFileAsync(
    "osascript",
    ['-e', 'tell application "System Events" to UI elements enabled'],
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  if (stdout.trim() !== "true") {
    throw new Error("macOS Accessibility permission is not enabled for UI scripting");
  }
}

export async function acceptOpenFolderDialog(pathValue: string): Promise<void> {
  await assertAccessibilityReady();
  await runAppleScript(OPEN_PANEL_ACCEPT_SCRIPT, [pathValue], DEFAULT_TIMEOUT_MS);
}

export async function cancelOpenDialog(): Promise<void> {
  await assertAccessibilityReady();
  await runAppleScript(OPEN_PANEL_CANCEL_SCRIPT, [], DEFAULT_TIMEOUT_MS);
}

export async function clickMenuItem(menuTitle: string, menuItemTitle: string): Promise<void> {
  await assertAccessibilityReady();
  await runAppleScript(MENU_ITEM_CLICK_SCRIPT, [menuTitle, menuItemTitle], DEFAULT_TIMEOUT_MS);
}

export async function acceptOpenImageDialog(pathValue: string): Promise<void> {
  await assertAccessibilityReady();
  await runAppleScript(OPEN_PANEL_ACCEPT_SCRIPT, [pathValue], DEFAULT_TIMEOUT_MS);
}

async function runAppleScript(script: string, values: readonly string[], timeoutMs: number): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", script.trim(), ...values], {
      timeout: timeoutMs,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const message = "message" in error ? String(error.message) : String(error);
      const stdout = "stdout" in error ? String(error.stdout ?? "") : "";
      const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
      const code = "code" in error ? String(error.code ?? "") : "";
      const signal = "signal" in error ? String(error.signal ?? "") : "";
      throw new Error(
        `${message}\nexit code: ${code || "<unknown>"}\nsignal: ${signal || "<none>"}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    throw new Error(String(error));
  }
}
