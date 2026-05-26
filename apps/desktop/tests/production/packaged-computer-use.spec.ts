import { expect, test } from "@playwright/test";
import { extractFile, listPackage } from "@electron/asar";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePackagedAppBundle } from "../helpers/electron-app";

const expectedComputerUseTools = [
  "click",
  "drag",
  "get_app_state",
  "list_apps",
  "perform_secondary_action",
  "press_key",
  "scroll",
  "select_text",
  "set_value",
  "type_text",
];

interface HelperResponse {
  readonly ok: boolean;
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

test("packaged app carries the built-in Computer Use helper and extension", async () => {
  test.setTimeout(60_000);
  const appBundle = await resolvePackagedAppBundle();
  const appAsar = join(appBundle, "Contents", "Resources", "app.asar");
  const helperPath = join(appBundle, "Contents", "MacOS", "pi-gui-computer-use-helper");

  await access(helperPath);

  const files = listPackage(appAsar);
  expect(files).toContain("/out/computer-use-extension/package.json");
  expect(files).toContain("/out/computer-use-extension/dist/index.js");

  const packageJson = JSON.parse(
    extractFile(appAsar, "out/computer-use-extension/package.json").toString("utf8"),
  ) as {
    dependencies?: Record<string, string>;
    pi?: { extensions?: string[] };
  };
  expect(packageJson.pi?.extensions).toEqual(["./dist/index.js"]);
  expect(packageJson.dependencies).toBeUndefined();

  const extensionSource = extractFile(appAsar, "out/computer-use-extension/dist/index.js").toString("utf8");
  expect(extensionSource).not.toContain("@earendil-works/");
  expect(extensionSource).not.toContain("Computer Use ready");
  expect(extensionSource).not.toContain("Pi is using your computer");
  expect(extensionSource).toContain("plus, equals");
  for (const toolName of expectedComputerUseTools) {
    expect(extensionSource).toContain(`name: "${toolName}"`);
  }

  const helperSource = await readFile(helperPath, "latin1");
  for (const keyAlias of ["plus", "equals", "kp_add", "numpad_enter"]) {
    expect(helperSource).toContain(keyAlias);
  }

  const mainSource = extractFile(appAsar, "out/main/main.js").toString("utf8");
  expect(mainSource).not.toContain("getAgentDir");
  expect(mainSource).not.toContain("@earendil-works/pi-coding-agent");

  const helperResponse = await runPackagedHelper(helperPath, { command: "list_apps" });
  expect(helperResponse.ok).toBe(true);
  expect(helperResponse.content?.[0]?.type).toBe("text");
  expect(helperResponse.content?.[0]?.text).toContain("Finder");
});

function runPackagedHelper(helperPath: string, request: Record<string, unknown>): Promise<HelperResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as HelperResponse);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
