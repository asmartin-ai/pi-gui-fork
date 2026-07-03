import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TMP_SUFFIX } from "./atomic-write.js";
import { LEASE_SUFFIX } from "./session-lease.js";

/**
 * Filesystem-watcher foundation for CLI ↔ GUI sync.
 *
 * The GUI otherwise has no live detection of external changes: when the pi CLI
 * creates a session, appends a turn, or edits a settings file while the GUI is
 * open, nothing updates until a manual workspace re-select or restart. This
 * module watches a workspace's pi session directory and an explicit set of
 * settings files, coalescing bursts into debounced, typed events the app layer
 * can translate into `syncWorkspace` / transcript-reload / `SettingsManager.reload`.
 *
 * Design notes:
 * - Uses `node:fs.watch` (FSEvents on darwin) — no chokidar. See the module test
 *   for the darwin verification. Because macOS coalesces events and occasionally
 *   reports the directory's own name (or a null filename), we never trust event
 *   *types*: a raw event only schedules a debounced re-scan, and session events
 *   are derived by diffing a fresh `readdir` + `mtime` snapshot against the
 *   previous one. That makes detection resilient to missed/merged raw events.
 * - Watches settings files via their *parent directory* (matching by basename)
 *   so an atomic rename-replace of the file does not orphan the watch.
 * - Ignores our own advisory `.lease` files and `.tmp` atomic-write artifacts, so
 *   lease churn and half-written temp files never surface as changes.
 */

export type ExternalChangeEvent =
  | { readonly type: "sessionAdded"; readonly sessionFile: string }
  | { readonly type: "sessionRemoved"; readonly sessionFile: string }
  | { readonly type: "sessionFileChanged"; readonly sessionFile: string }
  | { readonly type: "settingsChanged"; readonly path: string };

export interface ExternalChangeWatcherOptions {
  /** Session directories (flat `.jsonl` files) to watch for add/remove/change. */
  readonly sessionDirs?: readonly string[];
  /** Absolute settings file paths to watch for content changes. */
  readonly settingsFiles?: readonly string[];
  /** Debounce/coalesce window in ms (default 300). */
  readonly debounceMs?: number;
  /** Called once per debounced flush with the coalesced events (never empty). */
  readonly onChange: (events: readonly ExternalChangeEvent[]) => void;
}

const DEFAULT_DEBOUNCE_MS = 300;

/** True for filenames we never treat as a real change (our own artifacts). */
export function isIgnoredWatchFilename(name: string): boolean {
  return name.endsWith(LEASE_SUFFIX) || name.endsWith(TMP_SUFFIX);
}

type SessionSnapshot = Map<string, number>;

/** Pure diff of two `basename -> mtimeMs` snapshots into session events. */
export function diffSessionSnapshots(dir: string, prev: SessionSnapshot, next: SessionSnapshot): ExternalChangeEvent[] {
  const events: ExternalChangeEvent[] = [];
  for (const [name, mtime] of next) {
    const before = prev.get(name);
    if (before === undefined) {
      events.push({ type: "sessionAdded", sessionFile: join(dir, name) });
    } else if (before !== mtime) {
      events.push({ type: "sessionFileChanged", sessionFile: join(dir, name) });
    }
  }
  for (const name of prev.keys()) {
    if (!next.has(name)) {
      events.push({ type: "sessionRemoved", sessionFile: join(dir, name) });
    }
  }
  return events;
}

function isSessionFile(name: string): boolean {
  return name.endsWith(".jsonl");
}

async function snapshotSessionDir(dir: string): Promise<SessionSnapshot> {
  const snapshot: SessionSnapshot = new Map();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return snapshot;
  }
  await Promise.all(
    names.filter(isSessionFile).map(async (name) => {
      try {
        snapshot.set(name, (await stat(join(dir, name))).mtimeMs);
      } catch {
        // File vanished between readdir and stat; skip it.
      }
    }),
  );
  return snapshot;
}

export class ExternalChangeWatcher {
  private readonly onChange: ExternalChangeWatcherOptions["onChange"];
  private readonly debounceMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly sessionSnapshots = new Map<string, SessionSnapshot>();
  /** dir -> set of settings basenames watched within it. */
  private readonly settingsByDir = new Map<string, Map<string, string>>();

