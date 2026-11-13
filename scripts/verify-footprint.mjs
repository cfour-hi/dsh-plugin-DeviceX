#!/usr/bin/env node
/**
 * Device X — offline uninstall-footprint verification.
 *
 * Proves, on any host and without touching a real profile:
 *   1. syntax of every module the feature touches,
 *   2. the dispatcher surface and its scan-token store,
 *   3. the classification tiers against the traps observed on a real Mac
 *      (Team-ID-prefixed group containers, `Claude-3p`, vendor directories),
 *   4. token lifecycle: single use, TTL, cross-scan ids, forged ids,
 *      admin-only items and path escapes,
 *   5. the uninstall pipeline's zero-side-effect failure path,
 *   6. `moveToTrash` never overwrites an existing Trash entry,
 *   7. the Windows scanner's tier mapping through injected environment,
 *   8. source guards: ASCII-only Windows sources and a static check that no
 *      deletion path can be reached without a scan token.
 *
 * Every filesystem write happens inside `os.tmpdir()` sandboxes created and
 * removed here. The live macOS scan is read-only and only asserts shape.
 *
 * Usage: node scripts/verify-footprint.mjs
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostDir = join(root, 'plugin', 'host');

let passed = 0;
const failures = [];

function section(title) {
  console.log(`\n--- ${title}`);
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const toUrl = (file) => pathToFileURL(join(hostDir, file)).href;

// ---------------------------------------------------------------------------
section('1. Syntax of every touched module');
const syntaxFiles = [
  'footprint-core.js',
  'footprint.js',
  'footprint-darwin.js',
  'footprint-win32.js',
  'uninstall.js',
  'actions-darwin.js',
  'actions-win32.js',
  'transport.js',
];
for (const file of syntaxFiles) {
  let ok = true;
  try {
    execFileSync(process.execPath, ['--check', join(hostDir, file)], { stdio: 'pipe' });
  } catch {
    ok = false;
  }
  check(`node --check host/${file}`, ok);
}

// ---------------------------------------------------------------------------
section('2. Kernel exports');
const core = await import(toUrl('footprint-core.js'));
for (const name of [
  'stripTeamPrefix',
  'slugify',
  'compactSlug',
  'matchesBundleId',
  'matchesAppName',
  'isVendorShared',
  'ownersOf',
  'dedupeApps',
  'classify',
  'totalBytes',
  'selectedBytes',
  'isSameApp',
]) {
  check(`footprint-core exports ${name}()`, typeof core[name] === 'function');
}
// Purity: the kernel must not import anything (no fs, no child processes).
const coreSource = readFileSync(join(hostDir, 'footprint-core.js'), 'utf8');
check('kernel imports nothing (pure module)', !/^\s*import\s/m.test(coreSource.replace(/^\s*\*\s.*$/gm, '')));

// ---------------------------------------------------------------------------
section('3. Classification traps observed on a real host');
check(
  'Team ID prefix is stripped',
  core.stripTeamPrefix('6N38VWS5BX.ru.keepcoder.Telegram') === 'ru.keepcoder.Telegram',
);
check(
  'group.<TeamID>. prefix is stripped',
  core.stripTeamPrefix('group.W5364U7YZB.io.tailscale.shared') === 'io.tailscale.shared',
);
check(
  'bundle-id matching needs a dot boundary',
  core.matchesBundleId('com.foobar', 'com.foo') === false && core.matchesBundleId('com.foo.x', 'com.foo') === true,
);
check(
  'name matching never matches a bare substring (Code vs Codex)',
  core.matchesAppName('codex', 'code') === false && core.matchesAppName('code-3p', 'code') === true,
);
const claude = core.toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' });
check(
  'Claude-3p resolves to Claude (the only rule that finds the 11 GB directory)',
  core.ownersOf('Claude-3p', [claude]).length === 1,
);
check(
  'a space-bearing directory resolves (Acme Widget)',
  core.ownersOf('Acme Widget', [core.toAppContext({ name: 'Acme Widget' })]).length === 1,
);
check('vendor-level directory is shared', core.isVendorShared('Google') === true);
check(
  'name-only match is tier B and excluded from the default selection',
  core.classify({ name: 'Claude-3p' }, claude, [claude]).confidence === 'medium' &&
    core.selectedBytes([{ bytes: 1000, confidence: 'medium' }]) === 0,
);
check(
  'duplicate roster rows are collapsed (triple-reported bundle)',
  core.dedupeApps([
    core.toAppContext({ name: 'claude', bundleId: 'com.anthropic.claude-code' }),
    core.toAppContext({ name: 'claude', bundleId: 'com.anthropic.claude-code' }),
    core.toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' }),
  ]).length === 2,
);

// ---------------------------------------------------------------------------
section('4. Dispatcher, token store and route registration');
const footprint = await import(toUrl('footprint.js'));
check('dispatcher reports the host platform', footprint.PLATFORM === process.platform);
check('scan tokens expire after 10 minutes', footprint.TOKEN_TTL_MS === 10 * 60_000);
check('token store is bounded', footprint.MAX_TOKENS > 0 && footprint.MAX_TOKENS <= 64);
check('a missing path is refused without scanning', (await footprint.scanFootprint({})).errors.length > 0);

footprint.__resetForTests();
const token = footprint.__test.registerToken(
  { appPath: '/Applications/X.app', items: [{ id: 'fp_a', path: '/tmp/dx-fp-none', kind: 'data' }] },
  ['/tmp'],
);
check('registerToken returns an opaque id', typeof token === 'string' && token.length >= 16);
const forged = footprint.resolveScanItems(token, ['fp_forged']);
check('an id from outside the scan is refused', forged.ok === false && forged.code === 'ITEM_NOT_IN_SCAN');
const unknownScan = footprint.resolveScanItems('not-a-scan', ['fp_a']);
check('an unknown scan id is refused', unknownScan.ok === false && unknownScan.code === 'SCAN_NOT_FOUND');

/** A token whose item points outside the recorded roots must be refused. */
footprint.__resetForTests();
const escapeToken = footprint.__test.registerToken(
  { appPath: '/Applications/X.app', items: [{ id: 'fp_b', path: join(tmpdir(), 'dx-x'), kind: 'data' }] },
  [join(tmpdir(), 'dx-fp-allowed-root')],
);
const escaped = footprint.resolveScanItems(escapeToken, ['fp_b']);
check('a path outside the scanned roots is refused', escaped.ok === false && escaped.code === 'PATH_NOT_ALLOWED');

