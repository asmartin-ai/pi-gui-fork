import assert from "node:assert/strict";
import test from "node:test";
import { checkGithubReleaseState } from "./github-release-state.mjs";

const baseOptions = {
  repository: "minghinmatthewlam/pi-gui",
  tag: "v0.1.0-beta.34",
  token: "test-token",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("accepts an authoritative 404 when no release may exist yet", async () => {
  const result = await checkGithubReleaseState({
    ...baseOptions,
    fetchImpl: async () => jsonResponse(404, { message: "Not Found" }),
  });
  assert.deepEqual(result, { state: "absent" });
});

test("accepts an existing draft and authenticates the lookup", async () => {
  let request;
  const result = await checkGithubReleaseState({
    ...baseOptions,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(200, { id: 59, draft: true });
    },
  });
  assert.deepEqual(result, { state: "draft", id: 59 });
  assert.equal(
    request.url,
    "https://api.github.com/repos/minghinmatthewlam/pi-gui/releases/tags/v0.1.0-beta.34",
  );
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
});

test("rejects an already-published release", async () => {
  await assert.rejects(
    checkGithubReleaseState({
      ...baseOptions,
      fetchImpl: async () => jsonResponse(200, { id: 59, draft: false }),
    }),
    /already published/,
  );
});

test("fails closed on transport, auth, rate-limit, and API errors", async () => {
  await assert.rejects(
    checkGithubReleaseState({
      ...baseOptions,
      fetchImpl: async () => {
        throw new Error("socket closed");
      },
    }),
    /before an authoritative response/,
  );

  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      checkGithubReleaseState({
        ...baseOptions,
        fetchImpl: async () => jsonResponse(status, { message: `status ${status}` }),
      }),
      new RegExp(`HTTP ${status}`),
    );
  }
});

test("fails closed on malformed success responses", async () => {
  await assert.rejects(
    checkGithubReleaseState({
      ...baseOptions,
      fetchImpl: async () => jsonResponse(200, { id: 59 }),
    }),
    /boolean draft state/,
  );
  await assert.rejects(
    checkGithubReleaseState({
      ...baseOptions,
      fetchImpl: async () => jsonResponse(200, { draft: true }),
    }),
    /valid release id/,
  );
});

test("requires an existing draft before final publication", async () => {
  await assert.rejects(
    checkGithubReleaseState({
      ...baseOptions,
      requireDraft: true,
      fetchImpl: async () => jsonResponse(404, { message: "Not Found" }),
    }),
    /Required draft release/,
  );
});
