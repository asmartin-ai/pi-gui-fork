import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchDesktop, seedAgentDir, type DesktopHarness } from '../../../../apps/desktop/tests/helpers/electron-app';

test('settings toggle persists after an isolated Electron restart', async () => {
  const evidence = process.env.PI_GUI_PROOF_DIR;
  if (!evidence) throw new Error('Run scripts/prove.sh to allocate a unique evidence directory');
  const userDataDir = join(evidence, 'profile');
  const workspace = join(evidence, 'workspace');
  const agentDir = join(userDataDir, 'agent');
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await mkdir(workspace, { recursive: true });
  const runs: Array<{ pid: number; closed: boolean }> = [];
  const launch = async () => launchDesktop(userDataDir, {
    agentDir, initialWorkspaces: [workspace], testMode: 'background', scrubProviderEnv: true,
  });
  const doctor = async (harness: DesktopHarness) => {
    const identity = await harness.electronApp.evaluate(({ app }) => ({
      pid: process.pid, appPath: app.getAppPath(), userData: app.getPath('userData'),
    }));
    expect(resolve(identity.appPath)).toBe(resolve('apps/desktop'));
    expect(resolve(identity.userData)).toBe(resolve(userDataDir));
    runs.push({ pid: identity.pid, closed: false });
    await writeFile(join(evidence, `doctor-${runs.length}.json`), JSON.stringify(identity, null, 2));
    const page = await harness.firstWindow();
    await expect(page.getByRole('button', { name: /^(Settings|Back to app)$/ })).toBeVisible();
    return page;
  };
  let original: boolean | undefined;
  for (const phase of ['change', 'restart'] as const) {
    let harness: DesktopHarness | undefined;
    let tracing = false;
    try {
      harness = await launch();
      const page = await doctor(harness);
      await harness.electronApp.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracing = true;
      if (await page.getByRole('button', { name: 'Settings', exact: true }).isVisible()) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      const toggle = page.getByRole('checkbox', { name: 'Enable skill slash commands' });
      await expect(toggle).toBeVisible();
      if (phase === 'change') {
        original = await toggle.isChecked();
        await page.screenshot({ path: join(evidence, 'before.png') });
        await toggle.click();
        await expect(toggle).toBeChecked({ checked: !original });
        await page.getByRole('button', { name: 'Back to app', exact: true }).click();
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(toggle).toBeChecked({ checked: !original });
      } else {
        await expect(toggle).toBeChecked({ checked: !original });
      }
      await page.screenshot({ path: join(evidence, `${phase}.png`) });
      await writeFile(join(evidence, `${phase}.aria.txt`), await page.locator('body').ariaSnapshot());
    } finally {
      if (harness) {
        try {
          if (tracing) await harness.electronApp.context().tracing.stop({ path: join(evidence, `${phase}.zip`) });
        } finally {
          const pid = harness.electronApp.process().pid;
          await harness.close();
          const run = runs.find((entry) => entry.pid === pid);
          if (run) run.closed = true;
          await writeFile(join(evidence, 'cleanup.json'), JSON.stringify(runs, null, 2));
        }
      }
    }
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify({
    feature: 'settings-persistence', original, persisted: !original,
    result: 'passed', runs,
  }, null, 2));
});