footprint.__resetForTests();
const adminToken = footprint.__test.registerToken(
  { appPath: '/Applications/X.app', items: [{ id: 'fp_c', path: '/Library/PrivilegedHelperTools/x', kind: 'system', requiresAdmin: true }] },
  ['/Library'],
);
const admin = footprint.resolveScanItems(adminToken, ['fp_c']);
check('an admin-only item is refused', admin.ok === false && admin.code === 'REQUIRES_ADMIN');

footprint.__resetForTests();
const onceToken = footprint.__test.registerToken(
  {
    appPath: '/Applications/X.app',
    items: [{ id: 'fp_d', path: join(tmpdir(), 'dx-y'), kind: 'data', bytes: 4_096 }],
  },
  [tmpdir()],
);
const firstUse = footprint.resolveScanItems(onceToken, ['fp_d']);
check('a valid token resolves its own ids', firstUse.ok === true && firstUse.items.length === 1);
// Scan-time bytes must survive into the pipeline, or the result message
// silently claims the Trash holds nothing.
check(
  'resolved items keep the scan-time byte size',
  firstUse.ok === true && firstUse.items[0].bytes === 4_096,
  firstUse.ok ? String(firstUse.items[0].bytes) : '',
);
footprint.consumeToken(onceToken);
const secondUse = footprint.resolveScanItems(onceToken, ['fp_d']);
check('a consumed token cannot be reused', secondUse.ok === false && secondUse.code === 'SCAN_CONSUMED');

// Platform-neutral fixtures: the guard compares with `path.sep`, so POSIX
// literals would pass on macOS and fail on Windows for the wrong reason.
const insideRoot = join(tmpdir(), 'dx-root');
check(
  'isInsideRoots rejects sibling-prefix escapes',
  footprint.__test.isInsideRoots(`${insideRoot}-evil`, [insideRoot]) === false &&
    footprint.__test.isInsideRoots(join(insideRoot, 'child'), [insideRoot]) === true,
);

// route registration
const routes = [];
const plugin = await import(pathToFileURL(join(root, 'plugin', 'index.js')).href);
plugin.apply({
  effect: (callback) => callback(),
  webServer: { register: (route) => (routes.push(route), () => {}) },
  tools: { register: () => () => {} },
  connection: { requestRejection: () => undefined },
});
const footprintRoute = routes.find((route) => route.path === '/devicex/api/footprint');
check('the footprint route is registered', footprintRoute !== undefined);
check('the action catalogue still holds 19 actions', (await import(toUrl('actions.js'))).actionCatalog().length === 19);

// ---------------------------------------------------------------------------
section('5. Uninstall pipeline: failure paths have zero side effects');
const { runUninstallPipeline } = await import(toUrl('uninstall.js'));

