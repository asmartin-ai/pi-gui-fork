# Archive and restore

Users hide a thread from the active sidebar and recover it from the Archived group.

## Sub-features

- `archive-hover`: reveal the archive action and archive an active thread.
- `archive-expand`: expand the collapsed Archived group.
- `archive-restore`: restore a thread to the active list.

## How to get to it (user POV)

- Hover a thread row and click its Archive action.
- Expand Archived, hover the archived row, and click Restore.

## Driving it with Playwright

Preconditions: isolated workspace with fixture threads Thread one and Thread two.

- **Primary proof:** the default conversation recipe archives and restores a real thread; see [thread continuity](thread-continuity.md).
- **Additional regression:** `pnpm --filter @pi-gui/desktop run test:e2e:runner -- apps/desktop/tests/core/archive.spec.ts`.
- **Archive:** hover the active `.session-row` for Thread two and click `getByLabel('Archive Thread two')`. The topbar switches to Thread one and `.archived-thread-group` appears collapsed.
- **Expand/restore:** click `.archived-thread-group__toggle`, require `aria-expanded="true"`, then hover the archived row and click `getByLabel('Restore Thread two')`.
- **Proof:** Thread two returns to the active session list, the now-empty archived group disappears, and read-only state confirms `archivedAt` is cleared. Capture before/archive/restore states and the actions.

## Gotchas

- The action starts invisible until hover; do not force-click it to bypass the behavior under test.
- Seeded thread creation is not part of archive proof. Archiving is not deletion.
