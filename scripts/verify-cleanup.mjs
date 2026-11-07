#!/usr/bin/env node
/**
 * Device X — offline cleanup verification.
 *
 * Runs on the macOS development host (no Windows machine required) and proves:
 *   1. syntax of every host module touched by the cleanup feature,
 *   2. the dispatcher surface (PLATFORM, scanCleanup, deleteCleanup,
 *      cleanupItems, __test),
 *   3. a live, read-only macOS scan (shape, byte/file totals, categories,
 *      requiresAdmin flags, JSON-safety, bounded runtime),
 *   4. the 60 s scan cache and the `fresh` bypass,
 *   5. allowlist immutability — caller paths / unknown ids / duplicates /
 *      oversized batches are refused and nothing is deleted,
 *   6. confirmed deletion against a temp sandbox only, through the injected-root
 *      `__test` hooks (the public API never accepts a path),
 *   7. the `cleanup.delete` action catalogue entry and its validator, recorded
 *      in the action history,
 *   8. the Windows allowlist through the pure fixture normalizer
 *      (`scripts/fixtures/win32/cleanup.json`),
 *   9. source guards: ASCII-only Windows sources and a static guarantee that no
 *      non-allowlisted path can reach `fs.rm`.
 *
 * It NEVER deletes real caches, logs or Trash: the only deletions happen in
 * `os.tmpdir()` sandboxes created and removed by this script.
 *
 * Usage: node scripts/verify-cleanup.mjs
 */
import { deepStrictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { dirname, isAbsolute as isPathAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');
const hostDir = join(pluginDir, 'host');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail === undefined ? '' : ` (${detail})`}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` (${detail})`}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function sameJson(left, right) {
  try {
    deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}
function jsonSafe(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' && !text.includes('NaN') ? text : null;
  } catch {
    return null;
  }
}
async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}
async function throwsCode(fn, code) {
  try {
    await fn();
    return { threw: false, code: null };
  } catch (error) {
    return { threw: true, code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null };
  }
}

// ---------------------------------------------------------------------------
section('1. Syntax');
const syntaxFiles = [
  'host/cleanup.js',
  'host/cleanup-darwin.js',
  'host/cleanup-win32.js',
  'host/actions-darwin.js',
  'host/actions-win32.js',
];
for (const file of syntaxFiles) {
  let ok = true;
  try {
    execFileSync(process.execPath, ['--check', join(pluginDir, file)], { stdio: 'pipe' });
  } catch {
    ok = false;
  }
  check(`node --check plugin/${file}`, ok);
}

// ---------------------------------------------------------------------------
section('2. Dispatcher surface');
const cleanup = await import(pathToFileURL(join(hostDir, 'cleanup.js')));
const darwin = await import(pathToFileURL(join(hostDir, 'cleanup-darwin.js')));
const win32 = await import(pathToFileURL(join(hostDir, 'cleanup-win32.js')));
const actions = await import(pathToFileURL(join(hostDir, 'actions.js')));
const actionsDarwin = await import(pathToFileURL(join(hostDir, 'actions-darwin.js')));
check('the development host is darwin', process.platform === 'darwin', process.platform);
check('cleanup dispatcher reports the host platform', cleanup.PLATFORM === process.platform);
check('dispatcher selects the darwin implementation', cleanup.__test.platform === 'darwin');
for (const name of ['scanCleanup', 'deleteCleanup', 'cleanupItems']) {
  check(`cleanup exports ${name}()`, typeof cleanup[name] === 'function');
}
check('cleanup exposes __test hooks', isPlainObject(cleanup.__test) && isPlainObject(cleanup.__test.darwin) && isPlainObject(cleanup.__test.win32));
check(
  'all three implementations agree on the platform string',
  darwin.PLATFORM === 'darwin' && win32.PLATFORM === 'win32',
);