/**
 * Build a recordable adapter.
 * @param {object} [overrides]
 */
function adapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    steps: {
      async uninstallApp() {
        calls.push('uninstallApp');
        return overrides.uninstallResult ?? { ok: true, message: 'ok' };
      },
      async isStillInstalled() {
        calls.push('verify');
        return overrides.stillInstalled ?? false;
      },
      async trashApp(target) {
        calls.push('trashApp');
        return overrides.trashAppResult ?? { ok: true, message: 'moved', destination: `${target}.t` };
      },
      async trashPath() {
        calls.push('trashPath');
        return { ok: true, message: 'moved' };
      },
      async rescan() {
        calls.push('rescan');
        return { items: [], totalBytes: 0, errors: [] };
      },
    },
  };
}

const failUninstaller = adapter({ uninstallResult: { ok: false, message: 'exit 3' } });
const reported = await runUninstallPipeline(
  { appPath: '/Applications/X.app', hasUninstaller: true, items: [{ id: 'a', path: '/tmp/a' }] },
  failUninstaller.steps,
);
check('a failed uninstaller aborts the pipeline', reported.ok === false && reported.aborted === true);
check('a failed uninstaller deletes nothing', failUninstaller.calls.includes('trashPath') === false);

const still = adapter({ stillInstalled: true });
const verified = await runUninstallPipeline({ appPath: '/Applications/X.app', hasUninstaller: true }, still.steps);
check('an app that survives its uninstaller aborts verification', verified.aborted === true && verified.phase === 'verify');
check('verification failure deletes nothing', still.calls.some((call) => call.startsWith('trash')) === false);

const noUninstaller = adapter();
const plain = await runUninstallPipeline({ appPath: '/Applications/X.app', hasUninstaller: false }, noUninstaller.steps);
check('a missing uninstaller is not treated as failure', plain.ok === true && plain.uninstaller.ran === false);

const withBytes = adapter();
const reportedBytes = await runUninstallPipeline(
  {
    appPath: '/Applications/X.app',
    hasUninstaller: false,
    items: [{ id: 'a', path: '/tmp/a' }],
    leftoverBytes: 8 * 1024 ** 3,
  },
  withBytes.steps,
);
check(
  'the result states that emptying the Trash is what frees the space',
  reportedBytes.ok === true && /Empty the Trash/.test(reportedBytes.message),
  reportedBytes.message,
);

