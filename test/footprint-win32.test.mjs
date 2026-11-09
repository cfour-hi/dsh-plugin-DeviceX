/**
 * Windows uninstall-footprint tests.
 *
 * These run on a macOS development host: discovery is driven through injected
 * environment + a temporary profile tree, and the cleanup refusal is checked
 * against the action catalog's real validator. Nothing here touches the real
 * profile or spawns PowerShell.
 */
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { __test as footprintTest } from '../plugin/host/footprint-win32.js';
import { scanFootprint } from '../plugin/host/footprint-win32.js';

/** Build a fake Windows profile tree and return the env that points at it. */
async function profile() {
  const root = await mkdtemp(join(tmpdir(), 'dx-win-profile-'));
  const appData = join(root, 'Roaming');
  const localAppData = join(root, 'Local');
  const programData = join(root, 'ProgramData');
  await mkdir(join(appData, 'Acme Widget'), { recursive: true });
  await writeFile(join(appData, 'Acme Widget', 'settings.ini'), 'a'.repeat(120));
  await mkdir(join(localAppData, 'Acme Widget', 'Cache'), { recursive: true });
  await writeFile(join(localAppData, 'Acme Widget', 'Cache', 'blob.bin'), 'b'.repeat(300));
  await mkdir(join(programData, 'Acme Shared'), { recursive: true });
  await mkdir(join(localAppData, 'Packages', 'Acme.Widget_8wekyb3d8bbwe'), { recursive: true });
  await writeFile(join(localAppData, 'Packages', 'Acme.Widget_8wekyb3d8bbwe', 'state.dat'), 'c');
  return {
    root,
    env: {
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      ProgramData: programData,
      USERPROFILE: root,
    },
  };
}

