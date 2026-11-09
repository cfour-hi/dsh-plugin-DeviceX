/**
 * Uninstall pipeline state-machine tests.
 *
 * The two invariants under test are the ones that protect the user:
 *   - a failed or unverified uninstall must delete NOTHING;
 *   - a missing vendor uninstaller is a normal path, not a failure.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { runUninstallPipeline } from '../plugin/host/uninstall.js';

/**
 * Build a fake adapter and record every side effect it performs.
 * @param {object} [overrides]
 */
function adapter(overrides = {}) {
  /** @type {string[]} */
  const calls = [];
  const steps = {
    async uninstallApp() {
      calls.push('uninstallApp');
      return overrides.uninstallResult ?? { ok: true, message: 'ok' };
    },
    async isStillInstalled() {
      calls.push('isStillInstalled');
      const sequence = overrides.stillInstalled;
      if (Array.isArray(sequence)) {
        const next = sequence.length > 1 ? sequence.shift() : sequence[0];
        return next;
      }
      return sequence ?? false;
    },
    async trashApp(target) {
      calls.push(`trashApp:${target}`);
      return overrides.trashAppResult ?? { ok: true, message: 'moved', destination: `${target}.trashed` };
    },
    async trashPath(target) {
      calls.push(`trashPath:${target}`);
      const map = overrides.trashPathResults;
      if (map && map[target] !== undefined) return map[target];
      return { ok: true, message: 'moved' };
    },
    async rescan() {
      calls.push('rescan');
      return overrides.rescanResult ?? { items: [], totalBytes: 0, errors: [] };
    },
  };
  return { steps, calls };
}

const APP = '/Applications/Some.app';

test('pipeline with no uninstaller goes straight to trashing the app', async () => {
  const { steps, calls } = adapter({ stillInstalled: [true, true] });
  const report = await runUninstallPipeline({ appPath: APP, hasUninstaller: false }, steps);
  assert.equal(report.ok, true);
  assert.equal(report.uninstaller.ran, false);
  assert.equal(report.verified, true);
  assert.equal(report.appTrashed, true);
  // The verification *gate* is skipped: without an uninstaller the app being
  // present is the expected state, not a failure. The later presence check is
  // the "is there still something to move" probe, not a gate.
  assert.deepEqual(calls, ['isStillInstalled', `trashApp:${APP}`]);
});

test('pipeline aborts with zero side effects when the uninstaller fails', async () => {
  const { steps, calls } = adapter({ uninstallResult: { ok: false, message: 'exit code 3' } });
  const report = await runUninstallPipeline(
    { appPath: APP, hasUninstaller: true, items: [{ id: 'a', path: '/tmp/leftover' }] },
    steps,
  );
  assert.equal(report.ok, false);
  assert.equal(report.aborted, true);
  assert.equal(report.phase, 'uninstall');
  // The critical assertion: nothing was trashed.
  assert.equal(report.appTrashed, false);
  assert.equal(report.leftoversRemoved, 0);
  assert.deepEqual(calls, ['uninstallApp']);
});

test('pipeline aborts when the app is still installed after its uninstaller', async () => {
  const { steps, calls } = adapter({ uninstallResult: { ok: true, message: 'ok' }, stillInstalled: true });
  const report = await runUninstallPipeline(
    { appPath: APP, hasUninstaller: true, items: [{ id: 'a', path: '/tmp/leftover' }] },
    steps,
  );
  assert.equal(report.ok, false);
  assert.equal(report.aborted, true);
  assert.equal(report.phase, 'verify');
  assert.equal(report.leftoversRemoved, 0);
  // No trash call of any kind was made.
  assert.equal(calls.some((call) => call.startsWith('trash')), false);
});