// ---------------------------------------------------------------------------
section('6. moveToTrash never clobbers an existing Trash entry');
const { __trashTest } = await import(toUrl('actions-darwin.js'));
const sandboxRoot = await mkdtemp(join(tmpdir(), 'dx-fp-trash-'));
try {
  const source = join(sandboxRoot, 'source');
  const trash = join(sandboxRoot, 'Trash');
  await mkdir(source, { recursive: true });
  await mkdir(trash, { recursive: true });

  const victim = join(source, 'com.example.data');
  await mkdir(victim);
  await writeFile(join(victim, 'keep.bin'), 'PAYLOAD');
  const moved = await __trashTest.moveToTrash(victim, { trashDir: trash });
  check('a data directory keeps its name (no invented .app)', !moved.endsWith('.app'), moved.split('/').pop());
  check('the moved payload survived', readFileSync(join(moved, 'keep.bin'), 'utf8') === 'PAYLOAD');

  // A pre-existing entry must never be overwritten.
  await writeFile(join(trash, 'collide.txt'), 'FIRST');
  const other = join(source, 'collide.txt');
  await writeFile(other, 'SECOND');
  const dest2 = await __trashTest.moveToTrash(other, { trashDir: trash });
  check('an existing Trash file is untouched', readFileSync(join(trash, 'collide.txt'), 'utf8') === 'FIRST');
  check('the new file landed under a distinct name', readFileSync(dest2, 'utf8') === 'SECOND');
} finally {
  await rm(sandboxRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
section('7. Windows scanner tier mapping (injected environment)');
const winScan = await import(toUrl('footprint-win32.js'));
const winRoot = await mkdtemp(join(tmpdir(), 'dx-fp-win-'));
try {
  const appData = join(winRoot, 'Roaming');
  const localAppData = join(winRoot, 'Local');
  await mkdir(join(appData, 'Acme Widget'), { recursive: true });
  await writeFile(join(appData, 'Acme Widget', 's.ini'), 'x'.repeat(64));
  await mkdir(join(localAppData, 'Packages', 'Acme.Widget_8wekyb3d8bbwe'), { recursive: true });

  const saved = {};
  const overlay = { APPDATA: appData, LOCALAPPDATA: localAppData, ProgramData: join(winRoot, 'ProgramData'), USERPROFILE: winRoot };
  for (const key of Object.keys(overlay)) {
    saved[key] = process.env[key];
    process.env[key] = overlay[key];
  }
  try {
    const report = await winScan.scanFootprint({
      name: 'Acme Widget',
      appPath: '',
      installedApps: [{ name: 'Acme Widget', bundleId: null }],
    });
    const msix = report.items.find((item) => item.source === 'msix');
    check('the MSIX container is found and is tier A', msix !== undefined && msix.confidence === 'high');
    const named = report.items.find((item) => item.path === join(appData, 'Acme Widget'));
    check('a space-bearing product directory is tier B', named !== undefined && named.confidence === 'medium');
  } finally {
    for (const key of Object.keys(overlay)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
} finally {
  await rm(winRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
section('8. Source guards');
const winSources = ['footprint-win32.js', 'actions-win32.js'];
for (const file of winSources) {
  const text = readFileSync(join(hostDir, file), 'utf8');
  check(`host/${file} is ASCII-only`, !/[^\x00-\x7F]/.test(text));
}
const actionsDarwin = readFileSync(join(hostDir, 'actions-darwin.js'), 'utf8');
check(
  'app.uninstall reaches leftovers only through resolveScanItems()',
  actionsDarwin.includes('resolveScanItems(') && /const resolved = resolveScanItems\(/.test(actionsDarwin),
);
check(
  'leftovers are moved with moveToTrash(), never fs.rm',
  !/trashPath[\s\S]{0,400}fsp\.rm\(/.test(actionsDarwin),
);
const uninstallSource = readFileSync(join(hostDir, 'uninstall.js'), 'utf8');
check(
  'the pipeline verifies the app is gone before trashing leftovers',
  uninstallSource.indexOf("phase = 'verify'") < uninstallSource.indexOf("phase = 'trash-leftovers'"),
);
check(
  'the pipeline only deletes after a successful verification',
  /if \(stillInstalled === true\) \{\s*return abort/.test(uninstallSource),
);
const win32Source = readFileSync(join(hostDir, 'actions-win32.js'), 'utf8');
check(
  'the Win32 runner recycles leftovers through the shared pipeline',
  win32Source.includes('runWin32UninstallPipeline') &&
    win32Source.includes("from './uninstall.js'") &&
    win32Source.includes('recycleToBin'),
);
check(
  'the Win32 runner no longer refuses a scan-backed uninstall',
  !win32Source.includes('UNSUPPORTED_PLATFORM'),
);
check(
  'macOS never executes a bundle-shipped uninstaller',
  !/runVendorUninstaller|hasVendorUninstaller/.test(actionsDarwin) &&
    /hasUninstaller: false/.test(actionsDarwin),
);

// ---------------------------------------------------------------------------
section('9. Live macOS read-only scan (shape only)');
if (process.platform === 'darwin' && existsSync('/Applications')) {
  const entries = await readdir('/Applications').catch(() => []);
  const candidate = entries.find((name) => name.endsWith('.app'));
  if (candidate !== undefined) {
    const started = Date.now();
    const live = await footprint.scanFootprint({ path: join('/Applications', candidate), fresh: true });
    const elapsed = Date.now() - started;
    check('the live scan returns a scan id', typeof live.scanId === 'string' && live.scanId.length > 0);
    check('the live scan returns JSON-safe data', typeof JSON.stringify(live) === 'string');
    check('every item carries the contract fields', live.items.every((item) =>
      typeof item.id === 'string' &&
      typeof item.path === 'string' &&
      typeof item.confidence === 'string' &&
      typeof item.bytes === 'number' &&
      Number.isInteger(item.bytes) &&
      item.bytes >= 0,
    ));
    check('every confidence is a known tier', live.items.every((item) =>
      ['high', 'medium', 'conflict', 'shared'].includes(item.confidence),
    ));
    check('the byte totals are consistent', live.totalBytes === live.items.reduce((sum, item) => sum + item.bytes, 0));
    check('the live scan stays under the 20 s bound', elapsed < 20_000, `${elapsed} ms`);
    const noPathRequest = await footprint.scanFootprint({});
    check('an empty path never scans the whole disk', noPathRequest.items.length === 0);
  } else {
    check('a live application exists to scan', false, 'no .app in /Applications');
  }
} else {
  console.log('  SKIP live scan (not a macOS host with /Applications)');
}

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'ALL FOOTPRINT CHECKS PASSED' : 'FAILED:'} — ${passed} checks`);
if (failures.length > 0) {
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
