import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionSupervisor } from "../dist/index.js";
import { JsonCatalogStore } from "@pi-gui/catalogs/node";

const timestamp = "2026-07-27T00:00:00.000Z";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function withBlockingWorkspaceUpserts(store) {
  let nextBlock;
  return {
    catalog: {
      workspaces: {
        ...store.workspaces,
        upsertWorkspace: async (entry) => {
          const block = nextBlock;
          nextBlock = undefined;
          if (block) {
            block.entered.resolve();
            await block.release.promise;
          }
          await store.workspaces.upsertWorkspace(entry);
        },
      },
      sessions: store.sessions,
      worktrees: store.worktrees,
      getSessionFile: (sessionRef) => store.getSessionFile(sessionRef),
      setSessionFile: (sessionRef, sessionFile) => store.setSessionFile(sessionRef, sessionFile),
      deleteSessionFile: (sessionRef) => store.deleteSessionFile(sessionRef),
      replaceWorkspaceSessions: (workspaceId, entries, sessionFiles) =>
        store.replaceWorkspaceSessions(workspaceId, entries, sessionFiles),
    },
    blockNextUpsert() {
      const block = { entered: deferred(), release: deferred() };
      nextBlock = block;
      return block;
    },
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-catalog-store-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await test("desktop and driver catalog owners preserve each other's records", async () => {
  await withTempDir(async (dir) => {
    const catalogFilePath = join(dir, "catalogs.json");
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);

    const desktopCatalog = new JsonCatalogStore({ catalogFilePath });
    await desktopCatalog.worktrees.listWorktrees();

    const supervisor = new SessionSupervisor({
      catalogFilePath,
      catalogStorage: desktopCatalog,
    });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");
    await desktopCatalog.worktrees.upsertWorktree({
      worktreeId: join(dir, "worktree"),
      workspaceId: workspace.workspaceId,
      path: join(dir, "worktree"),
      displayName: "Worktree",
      kind: "linked",
      status: "ready",
      branchName: "pi/worktree",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const persisted = JSON.parse(await readFile(catalogFilePath, "utf8")) as {
      workspaces: Array<{ workspaceId: string }>;
      worktrees: Array<{ worktreeId: string }>;
    };
    assert.deepEqual(
      persisted.workspaces.map((entry) => entry.workspaceId),
      [workspace.workspaceId],
    );
    assert.deepEqual(
      persisted.worktrees.map((entry) => entry.worktreeId),
      [join(dir, "worktree")],
    );
  });
});

await test("workspace removal wins over a touch that was already in flight", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalogs.json") });
    const controlled = withBlockingWorkspaceUpserts(store);
    const supervisor = new SessionSupervisor({ catalogStorage: controlled.catalog });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");

    const block = controlled.blockNextUpsert();
    const staleTouch = supervisor.registerWorkspace(workspacePath, "Stale workspace");
    await block.entered.promise;
    const removal = supervisor.removeWorkspace(workspace.workspaceId);
    block.release.resolve();
    await Promise.all([staleTouch, removal]);

    assert.equal(await store.workspaces.getWorkspace(workspace.workspaceId), undefined);
  });
});

await test("workspace rename wins over an older metadata touch", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalogs.json") });
    const controlled = withBlockingWorkspaceUpserts(store);
    const supervisor = new SessionSupervisor({ catalogStorage: controlled.catalog });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");

    const block = controlled.blockNextUpsert();
    const staleTouch = supervisor.registerWorkspace(workspacePath, "Stale workspace");
    await block.entered.promise;
    const rename = supervisor.renameWorkspace(workspace.workspaceId, "Renamed workspace");
    block.release.resolve();
    await Promise.all([staleTouch, rename]);

    const persisted = await store.workspaces.getWorkspace(workspace.workspaceId);
    assert.equal(persisted?.displayName, "Renamed workspace");
  });
});

await test("a metadata touch that reaches the queue after removal cannot re-add the workspace", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalogs.json") });
    const supervisor = new SessionSupervisor({ catalogStorage: store });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");

    await supervisor.removeWorkspace(workspace.workspaceId);
    await supervisor.touchWorkspace(workspace.workspaceId);

    assert.equal(await store.workspaces.getWorkspace(workspace.workspaceId), undefined);
  });
});

await test("a metadata touch that reaches the queue after rename preserves the accepted name", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalogs.json") });
    const supervisor = new SessionSupervisor({ catalogStorage: store });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");

    await supervisor.renameWorkspace(workspace.workspaceId, "Renamed workspace");
    await supervisor.touchWorkspace(workspace.workspaceId);

    const persisted = await store.workspaces.getWorkspace(workspace.workspaceId);
    assert.equal(persisted?.displayName, "Renamed workspace");
  });
});

await test("explicit registration can add a workspace again after removal", async () => {
  await withTempDir(async (dir) => {
    const workspacePath = join(dir, "workspace");
    await mkdir(workspacePath);
    const store = new JsonCatalogStore({ catalogFilePath: join(dir, "catalogs.json") });
    const supervisor = new SessionSupervisor({ catalogStorage: store });
    const workspace = await supervisor.registerWorkspace(workspacePath, "Workspace");

    await supervisor.removeWorkspace(workspace.workspaceId);
    await supervisor.registerWorkspace(workspacePath, "Registered again");

    const persisted = await store.workspaces.getWorkspace(workspace.workspaceId);
    assert.equal(persisted?.displayName, "Registered again");
  });
});