// ---------------------------------------------------------------------------
section('3. Live darwin scan (read-only)');
darwin.__test.clearCache();
const scanStarted = Date.now();
const scan = await cleanup.scanCleanup({ fresh: true });
const scanWallMs = Date.now() - scanStarted;
check('live scan returns within the 15 s page bound', scanWallMs < 15_000, `${scanWallMs} ms`);
check('scan platform is darwin', scan.platform === 'darwin');
check(
  'scan generatedAt is a recent epoch millisecond value',
  Number.isFinite(scan.generatedAt) && Math.abs(Date.now() - scan.generatedAt) < 120_000,
);
check('scan durationMs is a finite non-negative number', Number.isFinite(scan.durationMs) && scan.durationMs >= 0);
check('scan durationMs stays inside the same bound', scan.durationMs < 15_000, `${scan.durationMs} ms`);
check('scan exposes the eight-item macOS allowlist', Array.isArray(scan.items) && scan.items.length === 8);
const itemKeys = ['id', 'label', 'detail', 'category', 'path', 'bytes', 'files', 'requiresAdmin', 'exists', 'error'];
check(
  'every item carries exactly the contract fields',
  scan.items.every((item) => isPlainObject(item) && sameJson(Object.keys(item).sort(), [...itemKeys].sort())),
);
const validCategories = new Set(['cache', 'logs', 'trash', 'temp', 'developer', 'updates']);
check('every item category is contract-valid', scan.items.every((item) => validCategories.has(item.category)));
check(
  'every item byte/file count is a non-negative integer',
  scan.items.every(
    (item) =>
      Number.isInteger(item.bytes) &&
      item.bytes >= 0 &&
      Number.isInteger(item.files) &&
      item.files >= 0,
  ),
);
check(
  'every item path is a fixed absolute path',
  scan.items.every((item) => typeof item.path === 'string' && isPathAbsolute(item.path)),
);
check(
  'every item exists flag is boolean and error is null or a string',
  scan.items.every(
    (item) => typeof item.exists === 'boolean' && (item.error === null || typeof item.error === 'string'),
  ),
);
check(
  'item ids match cleanupItems() in order',
  sameJson(
    scan.items.map((item) => item.id),
    cleanup.cleanupItems().map((item) => item.id),
  ),
);
check(
  'scan totalBytes equals the sum of the item byte counts',
  scan.totalBytes === scan.items.reduce((sum, item) => sum + item.bytes, 0),
);
check(
  'scan totalFiles equals the sum of the item file counts',
  scan.totalFiles === scan.items.reduce((sum, item) => sum + item.files, 0),
);
check(
  'scan errors[] is a string array (failures are non-fatal)',
  Array.isArray(scan.errors) && scan.errors.every((entry) => typeof entry === 'string'),
);
check('scan document is JSON-safe', jsonSafe(scan) !== null && sameJson(JSON.parse(jsonSafe(scan)), scan));
const adminIds = scan.items.filter((item) => item.requiresAdmin).map((item) => item.id).sort().join(',');
check('only the two system roots are marked requiresAdmin', adminIds === 'system-caches,system-logs', adminIds);
check(
  'user roots are not marked requiresAdmin',
  scan.items
    .filter((item) => !['system-caches', 'system-logs'].includes(item.id))
    .every((item) => item.requiresAdmin === false),
);
console.log(
  `  INFO live scan: ${scan.items.map((item) => `${item.id}=${item.bytes}B/${item.files}f`).join(' ')}`,
);

// ---------------------------------------------------------------------------
section('4. Scan cache (60 s TTL) and the fresh bypass');
const cachedScan = await cleanup.scanCleanup();
check('non-fresh scan is served from the cache (same document)', cachedScan === scan);
const cacheStatus = darwin.__test.cacheStatus();
check(
  'cache metadata reports a populated 60 s cache',
  cacheStatus.cached === true && cacheStatus.ttlMs === 60_000 && cacheStatus.ageMs >= 0,
);
const freshStarted = Date.now();
const freshScan = await cleanup.scanCleanup({ fresh: true });
check(
  'fresh:true bypasses the cache and produces a new document',
  freshScan !== scan && freshScan.generatedAt >= scan.generatedAt,
);
check('the bypassing scan also respects the runtime bound', Date.now() - freshStarted < 15_000);
darwin.__test.clearCache();
check('clearCache() drops the cached document', darwin.__test.cacheStatus().cached === false);

// ---------------------------------------------------------------------------
section('5. Allowlist immutability (no caller path ever reaches the fs)');
const allowlist = cleanup.cleanupItems();
check(
  'cleanupItems() entries expose only the public metadata keys',
  allowlist.every(
    (item) => isPlainObject(item) && sameJson(Object.keys(item).sort(), ['category', 'id', 'label', 'path', 'requiresAdmin']),
  ),
);
check('cleanupItems() ids are unique', new Set(allowlist.map((item) => item.id)).size === allowlist.length);
check(
  'all allowlist paths are fixed absolute paths',
  allowlist.every((item) => typeof item.path === 'string' && isPathAbsolute(item.path)),
);
check(
  'cleanupItems() matches the implementation allowlist',
  sameJson(
    allowlist.map((item) => item.id),
    darwin.cleanupItems().map((item) => item.id),
  ),
);
check('isAllowlistedPath accepts a real cleanup root', darwin.__test.isAllowlistedPath('/Library/Caches') === true);
check('isAllowlistedPath rejects /etc/passwd', darwin.__test.isAllowlistedPath('/etc/passwd') === false);
check('isAllowlistedPath rejects relative paths', darwin.__test.isAllowlistedPath('Library/Caches') === false);
check('isAllowlistedPath rejects non-strings', darwin.__test.isAllowlistedPath(42) === false);