/** Run `fn` with process.env temporarily overlaid. */
async function withEnv(overlay, fn) {
  const saved = {};
  for (const key of Object.keys(overlay)) {
    saved[key] = process.env[key];
    process.env[key] = overlay[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overlay)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('sweepRootsFor marks %PROGRAMDATA% as admin-only', () => {
  const roots = footprintTest.sweepRootsFor({
    appData: 'C:\\Users\\A\\AppData\\Roaming',
    localAppData: 'C:\\Users\\A\\AppData\\Local',
    programData: 'C:\\ProgramData',
    userProfile: 'C:\\Users\\A',
  });
  assert.equal(roots.length, 3);
  const programData = roots.find((entry) => entry.root === 'C:\\ProgramData');
  assert.equal(programData.requiresAdmin, true);
  assert.equal(roots.find((entry) => entry.root.endsWith('Roaming')).requiresAdmin, false);
});

test('displayPath abbreviates known environment roots', () => {
  const env = {
    appData: 'C:\\Users\\A\\AppData\\Roaming',
    localAppData: 'C:\\Users\\A\\AppData\\Local',
    programData: 'C:\\ProgramData',
    userProfile: 'C:\\Users\\A',
  };
  assert.equal(footprintTest.displayPath('C:\\Users\\A\\AppData\\Roaming\\Acme', env), '%APPDATA%\\Acme');
  assert.equal(footprintTest.displayPath('C:\\ProgramData\\Acme', env), '%PROGRAMDATA%\\Acme');
  assert.equal(footprintTest.displayPath('D:\\Other\\Acme', env), 'D:\\Other\\Acme');
});

test('scanFootprint finds the MSIX container and name-matched product directories', async () => {
  const { root, env } = await profile();
  try {
    const report = await withEnv(env, () =>
      scanFootprint({
        name: 'Acme Widget',
        appPath: '',
        installedApps: [{ name: 'Acme Widget', bundleId: null }],
      }),
    );
    const byPath = new Map(report.items.map((item) => [item.path, item]));
    // MSIX container: exact, tier A.
    const msix = byPath.get(join(env.LOCALAPPDATA, 'Packages', 'Acme.Widget_8wekyb3d8bbwe'));
    assert.ok(msix, 'MSIX container was not reported');
    assert.equal(msix.confidence, 'high');
    assert.equal(msix.source, 'msix');
    // Name-matched product directories: tier B, never preselected.
    const roaming = byPath.get(join(env.APPDATA, 'Acme Widget'));
    assert.ok(roaming, 'roaming product directory was not reported');
    assert.equal(roaming.confidence, 'medium');
    // ProgramData is reported but flagged as needing admin.
    const programData = byPath.get(join(env.ProgramData, 'Acme Shared'));
    assert.equal(programData, undefined, 'an unrelated ProgramData directory must not be attributed');
    // Totals: only tier A counts toward the default selection.
    assert.equal(report.selectedBytes, msix.bytes);
    assert.equal(report.totalBytes, report.items.reduce((sum, item) => sum + item.bytes, 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanFootprint reports an install directory as the first, selected row', async () => {
  const { root, env } = await profile();
  const installDir = join(root, 'Program Files', 'Acme Widget');
  await mkdir(installDir, { recursive: true });
  await writeFile(join(installDir, 'widget.exe'), 'x'.repeat(64));
  try {
    const report = await withEnv(env, () =>
      scanFootprint({
        name: 'Acme Widget',
        appPath: installDir,
        installedApps: [{ name: 'Acme Widget', bundleId: null }],
      }),
    );
    const first = report.items[0];
    assert.equal(first.kind, 'app');
    assert.equal(first.path, installDir);
    assert.equal(first.confidence, 'high');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanFootprint refuses an unnamed application instead of scanning everything', async () => {
  const report = await scanFootprint({ name: '', appPath: '' });
  assert.equal(report.items.length, 0);
  assert.ok(report.errors.some((line) => line.includes('missing application name')));
});

test('measurePath counts nested files and stops at the entry cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dx-win-measure-'));
  try {
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    await writeFile(join(root, 'a', 'one.txt'), 'x'.repeat(10));
    await writeFile(join(root, 'a', 'b', 'two.txt'), 'y'.repeat(20));
    const measured = await footprintTest.measurePath(root);
    assert.equal(measured.bytes, 30);
    assert.equal(measured.files, 2);
    assert.equal(measured.truncated, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* --------------------------------------------------- cleanup is refused */

test('win32 app.uninstall refuses a scanId instead of silently skipping cleanup', async () => {
  const actions = await import('../plugin/host/actions-win32.js');
  const catalog = actions.actionCatalog();
  const entry = catalog.find((action) => action.id === 'app.uninstall');
  // The schema advertises the 1.6 params on both platforms.
  assert.deepEqual(
    entry.params.map((param) => param.name),
    ['id', 'scanId', 'itemIds', 'cleanup'],
  );

  // A malformed scanId is rejected by validation, before any uninstaller runs.
  const malformed = await actions.runAction('app.uninstall', { id: 'winget:7zip.7zip', scanId: 42 });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'BAD_PARAMS');

  // A well-formed scanId reaches the runner, which refuses on purpose: Windows
  // cannot move leftovers to the Recycle Bin yet, and silently uninstalling
  // while ignoring the user's selection would be worse than refusing.
  const refused = await actions.runAction('app.uninstall', { id: 'winget:7zip.7zip', scanId: 'abc' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'UNSUPPORTED_PLATFORM');
  assert.match(refused.message, /Recycle Bin/);
});

test('win32 app.uninstall still uninstalls normally without a scanId', async () => {
  const actions = await import('../plugin/host/actions-win32.js');
  // No scanId: the pre-1.6 path is selected. The runner only fails on this
  // macOS dev host because winget.exe is absent; the important part is that the
  // failure is NOT the footprint refusal.
  const result = await actions.runAction('app.uninstall', { id: 'winget:7zip.7zip' });
  assert.notEqual(result.code, 'UNSUPPORTED_PLATFORM');
});
