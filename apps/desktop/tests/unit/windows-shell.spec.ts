import { expect, test } from "@playwright/test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWindowsShellExtension } from "../../electron/assistant/windows-shell";

/** Run the extension against a fake pi and return the `setActiveTools` calls it made. */
async function runSession(platform: NodeJS.Platform, tools: string[]): Promise<string[][]> {
  const calls: string[][] = [];
  let start: (() => void) | undefined;
  const pi = {
    on: (event: string, handler: () => void) => {
      if (event === "session_start") start = handler;
      return () => {};
    },
    getActiveTools: () => tools,
    setActiveTools: (next: string[]) => calls.push(next),
  };
  await createWindowsShellExtension(platform)(pi as unknown as ExtensionAPI);
  start?.();
  return calls;
}

test("adds pi's powershell tool on Windows", async () => {
  expect(await runSession("win32", ["read", "bash", "edit", "write"])).toEqual([
    ["read", "bash", "edit", "write", "powershell"],
  ]);
});

test("does nothing on other platforms", async () => {
  expect(await runSession("linux", ["read", "bash", "edit", "write"])).toEqual([]);
  expect(await runSession("darwin", ["read", "bash", "edit", "write"])).toEqual([]);
});

test("is idempotent when powershell is already active", async () => {
  expect(await runSession("win32", ["read", "bash", "edit", "write", "powershell"])).toEqual([]);
});