const canary = join(os.tmpdir(), `devicex-cleanup-canary-${process.pid}-${Date.now()}.txt`);
await fsp.writeFile(canary, 'cleanup canary — must survive every refused request');
const refusedPayloads = [
  ['traversal id', ['../../etc/passwd']],
  ['absolute path as id', ['/etc/passwd']],
  ['unknown id', ['definitely-not-a-cleanup-item']],
  ['21 ids (oversized batch)', Array.from({ length: 21 }, (_, index) => `item-${index}`)],
  ['duplicate ids', ['user-caches', 'user-caches']],
  ['known id plus traversal', ['system-caches', '../../etc/passwd']],
  ['non-string id', [42]],
  ['empty array', []],
  ['comma separated traversal', 'user-caches,../../etc/passwd'],
  ['null payload', null],
  ['undefined payload', undefined],
  ['object payload', { id: 'user-caches' }],
  ['number payload', 42],
];
for (const [label, payload] of refusedPayloads) {
  const result = await cleanup.deleteCleanup(payload);
  check(
    `deleteCleanup refuses ${label} with BAD_PARAMS and touches nothing`,
    result.ok === false &&
      result.code === 'BAD_PARAMS' &&
      isPlainObject(result.data) &&
      result.data.deletedBytes === 0 &&
      Array.isArray(result.data.items) &&
      result.data.items.length === 0,
  );
}
check('canary file survived every refused deletion', (await pathExists(canary)) === true);

// ---------------------------------------------------------------------------
section('6. Deletion against a temp sandbox only (injected root)');
const sandbox = await fsp.mkdtemp(join(os.tmpdir(), 'devicex-cleanup-sandbox-'));
const outside = await fsp.mkdtemp(join(os.tmpdir(), 'devicex-cleanup-outside-'));
const outsideCanary = join(outside, 'canary.bin');
await fsp.writeFile(outsideCanary, Buffer.alloc(10_000, 7));
await fsp.mkdir(join(sandbox, 'alpha'));
await fsp.writeFile(join(sandbox, 'alpha', 'a.bin'), Buffer.alloc(100));
await fsp.mkdir(join(sandbox, 'beta'));
await fsp.writeFile(join(sandbox, 'beta', 'b.bin'), Buffer.alloc(50));
await fsp.mkdir(join(sandbox, 'gamma'));
await fsp.symlink(outsideCanary, join(sandbox, 'link-to-canary.bin'));

const sandboxWalk = await darwin.__test.walkRoot(sandbox);
check(
  'bounded walk counts only regular files (symlink skipped)',
  sandboxWalk.bytes === 150 && sandboxWalk.files === 2,
  `${sandboxWalk.bytes}B/${sandboxWalk.files}f`,
);
check('bounded walk reports the visited entries', sandboxWalk.entries >= 5, `${sandboxWalk.entries}`);
check('bounded walk is JSON-safe and untruncated', jsonSafe(sandboxWalk) !== null && sandboxWalk.truncated === null);
check('sandbox root itself is not on the real allowlist', darwin.__test.isAllowlistedPath(sandbox) === false);

const sandboxSet = new Set([resolve(sandbox)]);
const childRefusal = await throwsCode(
  () => darwin.__test.removeTreeAt(join(sandbox, 'alpha'), {}, sandboxSet),
  'PATH_NOT_ALLOWED',
);
check(
  'injected-root deletion refuses a child path that is not the injected root',
  childRefusal.threw === true && childRefusal.code === 'PATH_NOT_ALLOWED',
);
check('the refused child path still exists', (await pathExists(join(sandbox, 'alpha', 'a.bin'))) === true);

