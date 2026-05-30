import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  resolveAppBundleExecutable,
} from "../helpers/electron-app";
import type { TimelineToolCall } from "../../src/timeline-types";
import { getFrontmostAppName, resetAppInBackground } from "../helpers/macos-ui";

const installedAppBundle = "/Applications/pi-gui.app";
const targetApp = "Calculator";

test("installed app runs Computer Use through the real UI without foregrounding the target app", async () => {
  test.setTimeout(240_000);
  const realAuth = getRealAuthConfig();
  test.skip(!realAuth.enabled, realAuth.skipReason);

  const userDataDir = await makeUserDataDir("pi-gui-installed-computer-use-live-");
  const workspacePath = await makeWorkspace("installed-computer-use-live-workspace");
  const executablePath = await resolveAppBundleExecutable(installedAppBundle);

  const harness = await launchDesktopByExecutable(executablePath, userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    realAuthSourceDir: realAuth.sourceDir,
    envOverrides: {
      PI_GUI_DISABLE_BUILTIN_COMPUTER_USE: undefined,
      PI_GUI_COMPUTER_USE_ALLOW_PHYSICAL_INPUT: "0",
      PI_GUI_COMPUTER_USE_AUTO_ALLOW: "1",
      PI_GUI_COMPUTER_USE_CURSOR_DURATION_MS: "8000",
      PI_GUI_COMPUTER_USE_CURSOR_GLIDE_MS: "300",
      PI_GUI_COMPUTER_USE_HELPER_PATH: undefined,
      PI_GUI_COMPUTER_USE_LOCKED_USE_INSTALLER_PATH: undefined,
      PI_GUI_COMPUTER_USE_SHOW_CURSOR: "1",
      PI_GUI_COMPUTER_USE_TEST_FORBID_MOUSE_WARP: "1",
    },
  });

  try {
    const window = await harness.firstWindow();
    await expect
      .poll(async () =>
        harness.electronApp.evaluate(() => ({
          defaultApp: Boolean(process.defaultApp),
          execPath: process.execPath,
        })),
      )
      .toEqual({
        defaultApp: false,
        execPath: executablePath,
      });

    const initialFrontmostApp = await getFrontmostAppName();
    test.skip(initialFrontmostApp === targetApp, `${targetApp} is already frontmost; focus-safety result would be ambiguous.`);
    await resetAppInBackground(targetApp);
    await expect.poll(() => getFrontmostAppName(), { timeout: 5_000 }).not.toBe(targetApp);

    await createNamedThread(window, "Installed Computer Use live");
    const composer = window.getByTestId("composer");
    await composer.fill(
      [
        "Use Computer Use to calculate 9+6 in Calculator using button clicks, not type_text.",
        "Do not open or activate Calculator; it is already running in the background.",
        "After the final Calculator click, call get_app_state and use only the displayed Calculator result from that state.",
        "Reply exactly:",
        "RESULT: <number>",
        "TOOL_ERRORS: <yes/no>",
      ].join("\n"),
    );
    await composer.press("Enter");

    const focusSamples: string[] = [];
    const focusSampleErrors: string[] = [];
    let sampleFocus = true;
    const focusProbe = sampleFrontmostApps(focusSamples, focusSampleErrors, () => sampleFocus);
    try {
      const transcript = window.getByTestId("transcript");
      await expect(transcript).toContainText(/RESULT:\s*15/i, { timeout: 210_000 });
      await expect(transcript).toContainText(/TOOL_ERRORS:\s*no/i, { timeout: 210_000 });
      await waitForSelectedSessionIdle(window);

      const toolCalls = await selectedToolCalls(window);
      expect(toolCalls.some((call) => call.toolName === "click" && inputApp(call.input) === targetApp)).toBe(true);
      expect(
        toolCalls.some(
          (call) =>
            call.toolName === "get_app_state" &&
            call.status === "success" &&
            inputApp(call.input) === targetApp &&
            calculatorDisplays(toolOutputText(call.output), "15"),
        ),
      ).toBe(true);
      expect(toolCalls.some((call) => call.toolName === "type_text")).toBe(false);
      await expect(window.locator(".timeline-tool--error")).toHaveCount(0);
      await expect(transcript).not.toContainText(/terminated/i);
    } finally {
      sampleFocus = false;
      await focusProbe;
    }
    expect(focusSampleErrors).toEqual([]);
    expect(focusSamples.length).toBeGreaterThan(0);
    expect(focusSamples).not.toContain(targetApp);
  } finally {
    await harness.close();
  }
});

async function waitForSelectedSessionIdle(window: Page): Promise<void> {
  await expect
    .poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
      const session = workspace?.sessions.find((entry) => entry.id === state.selectedSessionId);
      return session?.status ?? "";
    }, { timeout: 210_000 })
    .toBe("idle");
}

async function selectedToolCalls(window: Page): Promise<TimelineToolCall[]> {
  const selectedTranscript = await getSelectedTranscript(window);
  return (selectedTranscript?.transcript ?? []).filter(
    (item): item is TimelineToolCall => item.kind === "tool",
  );
}

function inputApp(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  return typeof input.app === "string" ? input.app : undefined;
}

function toolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (isRecord(output) && Array.isArray(output.content)) {
    return output.content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
      .join("\n");
  }
  return output === undefined || output === null ? "" : JSON.stringify(output);
}

function calculatorDisplays(text: string, expected: string): boolean {
  const expectedPattern = new RegExp(`(^|\\D)${escapeRegExp(expected)}(\\D|$)`);
  return text.split(/\r?\n/).some((line) => {
    const content = accessibilityTreeLineContent(line);
    if (!looksLikeCalculatorDisplayContent(content)) {
      return false;
    }
    return expectedPattern.test(content);
  });
}

function accessibilityTreeLineContent(line: string): string {
  return normalizeDisplayText(line).replace(/^\s*\d+\s+/, "");
}

function looksLikeCalculatorDisplayContent(content: string): boolean {
  return /^(text|static text|edit field)\b/i.test(content) || /\bValue:\s*/i.test(content);
}

function normalizeDisplayText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function sampleFrontmostApps(
  samples: string[],
  errors: string[],
  shouldContinue: () => boolean,
): Promise<void> {
  while (shouldContinue()) {
    try {
      samples.push(await getFrontmostAppName());
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