  private readonly dirtySessionDirs = new Set<string>();
  private readonly dirtySettingsPaths = new Set<string>();
  /** Resolves once initial baselines are captured; flush awaits it. */
  private readonly ready: Promise<void>;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(options: ExternalChangeWatcherOptions) {
    this.onChange = options.onChange;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    const sessionDirs = options.sessionDirs ?? [];
    for (const dir of sessionDirs) {
      this.watchSessionDir(dir);
    }
    for (const file of options.settingsFiles ?? []) {
      this.registerSettingsFile(file);
    }
    for (const dir of this.settingsByDir.keys()) {
      this.watchSettingsDir(dir);
    }

    // Seed baselines off the synchronous constructor path. Watchers are already
    // armed above, so any event during seeding just marks a dir dirty; flush()
    // awaits `ready` before diffing, so pre-existing files are not misreported
    // as additions.
    this.ready = Promise.all(
      sessionDirs.map(async (dir) => {
        this.sessionSnapshots.set(dir, await snapshotSessionDir(dir));
      }),
    ).then(() => undefined);
  }

  private watchSessionDir(dir: string): void {
    const watcher = this.tryWatch(dir, (filename) => {
      if (filename !== null && isIgnoredWatchFilename(filename)) {
        return;
      }
      // filename may be the dir's own name or null on darwin; re-scan regardless.
      this.dirtySessionDirs.add(dir);
      this.schedule();
    });
    if (watcher) {
      this.watchers.push(watcher);
    }
  }

  private registerSettingsFile(file: string): void {
    const dir = dirname(file);
    const forDir = this.settingsByDir.get(dir) ?? new Map<string, string>();
    forDir.set(basename(file), file);
    this.settingsByDir.set(dir, forDir);
  }

  private watchSettingsDir(dir: string): void {
    const forDir = this.settingsByDir.get(dir);
    if (!forDir) {
      return;
    }
    const watcher = this.tryWatch(dir, (filename) => {
      if (filename === null) {
        // Unknown file: conservatively flag every settings file in this dir.
        for (const path of forDir.values()) {
          this.dirtySettingsPaths.add(path);
        }
        this.schedule();
        return;
      }
      if (isIgnoredWatchFilename(filename)) {
        return;
      }
      const path = forDir.get(filename);
      if (path) {
        this.dirtySettingsPaths.add(path);
        this.schedule();
      }
    });
    if (watcher) {
      this.watchers.push(watcher);
    }
  }

  private tryWatch(dir: string, onEvent: (filename: string | null) => void): FSWatcher | undefined {
    try {
      const watcher = watch(dir, { persistent: true }, (_event, filename) => {
        if (this.disposed) {
          return;
        }
        onEvent(typeof filename === "string" ? filename : null);
      });
      watcher.on("error", () => {
        // A directory removed out from under us stops the watch; do not crash.
      });
      return watcher;
    } catch {
      // Directory does not exist yet (e.g. a workspace with no sessions). The
      // caller's on-demand reconcile still picks up the first session created.
      return undefined;
    }
  }

  private schedule(): void {
    if (this.disposed || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.ready;
    if (this.disposed) {
      return;
    }
    const events: ExternalChangeEvent[] = [];

    const sessionDirs = [...this.dirtySessionDirs];
    this.dirtySessionDirs.clear();
    const scanned = await Promise.all(
      sessionDirs.map(async (dir) => [dir, await snapshotSessionDir(dir)] as const),
    );
    for (const [dir, next] of scanned) {
      const prev = this.sessionSnapshots.get(dir) ?? new Map();
      this.sessionSnapshots.set(dir, next);
      events.push(...diffSessionSnapshots(dir, prev, next));
    }

    for (const path of this.dirtySettingsPaths) {
      events.push({ type: "settingsChanged", path });
    }
    this.dirtySettingsPaths.clear();

    if (this.disposed || events.length === 0) {
      return;
    }
    try {
      this.onChange(events);
    } catch {
      // Isolate the consumer: a throwing handler must not break the watcher.
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Best effort.
      }
    }
    this.watchers.length = 0;
    this.dirtySessionDirs.clear();
    this.dirtySettingsPaths.clear();
  }
}
