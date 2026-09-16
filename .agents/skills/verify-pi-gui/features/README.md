# pi-gui verification map

Read this index before choosing a proof. These are the initial five feature groups, not a claim that all desktop features are covered.

## Baseline preconditions

Build the current checkout; use an isolated profile/workspace through the shared Electron harness. Run the skill's read-only doctor before driving. Use background mode for in-window flows and foreground mode for OS pickers/clipboard. Do not share input ownership or build output across concurrent runs. Provider execution requires an explicitly configured live lane; the bundled settings proof needs no login.

## Driving conventions

Commands below run from the repository root. `pnpm verify --spec` builds and runs a checked-in core spec. The skill's `scripts/prove.sh` additionally preserves successful screenshots and action traces. For a new proof, reuse that capture/teardown pattern with the existing harness. Fixture creation is not proof of the corresponding UI feature.

## Proof and skip reporting

Record feature ID, entry point, command, actual result, and evidence path. Capture action plus result and verify side effects independently. Do not mark skipped, fixture-only, or unvisited entries as passed. Expand the map when another user entry point is found. Only settings persistence is exercised by the bundled smoke; the other recipes are source-grounded starting points.

## Features

- [Settings and persistence](settings.md): Settings navigation, skill commands, restart.
- [Folders and threads](navigation.md): sidebar selection, new-thread entry, drafts.
- [Archive and restore](archive.md): hover actions and archived group.
- [Skills](skills.md): skill discovery, detail, Try, slash aliases.
- [Worktrees](worktrees.md): permanent worktree menu and new-thread environment picker.