test('pipeline aborts when verification throws', async () => {
  const { steps } = adapter();
  steps.isStillInstalled = async () => {
    throw new Error('lstat exploded');
  };
  const report = await runUninstallPipeline({ appPath: APP, hasUninstaller: true }, steps);
  assert.equal(report.ok, false);
  assert.equal(report.aborted, true);
  assert.equal(report.phase, 'verify');
  assert.match(report.message, /nothing was deleted/i);
});

test('pipeline moves leftovers only after verification passes', async () => {
  const items = [
    { id: 'a', path: '/tmp/leftover-a' },
    { id: 'b', path: '/tmp/leftover-b' },
  ];
  const { steps, calls } = adapter({ stillInstalled: [true, true] });
  const report = await runUninstallPipeline(
    { appPath: APP, hasUninstaller: false, items, leftoverBytes: 2048 },
    steps,
  );
  assert.equal(report.ok, true);
  assert.equal(report.leftoversRemoved, 2);
  assert.equal(report.leftoversFailed, 0);
  assert.deepEqual(calls, [
    'isStillInstalled',
    `trashApp:${APP}`,
    'rescan',
    'trashPath:/tmp/leftover-a',
    'trashPath:/tmp/leftover-b',
  ]);
  assert.match(report.message, /Empty the Trash/);
});

test('pipeline reports per-item failures without stopping the batch', async () => {
  const items = [
    { id: 'a', path: '/tmp/a' },
    { id: 'b', path: '/tmp/b' },
  ];
  const { steps, calls } = adapter({
    stillInstalled: [true, true],
    trashPathResults: { '/tmp/a': { ok: false, message: 'EPERM' } },
  });
  const report = await runUninstallPipeline({ appPath: APP, hasUninstaller: false, items }, steps);
  assert.equal(report.ok, false);
  assert.equal(report.aborted, false);
  assert.equal(report.leftoversRemoved, 1);
  assert.equal(report.leftoversFailed, 1);
  // The second item was still attempted.
  assert.ok(calls.includes('trashPath:/tmp/b'));
  assert.match(report.message, /1 of 2/);
});

test('pipeline aborts before leftovers when the app cannot be trashed', async () => {
  const { steps } = adapter({
    stillInstalled: [true, true],
    trashAppResult: { ok: false, message: 'operation not permitted' },
  });
  const report = await runUninstallPipeline(
    { appPath: APP, hasUninstaller: false, items: [{ id: 'a', path: '/tmp/leftover' }] },
    steps,
  );
  assert.equal(report.ok, false);
  assert.equal(report.aborted, true);
  assert.equal(report.phase, 'trash-app');
  assert.equal(report.leftoversRemoved, 0);
  assert.match(report.message, /nothing|no leftovers/i);
});

test('pipeline skips the app move when the vendor uninstaller already removed it', async () => {
  // stillInstalled: false on the verify step, then the app check before trashing.
  const { steps, calls } = adapter({ stillInstalled: [false, false] });
  const report = await runUninstallPipeline({ appPath: APP, hasUninstaller: true }, steps);
  assert.equal(report.ok, true);
  assert.equal(report.appTrashed, false);
  assert.equal(calls.includes(`trashApp:${APP}`), false);
});

test('pipeline rejects a missing app path', async () => {
  const { steps, calls } = adapter();
  const report = await runUninstallPipeline({ appPath: '', hasUninstaller: false }, steps);
  assert.equal(report.ok, false);
  assert.equal(report.aborted, true);
  assert.deepEqual(calls, []);
});

test('pipeline surfaces re-scan failures without losing the cleanup result', async () => {
  const { steps } = adapter({ stillInstalled: [true, true] });
  steps.rescan = async () => {
    throw new Error('scan went sideways');
  };
  const report = await runUninstallPipeline(
    { appPath: APP, hasUninstaller: false, items: [{ id: 'a', path: '/tmp/a' }] },
    steps,
  );
  assert.equal(report.ok, true);
  assert.equal(report.leftoversRemoved, 1);
  assert.ok(report.errors.some((line) => line.includes('re-scan failed')));
});
