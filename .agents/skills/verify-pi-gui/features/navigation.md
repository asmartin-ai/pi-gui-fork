# Folders and threads

Users switch folders and conversations in the sidebar and recover the selected thread and unfinished draft after reopening the app.

## Sub-features

- `navigation-sidebar`: select threads across folders.
- `navigation-restart`: preserve selected folder, thread, and composer draft.
- `navigation-new-thread`: open the new-thread composer.

## How to get to it (user POV)

- Select a folder/thread in the sidebar.
- Click New thread in the sidebar or use the new-thread keyboard shortcut (Meta+Shift+O on macOS; Control+Shift+O elsewhere).
- Open a folder through the OS folder picker; this is a separate native entry.

## Driving it with Playwright

Preconditions: isolated profile and two fixture folders for sidebar switching.

- **Switch/restart:** run `pnpm verify --spec apps/desktop/tests/core/navigation.spec.ts`. It selects Alpha/Beta sessions through the sidebar, asserts `.topbar__session`, and checks `composer` draft and `.session-row--active` after restart.
- **New-thread entry:** run `pnpm verify --spec apps/desktop/tests/core/composer-controls.spec.ts`; `new-thread-composer` must become visible and focused after the shortcut.
- **Folder picker:** use `pnpm --filter @pi-gui/desktop run test:prod:open-folder-real` for the actual native dialog; reserve foreground input. Core `initialWorkspaces` is fixture setup, not picker proof.
- **Proof:** record the selected row, topbar title, draft before shutdown and after relaunch, with action traces. Cover sidebar and keyboard entries separately when claiming both.

## Gotchas

- `createNamedThread` uses IPC; this existing spec proves selection/draft behavior, not user-driven thread creation or provider execution.
- Injected transcript deltas establish renderer behavior only; real run proof belongs in live.