const removed = await darwin.__test.removeTreeAt(sandbox, { recreate: true }, sandboxSet);
check(
  'injected-root deletion removes the tree and reports its size',
  removed.ok === true && removed.bytes === 150 && removed.files === 2,
  `${removed.bytes}B/${removed.files}f`,
);
check(
  'cache-like deletion recreates the directory empty',
  (await pathExists(sandbox)) === true && (await fsp.readdir(sandbox)).length === 0,
);
check(
  'deletion never follows the symlink to data outside the root',
  (await pathExists(outsideCanary)) === true && (await fsp.stat(outsideCanary)).size === 10_000,
);

await fsp.mkdir(join(sandbox, 'alpha'));
await fsp.writeFile(join(sandbox, 'alpha', 'a.bin'), Buffer.alloc(100));
const emptied = await darwin.__test.emptyDirectoryAt(sandbox, sandboxSet);
check(
  'empty-mode deletion keeps the directory and removes its contents',
  emptied.ok === true && (await pathExists(sandbox)) === true && (await fsp.readdir(sandbox)).length === 0,
);

const missingRoot = join(sandbox, 'missing-root');
const missingSet = new Set([resolve(missingRoot)]);
const recreated = await darwin.__test.removeTreeAt(missingRoot, { recreate: true }, missingSet);
check(
  'deleting a missing cache root recreates it empty',
  recreated.ok === true && (await pathExists(missingRoot)) === true && (await fsp.readdir(missingRoot)).length === 0,
);
check(
  'walk of a missing path reports no files instead of throwing',
  await darwin.__test.walkRoot(missingRoot).then((walk) => walk.files === 0 && walk.bytes === 0),
);

await fsp.rm(sandbox, { recursive: true, force: true });
await fsp.rm(outside, { recursive: true, force: true });
await fsp.rm(canary, { force: true });
check('sandbox cleanup finished', (await pathExists(sandbox)) === false && (await pathExists(outside)) === false);

// ---------------------------------------------------------------------------
section('7. Action catalogue entry and validator');
const catalog = actions.actionCatalog();
const cleanupActions = catalog.filter((entry) => entry.id === 'cleanup.delete');
check('action catalogue contains exactly one cleanup.delete', cleanupActions.length === 1);
const spec = cleanupActions[0] ?? {};
check('cleanup.delete is a high-danger system action', spec.group === 'system' && spec.danger === 'high');
check('cleanup.delete does not require the caller to be admin', spec.requiresAdmin === false);
check('cleanup.delete declares exactly one parameter', Array.isArray(spec.params) && spec.params.length === 1);
const idsParam = spec.params?.[0] ?? {};
check(
  'cleanup.delete ids parameter is a required multi-value string',
  idsParam.name === 'ids' && idsParam.type === 'string' && idsParam.required === true && idsParam.multiple === true,
);
check('catalogue action ids stay unique', new Set(catalog.map((entry) => entry.id)).size === catalog.length);

const readCleanupIds = actionsDarwin.__test?.readCleanupIds;
check('the darwin action module exposes the pure cleanup validator', typeof readCleanupIds === 'function');
const validArray = readCleanupIds?.({ ids: ['user-caches', 'user-logs'] });
check(
  'validator accepts a known ids array without deleting anything',
  validArray?.ok === true && sameJson(validArray.value, ['user-caches', 'user-logs']),
);
const validString = readCleanupIds?.({ ids: 'user-caches, user-logs' });
check(
  'validator accepts a comma separated string of known ids',
  validString?.ok === true && sameJson(validString.value, ['user-caches', 'user-logs']),
);
check('validator rejects duplicate ids', readCleanupIds?.({ ids: ['trash', 'trash'] }).ok === false);
check('validator rejects unknown ids', readCleanupIds?.({ ids: ['nope'] }).ok === false);
check('validator rejects > 20 ids', readCleanupIds?.({ ids: Array.from({ length: 21 }, (_, index) => `x${index}`) }).ok === false);
check('validator rejects a missing ids parameter', readCleanupIds?.({}).ok === false);

const badRunCases = [
  ['traversal id', { ids: ['../../etc/passwd'] }],
  ['unknown id', { ids: ['nope'] }],
  ['duplicate ids', { ids: ['trash', 'trash'] }],
  ['oversized batch', { ids: Array.from({ length: 21 }, (_, index) => `x${index}`) }],
  ['missing ids', {}],
];
for (const [label, payload] of badRunCases) {
  const result = await actions.runAction('cleanup.delete', payload);
  check(
    `runAction cleanup.delete refuses ${label} with BAD_PARAMS`,
    result.ok === false && result.code === 'BAD_PARAMS' && typeof result.message === 'string',
  );
  check(`runAction cleanup.delete reveals no data for ${label}`, result.data === undefined);
}
const history = actions.actionHistory();
check(
  'every refused cleanup.delete attempt is recorded in the action history',
  history.slice(0, badRunCases.length).every((entry) => entry.id === 'cleanup.delete' && entry.ok === false),
);
check('the action history remains JSON-safe', jsonSafe(history) !== null);

