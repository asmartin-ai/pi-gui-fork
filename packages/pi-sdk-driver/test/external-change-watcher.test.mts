import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExternalChangeWatcher,
  diffSessionSnapshots,
  isIgnoredWatchFilename,
  type ExternalChangeEvent,
} from "../dist/external-change-watcher.js";

const DEBOUNCE = 60;
const SETTLE = 500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-watch-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Collects flushed event batches from a watcher. */
function collector() {
  const batches: ExternalChangeEvent[][] = [];
  return {
    onChange: (events: readonly ExternalChangeEvent[]) => batches.push([...events]),
    batches,
    all: () => batches.flat(),
    types: () => batches.flat().map((e) => e.type),
  };
}

test("isIgnoredWatchFilename ignores .lease and .tmp, keeps .jsonl", () => {
  assert.equal(isIgnoredWatchFilename("2026_abc.jsonl.lease"), true);
  assert.equal(isIgnoredWatchFilename("catalog.json.1234.5.ab.tmp"), true);
  assert.equal(isIgnoredWatchFilename("2026_abc.jsonl"), false);
});

test("diffSessionSnapshots classifies added / changed / removed", () => {
  const prev = new Map([["a.jsonl", 1], ["b.jsonl", 2]]);
  const next = new Map([["b.jsonl", 9], ["c.jsonl", 3]]);
  const events = diffSessionSnapshots("/d", prev, next);
  const byType = (arr: ExternalChangeEvent[]) => [...arr].sort((x, y) => x.type.localeCompare(y.type));
  assert.deepEqual(byType(events), byType([
    { type: "sessionAdded", sessionFile: "/d/c.jsonl" },
    { type: "sessionFileChanged", sessionFile: "/d/b.jsonl" },
    { type: "sessionRemoved", sessionFile: "/d/a.jsonl" },
  ]));
});

test("fires on create, append, and delete of session files", async () => {
  await withTempDir(async (dir) => {
    const c = collector();
    const watcher = new ExternalChangeWatcher({ sessionDirs: [dir], debounceMs: DEBOUNCE, onChange: c.onChange });
    try {
      const file = join(dir, "s.jsonl");
      await writeFile(file, "one\n");
      await wait(SETTLE);
      assert.deepEqual(c.all().at(-1), { type: "sessionAdded", sessionFile: file });

      await wait(30);
      await appendFile(file, "two\n");
      await wait(SETTLE);
      assert.deepEqual(c.all().at(-1), { type: "sessionFileChanged", sessionFile: file });

      await rm(file);
      await wait(SETTLE);
      assert.deepEqual(c.all().at(-1), { type: "sessionRemoved", sessionFile: file });
    } finally {
      watcher.dispose();
    }
  });
});

test("debounce coalesces a burst of appends into a single flush", async () => {
  await withTempDir(async (dir) => {
    const c = collector();
    const watcher = new ExternalChangeWatcher({ sessionDirs: [dir], debounceMs: DEBOUNCE, onChange: c.onChange });
    try {
      const file = join(dir, "s.jsonl");
      await writeFile(file, "0\n");
      await wait(SETTLE);
      const batchesAfterCreate = c.batches.length;

      for (let i = 0; i < 6; i++) {
        await appendFile(file, `${i}\n`);
      }
      await wait(SETTLE);

      const burstBatches = c.batches.slice(batchesAfterCreate);
      assert.equal(burstBatches.length, 1, "burst collapses to one flush");
      assert.deepEqual(burstBatches[0], [{ type: "sessionFileChanged", sessionFile: file }]);
    } finally {
      watcher.dispose();
    }
  });
});

test("a .lease write does not produce a sessionFileChanged", async () => {
  await withTempDir(async (dir) => {
    const c = collector();
    const watcher = new ExternalChangeWatcher({ sessionDirs: [dir], debounceMs: DEBOUNCE, onChange: c.onChange });
    try {
      const file = join(dir, "s.jsonl");
      await writeFile(file, "one\n");
      await wait(SETTLE);
      const afterCreate = c.batches.length;

      await writeFile(`${file}.lease`, "{}\n");
      await writeFile(join(dir, "s.jsonl.1.2.ab.tmp"), "partial");
      await wait(SETTLE);

      assert.equal(c.batches.length, afterCreate, "lease/tmp churn triggers no flush");
    } finally {
      watcher.dispose();
    }
  });
});

test("settings changes fire settingsChanged, including atomic rename-replace", async () => {
  await withTempDir(async (dir) => {
    const settings = join(dir, "settings.json");
    await writeFile(settings, "{}\n");
    const c = collector();
    const watcher = new ExternalChangeWatcher({ settingsFiles: [settings], debounceMs: DEBOUNCE, onChange: c.onChange });
    try {
      // Atomic write: temp file (ignored) then rename over the real settings file.
      const tmp = join(dir, "settings.json.9.1.cd.tmp");
      await writeFile(tmp, '{"a":1}\n');
      await rename(tmp, settings);
      await wait(SETTLE);

      assert.deepEqual(c.all().at(-1), { type: "settingsChanged", path: settings });
      assert.ok(c.all().every((e) => e.type === "settingsChanged"), "no spurious event types");
    } finally {
      watcher.dispose();
    }
  });
});

test("dispose stops watching and cancels a pending flush (no leaked handles)", async () => {
  await withTempDir(async (dir) => {
    const c = collector();
    const before = handleCount();
    const watcher = new ExternalChangeWatcher({ sessionDirs: [dir], debounceMs: DEBOUNCE, onChange: c.onChange });

    // Queue an event inside the debounce window, then dispose before it flushes.
    await writeFile(join(dir, "s.jsonl"), "x");
    watcher.dispose();
    await wait(SETTLE);
    assert.equal(c.batches.length, 0, "pending flush is cancelled by dispose");

    // Further changes after dispose are ignored.
    await writeFile(join(dir, "t.jsonl"), "y");
    await wait(SETTLE);
    assert.equal(c.batches.length, 0, "no callbacks after dispose");

    watcher.dispose(); // idempotent
    assert.ok(handleCount() <= before, "no FSWatcher handle leaked past dispose");
  });
});

function handleCount(): number {
  // process._getActiveHandles is undocumented but stable enough for a leak check.
  const get = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  return typeof get === "function" ? get.call(process).length : 0;
}
