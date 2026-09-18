import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionSupervisor } from "../dist/index.js";
import { JsonCatalogStore } from "@pi-gui/catalogs/node";

const timestamp = "2026-07-27T00:00:00.000Z";

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