// ---------------------------------------------------------------------------
section('8. Windows allowlist through the pure fixture');
const fixturePath = join(here, 'fixtures', 'win32', 'cleanup.json');
check('win32 cleanup fixture exists', existsSync(fixturePath));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const expected = fixture.expected ?? {};
const normalized = win32.__test.normalizeWinItems(fixture.environment ?? {});
check('fixture declares the win32 platform', expected.platform === 'win32');
check('fixture derives eight normalized Windows items', Array.isArray(expected.items) && expected.items.length === 8);
check('normalizeWinItems reproduces the fixture exactly', sameJson(normalized, expected.items));
check('normalized Windows items are JSON-safe', jsonSafe(normalized) !== null);
check('normalized Windows ids are unique', new Set(normalized.map((item) => item.id)).size === normalized.length);
check(
  'normalized Windows categories are contract-valid',
  normalized.every((item) => validCategories.has(item.category)),
);
const winAdmin = normalized.filter((item) => item.requiresAdmin).map((item) => item.id).sort().join(',');
check(
  'Windows admin-only roots are the three system paths',
  winAdmin === 'delivery-optimization,system-temp,windows-update-downloads',
  winAdmin,
);
const recycle = normalized.find((item) => item.id === 'recycle-bin');
check(
  'Recycle Bin is a special trash entry, not a directory',
  recycle?.kind === 'recycle' && recycle?.category === 'trash' && recycle?.requiresAdmin === false && recycle?.path === 'Recycle Bin',
);
check(
  'win32 cleanupItems() advertises the same ids',
  sameJson(
    win32.cleanupItems().map((item) => item.id),
    expected.items.map((item) => item.id),
  ),
);
check(
  'win32 cleanupItems() entries expose only the public metadata keys',
  win32
    .cleanupItems()
    .every(
      (item) => isPlainObject(item) && sameJson(Object.keys(item).sort(), ['category', 'id', 'label', 'path', 'requiresAdmin']),
    ),
);
const emptyEnvItems = win32.__test.normalizeWinItems({});
check(
  'normalizeWinItems tolerates a missing environment',
  Array.isArray(emptyEnvItems) &&
    emptyEnvItems.length === 8 &&
    emptyEnvItems.filter((item) => item.kind === 'fs').every((item) => item.path === null),
);
const winDeleteIds = win32.__test.normalizeDeleteIds(['recycle-bin']);
check(
  'win32 id normalizer accepts a known id without side effects',
  winDeleteIds.ok === true && winDeleteIds.items[0].id === 'recycle-bin',
);
const winPathRefusal = await win32.deleteCleanup(['../../etc/passwd']);
check(
  'win32 deletion refuses caller paths before the platform guard',
  winPathRefusal.ok === false &&
    winPathRefusal.code === 'BAD_PARAMS' &&
    winPathRefusal.data.deletedBytes === 0 &&
    winPathRefusal.data.items.length === 0,
);
const winPlatformRefusal = await win32.deleteCleanup(['recycle-bin']);
check(
  'win32 deletion is disabled off Windows (no fs/PowerShell call)',
  winPlatformRefusal.ok === false &&
    winPlatformRefusal.code === 'UNSUPPORTED_PLATFORM' &&
    winPlatformRefusal.data.deletedBytes === 0,
);
const winScan = await win32.scanCleanup({ fresh: true });
check(
  'win32 scan degrades cleanly on a non-Windows host',
  winScan.platform === 'win32' &&
    winScan.items.length === 8 &&
    winScan.items.every((item) => item.exists === false && item.bytes === 0 && typeof item.error === 'string'),
);
check('win32 scan document is JSON-safe', jsonSafe(winScan) !== null && sameJson(JSON.parse(jsonSafe(winScan)), winScan));

// ---------------------------------------------------------------------------
section('9. Static source guards');
const darwinSource = readFileSync(join(hostDir, 'cleanup-darwin.js'), 'utf8');
const win32Source = readFileSync(join(hostDir, 'cleanup-win32.js'), 'utf8');
const actionsDarwinSource = readFileSync(join(hostDir, 'actions-darwin.js'), 'utf8');
const actionsWin32Source = readFileSync(join(hostDir, 'actions-win32.js'), 'utf8');

