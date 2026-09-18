# Architecture and staged ownership

Keep the workspace split and upstream Pi runtime. Organize code around the owner of behavior and mutable state; moving files alone does not establish a boundary. This guide records the accepted direction. The target layout below is a migration plan, not a claim that every owner or guard exists today.

## Current execution path

The renderer calls `window.piApp` through preload. Electron main routes the request through per-window handling to `DesktopAppStore`; the store coordinates the Pi SDK driver, catalog, attachments, and platform services. The driver delegates agent execution to upstream Pi.

Start tracing in [main](../apps/desktop/electron/main.ts), [store](../apps/desktop/electron/app-store.ts), and [driver](../packages/pi-sdk-driver/src). Renderer, preload, and main remain separate bundles configured by [electron-vite](../apps/desktop/electron.vite.config.mjs).

The store currently shares one catalog instance with the driver and worktree manager. Its method groups can access broad mutable store internals. Main also serializes actions while installing the sender window's selection into shared state. Preserve that serialization until explicit session targets and equivalent regression coverage replace the dependency; it is not safe to remove it as a folder cleanup.

## Ownership contract

| Boundary            | Responsibility                                            | Interface and dependency rule                                                                                                                |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer features   | Interaction, presentation, local view state               | Call the narrow preload API; never import Node, main, or runtime implementation.                                                             |
| Desktop contracts   | Browser-safe IPC requests, snapshots, shared values       | Both sides depend on these definitions; contracts must not depend on React, Electron, or the Pi implementation.                              |
| Preload and IPC     | Allowlisted transport, request validation, sender context | Route validated requests to owners; do not expose general filesystem or process access.                                                      |
| Window owner        | Per-window selection and snapshot projection              | Session commands receive explicit validated targets; selection is not shared session identity.                                               |
| Conversation owner  | Session commands, drafts, runtime-event projection        | Use session-driver contracts and the Pi adapter; keep mutable session state private.                                                         |
| Workspace owner     | Add, rename, remove, worktree use cases                   | Coordinate catalog writers and in-flight work through bounded operations. Stale work must not undo accepted rename/removal.                  |
| Orchestration owner | Child-thread policy, supervision, evidence                | Request conversation/workspace operations rather than mutating their internals.                                                              |
| Persistence owners  | Decode and write their own durable values                 | Catalog backend owns metadata writes; desktop persistence owns UI state and attachments. Reject malformed data without destructive recovery. |
| Platform adapters   | Terminal, dialogs, notifications, updates                 | Main-only narrow capabilities; renderer receives only the needed request/result shapes.                                                      |

The workspace lifecycle rule is an intended invariant. A previously observed intermittent removal failure does not establish a race as its root cause.

Keep `packages/session-driver` authoritative for portable session contracts, `packages/catalogs` for catalog contracts, and `packages/pi-sdk-driver` thin over upstream Pi. Do not redeclare owned package interfaces in ambient vendor files. A catalog backend move must first account for every writer and preserve the shared instance's coordination semantics.

## Target placement

Create these groups only as coherent responsibilities are extracted:

```text
apps/desktop/
  contracts/             browser-safe desktop API and values
  electron/
    main/
      application/       composition and snapshot projection
      windows/           window views and sender context
      ipc/               request validation and routing
      conversation/      session commands, drafts, events
      workspace/         workspace/worktree operations
      orchestration/     child-thread policy and supervision
      settings/          preference operations
      persistence/       UI state and attachment storage
      platform/          operating-system adapters
    preload/             narrow transport adapter
  src/
    app/                 screen composition
    features/
      conversation/      composer and transcript
      threads/           sidebar, search, navigation
      workbench/         files, diffs, terminal presentation
      settings/
      extensions/
    ui/                  shared visual primitives
    styles/              global tokens and base styles
```

For example, a remove-workspace menu belongs in renderer `features/threads`. Its request crosses preload and IPC to the workspace owner, which coordinates pending work and the catalog mutation. The window owner then chooses a valid remaining selection. Background session activity must not independently recreate the removed workspace. This is the proposed ownership flow; existing entrypoints must be traced during migration.

Keep desktop packaging with desktop, repository checks at root, website independent, and video/media generation explicitly owned as tooling. Do not remove packaging dependencies based only on missing direct imports: packaged runtime validation exists because bundling and pnpm dependency staging have additional requirements. Preserve historical media and user artifacts.

## Migration and proof

1. **Protect saved data.** Validate provider and catalog input before mutation; retain invalid originals and actionable errors. Test malformed fixtures and exercise affected settings/catalog UI.
2. **Unify contracts.** Remove owned ambient copies and move desktop-only contracts out of renderer implementation. Typecheck all consumers and prove forbidden dependencies fail.
3. **Make session targets explicit.** Separate window selection from shared session state while retaining required serialization. Verify two-window/session switching, submit, stop, and background activity.
4. **Extract owners.** Replace whole-store access with bounded operations, one responsibility at a time. Verify persistence/restart and lifecycle failures before changing writer placement.
5. **Group renderer features.** Move coherent features and update imports without leaving parallel production paths. Exercise each changed user flow in Electron.
6. **Consolidate support where useful.** Retain one Electron launcher, desktop-owned fixtures, and clear media producers/consumers. Native and packaged changes require their own evidence.

Instruction corrections can land independently of these stages. Each implementation must report what actually moved and what remains proposed. Proposed guards require a representative rejected violation, restoration of valid code, and a passing normal check; prose alone does not enforce ownership.

Use [baseline checks](ci-baseline.md), [desktop lane commands](../apps/desktop/README.md), and the [verification skill](../.agents/skills/verify-pi-gui/SKILL.md). Distinguish static/unit checks, fixture-backed Electron, deterministic runtime integration, real-provider conversations, native OS, and packaged-app evidence. A passing settings smoke or skipped real-auth test does not establish conversation behavior.
