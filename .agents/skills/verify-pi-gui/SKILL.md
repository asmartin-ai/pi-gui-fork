---
name: verify-pi-gui
description: Drive pi-gui's real Electron desktop with the existing Playwright harness, capture durable evidence, and verify mapped user flows. Use for desktop feature verification or a repeatable isolated settings smoke; use the general verify skill to select package-wide checks.
---

# Verify pi-gui

Read [features/README.md](features/README.md), then the affected feature recipes. The primary surface is Electron; package tests and the marketing website do not establish desktop behavior. Use the existing `apps/desktop/tests/helpers/electron-app.ts` harness. This skill's proof spec is a client of that harness, not another app launcher.

## Launch

Run from the repository root with installed dependencies (Node >=22.19.0 <26, pnpm 10.25.0; `pnpm bootstrap` is the repo setup command):

```sh
.agents/skills/verify-pi-gui/scripts/prove.sh
```

This builds through the desktop package command, allocates a unique `.artifacts/verify-pi-gui/run-XXXXXX/`, launches Electron, proves settings persistence, and closes both app instances. It requires no provider login or dev server port. On macOS, if the selected full Xcode installation blocks `git`/`swiftc` on its license, an already working Command Line Tools installation can be selected for this invocation:

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools .agents/skills/verify-pi-gui/scripts/prove.sh
```

Check that directory exists and `DEVELOPER_DIR=/Library/Developer/CommandLineTools xcrun --find swiftc` succeeds first. Do not accept a license or change global developer settings on the user's behalf. Build failures are blockers, not permission to use stale `out/` files.

For other mapped flows, use the canonical source-bound runner:

```sh
pnpm verify --spec apps/desktop/tests/core/skills-settings.spec.ts
```

It builds first. Substitute only a mapped spec; `--spec` cannot combine with `--scope`. For desktop product changes, follow `.agents/skills/verify/SKILL.md` for the owning lane: core/in-window, live/provider, native/OS. The bundled skill smoke is one feature proof, not full regression coverage.

`launchDesktop(userDataDir, {initialWorkspaces: [workspace], testMode: 'background', scrubProviderEnv: true})` starts an isolated profile, agent directory, and historical catalog. `firstWindow()` waits for DOM load and the preload bridge; require a visible Settings or Back to app button before driving. A profile must belong to this run. Separate profiles permit side-by-side processes, but serialize desktop proofs because build output is shared; native flows need exclusive foreground input. Do not drive the user's installed instance.

## Doctor

The bundled smoke performs one read-only identity/readiness check on each launch: Electron's `app.getAppPath()` must resolve to `apps/desktop`, `app.getPath('userData')` must equal this run's profile, and either Settings or Back to app must be visible (the settings view itself can survive a restart). It writes `doctor-1.json` and `doctor-2.json` with the actual PID and paths. Reuse this check whenever an instance looks wrong. Build success immediately before launch ties it to the current checkout; do not infer that an arbitrary installed app is current.

If launch aborts before the bridge, preserve the launch error and inspect the owned child process; there is no UI proof. Do not repeatedly retry identical host crashes.

## Drive

Use the actual `Page` returned by `harness.firstWindow()`, Playwright roles/test IDs, and existing helpers. The executable recipe in `scripts/proof.spec.ts` clicks Settings, changes `getByRole('checkbox', {name: 'Enable skill slash commands'})`, leaves and reopens Settings, then closes/relaunches and asserts the saved value. This tests visible actions and disk-backed persistence without submitting a provider request.

For restart proofs, seed the agent directory once and pass the same explicit `agentDir` on each launch: the default launch helper re-seeds settings on every launch. Read helpers before using them: `createNamedThread()` creates fixtures through IPC, and transcript delta helpers inject events. They can prepare unrelated state but do not prove thread creation or real agent execution. Prove visible mutations with UI actions; read-only IPC may corroborate the UI. Follow the map for each entry point: proving a sidebar button does not prove a keyboard shortcut or native picker.

## Evidence

The helper prints its unique evidence directory. It retains build/run logs, exit code, identity checks, before/change/restart screenshots, ARIA snapshots, action traces (`change.zip`, `restart.zip`), a structured result, and cleanup status. Open a trace with:

```sh
pnpm exec playwright show-trace .artifacts/verify-pi-gui/run-XXXXXX/restart.zip
```

Use the actual directory printed by the helper. Inspect screenshots and trace actions, not only exit status. A pass must capture the action and resulting state; persistence needs a second launch, filesystem/worktree changes need disk or Git corroboration, and runtime behavior needs real provider evidence. Mock only at an existing production boundary and label the limitation. Test mode is not a dry-run guarantee: the app writes profile/workspace data, and Git/provider flows can execute commands or contact services. Inspect actual side effects for the selected flow; never claim no network merely because the mode is called background.

## Cleanup

The spec calls `harness.close()` in `finally`, including failed assertions and failed trace capture, and records the owned PIDs in `cleanup.json`. On launch failure Playwright owns launch teardown; inspect the recorded error for cleanup failures and confirm the child exited. For a stranded process, verify its command and profile and terminate only that run's PID; never kill by process name. Do not silently swallow teardown errors.

After cleanup require `result.json`, `cleanup.json`, screenshots, and traces still exist. The helper checks the main artifacts. Root `AGENTS.md` prohibits deleting temp artifacts without approval, so retain the isolated profile/workspace with the proof; process teardown ends the run. Do not delete user history or old runs.

## Helpers

- `scripts/prove.sh`: executable, rebuilds and runs the isolated settings proof; invocation above. Nonzero exit means blocked/failed, including missing evidence.
- `scripts/proof.spec.ts`: Playwright recipe with launch, doctor, UI drive, restart, evidence, and teardown; invoked by `prove.sh`.
- `scripts/playwright.config.ts`: inherits the repo's Playwright defaults and selects only this smoke; no automatic retries.

Keep the feature map current with `$maintain-verification-skill`.