check('cleanup-win32.js source is ASCII-only', !/[^\x00-\x7F]/.test(win32Source));
check('actions-win32.js source is ASCII-only', !/[^\x00-\x7F]/.test(actionsWin32Source));
check(
  'cleanup-darwin.js imports only node: builtins',
  (darwinSource.match(/^import .* from '[^']+';/gm) ?? []).every((line) => line.includes("from 'node:")),
);
check(
  'cleanup-win32.js imports only node: builtins and the win.js bridge',
  (win32Source.match(/^import .* from '[^']+';/gm) ?? []).every(
    (line) => line.includes("from 'node:") || line.includes("from './win.js'"),
  ),
);
check(
  'cleanup-win32.js uses the PowerShell bridge for the Recycle Bin only',
  win32Source.includes('Clear-RecycleBin') && win32Source.includes("from './win.js'") && !win32Source.includes('child_process'),
);

const darwinRmCalls = darwinSource.match(/fsp\.rm\([^)]*/g) ?? [];
check(
  'cleanup-darwin fs.rm call sites only receive guarded variables',
  darwinRmCalls.length >= 3 && darwinRmCalls.every((call) => /^fsp\.rm\((safe|child)\b/.test(call)),
  `${darwinRmCalls.length} call(s)`,
);
const guardAt = darwinSource.indexOf('const safe = assertInsideAllowlist(target');
const darwinFirstRm = darwinSource.indexOf('fsp.rm(safe');
check('cleanup-darwin guards the target before removing it', guardAt !== -1 && darwinFirstRm > guardAt);
check(
  'cleanup-darwin defines the allowlist assertion',
  /function assertInsideAllowlist\(/.test(darwinSource) && /isAllowlistedPath\(target, allowlist\)/.test(darwinSource),
);
check(
  'cleanup-darwin resolves delete ids through the frozen allowlist map',
  /ITEM_BY_ID\.get\(id\)/.test(darwinSource) && /export async function deleteCleanup\(ids\)/.test(darwinSource),
);
check(
  'cleanup-darwin public delete signature takes ids, never a path',
  /export async function deleteCleanup\(ids\)/.test(darwinSource) && !/deleteCleanup\([^)]*path/i.test(darwinSource),
);

const win32RmCalls = win32Source.match(/fsp\.rm\([^)]*/g) ?? [];
check(
  'cleanup-win32 fs.rm call sites only receive the guarded variable',
  win32RmCalls.length >= 1 && win32RmCalls.every((call) => /^fsp\.rm\(safe\b/.test(call)),
);
const winGuardAt = win32Source.indexOf('const safe = assertInsideAllowlist(target');
const winFirstRm = win32Source.indexOf('fsp.rm(safe');
check('cleanup-win32 guards the target before removing it', winGuardAt !== -1 && winFirstRm > winGuardAt);
check(
  'cleanup-win32 resolves delete ids through the frozen allowlist map',
  /ITEM_BY_ID\.get\(id\)/.test(win32Source) && /export async function deleteCleanup\(ids\)/.test(win32Source),
);

check(
  'actions-darwin registers cleanup.delete as a spec and as a runner',
  actionsDarwinSource.includes("id: 'cleanup.delete'") &&
    actionsDarwinSource.includes("async 'cleanup.delete'(params)") &&
    actionsDarwinSource.includes("from './cleanup-darwin.js'"),
);
check(
  'actions-win32 registers cleanup.delete as a spec and as a runner',
  actionsWin32Source.includes("id: 'cleanup.delete'") &&
    actionsWin32Source.includes("'cleanup.delete': async") &&
    actionsWin32Source.includes("from './cleanup-win32.js'"),
);
check(
  'the cleanup modules bind fs.rm to node:fs/promises only',
  darwinSource.includes("from 'node:fs/promises'") && win32Source.includes("from 'node:fs/promises'"),
);
check(
  'both implementations catch per-item delete failures instead of throwing',
  /for \(const item of requested\.items\)[\s\S]{0,500}?try \{/.test(darwinSource) &&
    /catch \(error\) \{[\s\S]{0,200}?errorMessage\(error\)/.test(darwinSource) &&
    /for \(const item of requested\.items\)[\s\S]{0,500}?try \{/.test(win32Source) &&
    /catch \(error\) \{[\s\S]{0,200}?errorMessage\(error\)/.test(win32Source),
);

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'ALL CLEANUP CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} — ${passed} checks`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
