import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import computerUseExtension from "../dist/index.js";

const tools = new Map();
const handlers = new Map();
computerUseExtension({
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  on(event, handler) {
    handlers.set(event, handler);
  },
});

const getAppState = tools.get("get_app_state");
assert.ok(getAppState, "get_app_state tool should be registered");

const tempDir = await mkdtemp(join(tmpdir(), "pi-gui-computer-use-extension-"));
const fakeHelperPath = join(tempDir, "fake-helper.mjs");
await writeFile(
  fakeHelperPath,
  `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const response = request.command === "status"
    ? {
        ok: true,
        content: [{ type: "text", text: "Computer Use status (Pi GUI)\\nDesktop: locked" }],
        details: { screenLocked: "true", lockedUse: "not_enabled" },
      }
    : {
        ok: false,
        error: "Computer Use is unavailable while the Mac is locked. Unlock the desktop and retry.",
        details: { errorCode: "desktop_locked", screenLocked: "true" },
      };
  process.stdout.write(JSON.stringify(response) + "\\n");
  process.exit(response.ok ? 0 : 1);
});
`,
  "utf8",
);
await chmod(fakeHelperPath, 0o755);

process.env.PI_GUI_COMPUTER_USE_HELPER_PATH = fakeHelperPath;
process.env.PI_GUI_COMPUTER_USE_AUTO_ALLOW = "1";

let thrown;
try {
  await getAppState.execute("call-locked", { app: "Calculator" }, undefined, undefined, { hasUI: false });
} catch (error) {
  thrown = error;
}
assert.ok(thrown instanceof Error, "locked helper failures should throw so the runtime records a tool error");
assert.match(thrown.message, /Computer Use blocked: the Mac is locked/);

const result = await handlers.get("tool_result")(
  {
    type: "tool_result",
    toolCallId: "call-locked",
    toolName: "get_app_state",
    input: { app: "Calculator" },
    content: [{ type: "text", text: thrown.message }],
    details: {},
    isError: true,
  },
  {},
);
const text = result.content.find((item) => item.type === "text")?.text ?? "";
assert.match(text, /Computer Use blocked: the Mac is locked/);
assert.match(text, /Run computer_use_status/);
assert.equal(result.details.errorCode, "desktop_locked");
assert.equal(result.details.screenLocked, "true");
assert.equal(result.isError, true);

const status = await tools.get("computer_use_status").execute("call-status", {}, undefined, undefined, { hasUI: false });
const statusText = status.content.find((item) => item.type === "text")?.text ?? "";
assert.match(statusText, /Desktop: locked/);
