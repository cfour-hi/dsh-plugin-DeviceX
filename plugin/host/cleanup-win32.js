/**
 * Device X - cleanup scanner and deleter (Windows).
 *
 * Same public surface and safety model as `cleanup-darwin.js`: a fixed
 * allowlist of cache/temp/trash/update roots computed once from the Windows
 * environment, a bounded recursive size walk (`lstat` only, symlinks never
 * followed) and a delete path that only ever touches one of those fixed
 * absolute paths. Callers pass cleanup item ids, never paths.
 *
 * The Recycle Bin is the one special entry: it is not a plain directory, so
 * its size estimate and its deletion go through the shipped PowerShell bridge
 * (`Clear-RecycleBin -Force`), always defensively (an already-empty bin is a
 * success; a missing interpreter is a per-item error string).
 *
 * This source file is ASCII-only: the scripts it feeds to Windows PowerShell
 * are streamed to stdin and decoded with the console input code page.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/cleanup-win32
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { runPSJson } from './win.js';

/** Host platform for this implementation. */
export const PLATFORM = 'win32';

/** Scan cache TTL (ms). */
const SCAN_TTL = 60_000;
/** Maximum directory entries visited per root (scan and measure). */
const MAX_ENTRIES = 150_000;
/** Wall-clock budget per root (ms). */
const TIME_BUDGET_MS = 5_000;
/** Maximum ids accepted by one deletion request. */
const MAX_DELETE_IDS = 20;
/** Maximum diagnostic strings kept in one result. */
const MAX_ERRORS = 40;
/** Placeholder shown in the catalogue for the non-directory Recycle Bin. */
const RECYCLE_BIN_PATH = 'Recycle Bin';
/** Bound on the PowerShell probe/delete for the Recycle Bin (ms). */
const RECYCLE_TIMEOUT_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* Environment-derived allowlist                                             */
/* -------------------------------------------------------------------------- */

/**
 * First non-empty environment variable among `names`.
 * @param {Record<string, unknown>} env
 * @param {string[]} names
 * @returns {string|null}
 */
function pickEnv(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** Strip a trailing slash/backslash from a Windows base directory. */
function trimWindowsBase(value) {
  return value === null ? null : value.replace(/[\\/]+$/, '');
}

/** Join Windows path segments without relying on the host path module. */
function joinWindows(base, ...segments) {
  if (base === null) return null;
  let result = trimWindowsBase(base);
  for (const segment of segments) result += `\\${segment}`;
  return result;
}

/**
 * Build the frozen Windows cleanup catalogue from an environment object. Pure
 * (no filesystem, no PowerShell) so `scripts/fixtures/win32/cleanup.json` can
 * validate the mapping on any development host.
 *
 * @param {Record<string, unknown>} [env]
 * @returns {Array<{id: string, label: string, detail: string, category: string,
 *   path: string|null, requiresAdmin: boolean, kind: 'fs'|'recycle',
 *   mode: 'recreate'|'recycle'}>}
 */
function normalizeWinItems(env = process.env) {
  const systemRoot = trimWindowsBase(pickEnv(env, ['SystemRoot', 'windir']));
  const localAppData = trimWindowsBase(pickEnv(env, ['LOCALAPPDATA']));
  const temp = trimWindowsBase(pickEnv(env, ['TEMP', 'TMP']));
  return [
    {
      id: 'user-temp',
      label: 'User temp files',
      detail: '%TEMP%',
      category: 'temp',
      path: temp,
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'localappdata-temp',
      label: 'Local app temp files',
      detail: '%LOCALAPPDATA%\\Temp',
      category: 'temp',
      path: joinWindows(localAppData, 'Temp'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'crash-dumps',
      label: 'Crash dumps',
      detail: '%LOCALAPPDATA%\\CrashDumps',
      category: 'logs',
      path: joinWindows(localAppData, 'CrashDumps'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'thumbnail-cache',
      label: 'Explorer thumbnail cache',
      detail: '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer',
      category: 'cache',
      path: joinWindows(localAppData, 'Microsoft', 'Windows', 'Explorer'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'recycle-bin',
      label: 'Recycle Bin',
      detail: 'Recycle Bin (all drives)',
      category: 'trash',
      path: RECYCLE_BIN_PATH,
      requiresAdmin: false,
      kind: 'recycle',
      mode: 'recycle',
    },
    {
      id: 'system-temp',
      label: 'System temp files',
      detail: '%SystemRoot%\\Temp',
      category: 'temp',
      path: joinWindows(systemRoot, 'Temp'),
      requiresAdmin: true,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'windows-update-downloads',
      label: 'Windows Update downloads',
      detail: '%SystemRoot%\\SoftwareDistribution\\Download',
      category: 'updates',
      path: joinWindows(systemRoot, 'SoftwareDistribution', 'Download'),
      requiresAdmin: true,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'delivery-optimization',
      label: 'Delivery Optimization cache',
      detail: '%SystemRoot%\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization',
      category: 'updates',
      path: joinWindows(
        systemRoot,
        'ServiceProfiles',
        'NetworkService',
        'AppData',
        'Local',
        'Microsoft',
        'Windows',
        'DeliveryOptimization',
      ),
      requiresAdmin: true,
      kind: 'fs',
      mode: 'recreate',
    },
  ];
}

/** The frozen cleanup allowlist for this host, computed once at module load. */
const ITEMS = Object.freeze(normalizeWinItems(process.env).map((item) => Object.freeze(item)));

/** @type {Map<string, (typeof ITEMS)[number]>} */
const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

/** Shorten an error message to one JSON-friendly line. */
function shortErr(value, max = 220) {
  const text = String(value ?? 'unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

/** Normalise a thrown filesystem error into a `code: message` string. */
function errorMessage(error) {
  if (error && typeof error === 'object') {
    const code = typeof error.code === 'string' ? error.code : null;
    const message = 'message' in error ? String(error.message) : String(error);
    return shortErr(code && !message.startsWith(code) ? `${code}: ${message}` : message);
  }
  return shortErr(String(error ?? 'unknown error'));
}

/** True when `candidate` is `root` or lives beneath it (both already resolved). */
function isInside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** Every fixed absolute path the deletion path may ever touch. */
function allowlistPaths() {
  /** @type {Set<string>} */
  const allowed = new Set();
  for (const item of ITEMS) {
    if (item.kind === 'fs' && typeof item.path === 'string' && path.isAbsolute(item.path)) {
      allowed.add(path.resolve(item.path));
    }
  }
  return allowed;
}

/** True when `candidate` is exactly one of the allowlisted cleanup roots. */
function isAllowlistedPath(candidate, allowlist = allowlistPaths()) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  return allowlist.has(path.resolve(candidate));
}

/**
 * Refuse anything that is not exactly one of the allowlisted cleanup roots.
 * The returned resolved path is the only value the `fs.rm` path is ever given.
 */
function assertInsideAllowlist(target, allowlist = allowlistPaths()) {
  if (!isAllowlistedPath(target, allowlist)) {
    const error = new Error(`Refusing to delete a path outside the cleanup allowlist: ${String(target)}`);
    // @ts-expect-error - annotate the thrown Error for callers.
    error.code = 'PATH_NOT_ALLOWED';
    throw error;
  }
  return path.resolve(/** @type {string} */ (target));
}

/* -------------------------------------------------------------------------- */
/* Bounded size walk                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Recursive size walk. Uses `lstat` for every entry (never follows symlinks),
 * counts only regular files, and stops at a directory-entry cap or wall-clock
 * deadline. Unreadable directories are recorded and skipped, never thrown.
 * @param {string} root
 * @param {{maxEntries?: number, timeBudgetMs?: number}} [options]
 * @returns {Promise<{bytes: number, files: number, entries: number,
 *   truncated: string|null, errors: string[]}>}
 */
async function walkRoot(root, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const timeBudgetMs = options.timeBudgetMs ?? TIME_BUDGET_MS;
  const deadline = Date.now() + timeBudgetMs;
  /** @type {string[]} */
  const errors = [];
  let bytes = 0;
  let files = 0;
  let entries = 0;
  /** @type {string|null} */
  let truncated = null;
  /** @type {string[]} */
  let level = [root];

  outer: while (level.length > 0) {
    if (Date.now() > deadline) {
      truncated = `timed out after ${timeBudgetMs} ms`;
      break;
    }
    /** @type {string[]} */
    const next = [];
    for (const directory of level) {
      let names;
      try {
        names = await fsp.readdir(directory);
      } catch (error) {
        if (errors.length < 3) errors.push(`${directory}: ${errorMessage(error)}`);
        continue;
      }
      for (const name of names) {
        entries += 1;
        if (entries > maxEntries) {
          truncated = `truncated at ${maxEntries} entries`;
          break outer;
        }
        if ((entries & 255) === 0 && Date.now() > deadline) {
          truncated = `timed out after ${timeBudgetMs} ms`;
          break outer;
        }
        const full = path.join(directory, name);
        let stat;
        try {
          stat = await fsp.lstat(full);
        } catch (error) {
          if (errors.length < 3) errors.push(`${full}: ${errorMessage(error)}`);
          continue;
        }
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          next.push(full);
          continue;
        }
        if (stat.isFile()) {
          bytes += stat.size;
          files += 1;
        }
      }
    }
    level = next;
  }

  return { bytes, files, entries, truncated, errors };
}

/* -------------------------------------------------------------------------- */
/* Recycle Bin (PowerShell bridge)                                            */
/* -------------------------------------------------------------------------- */

const PS_HEAD = "$ErrorActionPreference='Stop';";

const RECYCLE_SCAN_SCRIPT = `${PS_HEAD}
$shell = New-Object -ComObject Shell.Application;
$bin = $shell.Namespace(0xA);
$bytes = [long]0;
$count = 0;
try {
  if ($null -ne $bin) {
    foreach ($entry in @($bin.Items())) {
      $count += 1;
      try { $bytes += [long]$entry.ExtendedProperty('System.Size') } catch { }
    }
  }
} finally {
  if ($null -ne $shell) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
@{bytes=$bytes; files=$count} | ConvertTo-Json -Compress`;

const RECYCLE_DELETE_SCRIPT = `${PS_HEAD}
$shell = New-Object -ComObject Shell.Application;
$bin = $shell.Namespace(0xA);
$alreadyEmpty = $false;
try {
  if ($null -ne $bin -and @($bin.Items()).Count -eq 0) { $alreadyEmpty = $true }
  if (-not $alreadyEmpty) {
    Clear-RecycleBin -Force -ErrorAction Stop;
  }
} catch {
  if ($null -ne $shell.Namespace(0xA) -and @($shell.Namespace(0xA).Items()).Count -eq 0) { $alreadyEmpty = $true }
  elseif ([string]$_.Exception.Message -match '(?i)empty') { $alreadyEmpty = $true }
  else { throw }
} finally {
  if ($null -ne $shell) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
@{alreadyEmpty=$alreadyEmpty} | ConvertTo-Json -Compress`;

/**
 * Estimate the Recycle Bin's size through Shell.Application. A failed probe is
 * a 0-byte estimate plus an error string, never a throw.
 * @param {(typeof ITEMS)[number]} item
 * @returns {Promise<object>}
 */
async function scanRecycleBin(item) {
  const base = {
    id: item.id,
    label: item.label,
    detail: item.detail,
    category: item.category,
    path: item.path,
    bytes: 0,
    files: 0,
    requiresAdmin: item.requiresAdmin,
    exists: true,
    error: null,
  };
  if (process.platform !== 'win32') {
    return { ...base, exists: false, error: 'Recycle Bin size is only available on a Windows host.' };
  }
  const result = await runPSJson(RECYCLE_SCAN_SCRIPT, { timeout: 15_000 });
  if (!result.ok) return { ...base, error: shortErr(result.error || 'Recycle Bin size unavailable.') };
  const bytes = Number(result.data?.bytes);
  const files = Number(result.data?.files);
  return {
    ...base,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    files: Number.isFinite(files) && files > 0 ? files : 0,
  };
}

/**
 * Empty the Recycle Bin through `Clear-RecycleBin -Force`. Already-empty and
 * missing-interpreter cases are reported, never thrown.
 * @returns {Promise<{ok: boolean, bytes: number, files: number, message: string}>}
 */
async function emptyRecycleBin() {
  if (process.platform !== 'win32') {
    return { ok: false, bytes: 0, files: 0, message: 'Recycle Bin deletion is only available on a Windows host.' };
  }
  const result = await runPSJson(RECYCLE_DELETE_SCRIPT, { timeout: RECYCLE_TIMEOUT_MS });
  if (!result.ok) {
    return { ok: false, bytes: 0, files: 0, message: shortErr(result.error || 'Could not empty the Recycle Bin.') };
  }
  const alreadyEmpty = result.data?.alreadyEmpty === true;
  return {
    ok: true,
    bytes: 0,
    files: 0,
    message: alreadyEmpty ? 'Recycle Bin is already empty.' : 'Emptied the Recycle Bin.',
  };
}

/* -------------------------------------------------------------------------- */
/* Deletion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Remove one allowlisted directory and recreate it empty.
 * @param {string} target
 * @param {{recreate?: boolean}} [options]
 * @param {Set<string>} [allowlist]
 * @returns {Promise<{ok: boolean, bytes: number, files: number, message: string}>}
 */
async function removeTree(target, options = {}, allowlist = allowlistPaths()) {
  const safe = assertInsideAllowlist(target, allowlist);
  let stat;
  try {
    stat = await fsp.lstat(safe);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      if (options.recreate === true) {
        await fsp.mkdir(safe, { recursive: true });
        return { ok: true, bytes: 0, files: 0, message: 'Recreated the empty cleanup directory.' };
      }
      return { ok: true, bytes: 0, files: 0, message: 'Already empty.' };
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, bytes: 0, files: 0, message: 'Refusing to follow a symbolic link.' };
  }
  let bytes = 0;
  let files = 0;
  if (stat.isDirectory()) {
    const walk = await walkRoot(safe);
    bytes = walk.bytes;
    files = walk.files;
    await fsp.rm(safe, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
  } else {
    bytes = stat.isFile() ? stat.size : 0;
    files = stat.isFile() ? 1 : 0;
    await fsp.rm(safe, { force: true, maxRetries: 2, retryDelay: 150 });
  }
  if (options.recreate === true) await fsp.mkdir(safe, { recursive: true });
  return {
    ok: true,
    bytes,
    files,
    message: files > 0 ? `Removed ${files} file(s), ${bytes} byte(s).` : 'Removed the item.',
  };
}

/**
 * Delete one resolved allowlist entry (Windows only).
 * @param {(typeof ITEMS)[number]} item
 * @returns {Promise<{ok: boolean, bytes: number, files: number, message: string}>}
 */
async function deleteItem(item) {
  if (item.kind === 'recycle') return emptyRecycleBin();
  if (item.kind !== 'fs') {
    return { ok: false, bytes: 0, files: 0, message: `Unsupported cleanup item kind: ${String(item.kind)}` };
  }
  if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
    return { ok: false, bytes: 0, files: 0, message: 'Cleanup item path is not configured on this host.' };
  }
  return removeTree(item.path, { recreate: item.mode === 'recreate' });
}

/**
 * Normalise and validate a deletion request. Only ids from {@link cleanupItems}
 * are accepted; caller paths, duplicate ids and oversized batches are refused.
 * @param {unknown} ids
 * @returns {{ok: true, items: Array<(typeof ITEMS)[number]>} | {ok: false, message: string}}
 */
function normalizeDeleteIds(ids) {
  /** @type {unknown[]} */
  let values;
  if (Array.isArray(ids)) {
    values = ids;
  } else if (typeof ids === 'string') {
    values = ids.split(',');
  } else {
    return {
      ok: false,
      message: 'Parameter "ids" must be an array of cleanup item ids (or a comma separated string).',
    };
  }
  /** @type {string[]} */
  const cleaned = [];
  for (const value of values) {
    if (typeof value !== 'string') return { ok: false, message: 'Cleanup item ids must be strings.' };
    const id = value.trim();
    if (id !== '') cleaned.push(id);
  }
  if (cleaned.length < 1 || cleaned.length > MAX_DELETE_IDS) {
    return { ok: false, message: `Parameter "ids" must contain 1 to ${MAX_DELETE_IDS} cleanup item ids.` };
  }
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<(typeof ITEMS)[number]>} */
  const items = [];
  for (const id of cleaned) {
    if (seen.has(id)) return { ok: false, message: `Duplicate cleanup item id: ${id}` };
    seen.add(id);
    const item = ITEM_BY_ID.get(id);
    if (!item) return { ok: false, message: `Unknown cleanup item id: ${id}` };
    items.push(item);
  }
  return { ok: true, items };
}

/**
 * Delete the contents of the given allowlisted cleanup items.
 *
 * Never accepts a path: each id maps to its fixed absolute allowlist entry.
 * Per-item failures (admin-only roots, locked files, missing PowerShell) are
 * reported in `data.items[].message`; the function does not throw.
 *
 * @param {unknown} ids cleanup item ids (array or comma separated string)
 * @returns {Promise<{ok: boolean, message: string, code?: string,
 *   data: {deletedBytes: number, items: Array<{id: string, ok: boolean, bytes: number, message: string}>}}>}
 */
export async function deleteCleanup(ids) {
  const requested = normalizeDeleteIds(ids);
  if (requested.ok !== true) {
    return {
      ok: false,
      message: requested.message,
      code: 'BAD_PARAMS',
      data: { deletedBytes: 0, items: [] },
    };
  }
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: 'The Windows cleanup implementation can only delete files on a Windows host.',
      code: 'UNSUPPORTED_PLATFORM',
      data: { deletedBytes: 0, items: [] },
    };
  }
  let deletedBytes = 0;
  let succeeded = 0;
  /** @type {Array<{id: string, ok: boolean, bytes: number, message: string}>} */
  const results = [];
  for (const item of requested.items) {
    try {
      const outcome = await deleteItem(item);
      if (outcome.ok) {
        succeeded += 1;
        deletedBytes += outcome.bytes;
      }
      results.push({ id: item.id, ok: outcome.ok, bytes: outcome.bytes, message: outcome.message });
    } catch (error) {
      results.push({ id: item.id, ok: false, bytes: 0, message: errorMessage(error) });
    }
  }
  const ok = succeeded === results.length;
  const message = ok
    ? results.length === 1
      ? results[0].message
      : `Cleaned ${results.length} item(s), ${deletedBytes} byte(s) total.`
    : `Cleaned ${succeeded} of ${results.length} item(s); ${results.length - succeeded} failed.`;
  return { ok, message, data: { deletedBytes, items: results } };
}

/* -------------------------------------------------------------------------- */
/* Recycle Bin move (uninstall leftovers)                                     */
/* -------------------------------------------------------------------------- */

/** Move one path to the Recycle Bin; never falls back to a permanent delete. */
const RECYCLE_MOVE_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$target = $env:DEVICEX_ARG_PATH
if ([string]::IsNullOrWhiteSpace($target)) { throw 'No path was supplied.' }
if (-not (Test-Path -LiteralPath $target)) { throw "Path not found: $target" }
$item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "Refusing to recycle a reparse point: $target"
}
if ($item.PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
    $target,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
    $target,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
if (Test-Path -LiteralPath $target) { throw "The item is still present after the Recycle Bin move: $target" }
@{ ok = $true } | ConvertTo-Json -Compress`;

/** Wall-clock budget for one Recycle Bin move (ms). */
const RECYCLE_MOVE_TIMEOUT_MS = 120_000;

/**
 * Move one absolute path to the Recycle Bin.
 *
 * `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory/DeleteFile` is the
 * supported wrapper over `SHFileOperation` + `FOF_ALLOWUNDO`. Verified on
 * Windows 10 22H2 with Windows PowerShell 5.1: the item appears in the Recycle
 * Bin and restores to its original path with its contents intact.
 *
 * Safety: callers must already have resolved the path through a footprint scan
 * token. This function additionally refuses non-absolute paths, filesystem
 * roots and reparse points (junctions/symlinks), and reports a failed move
 * instead of ever falling back to a permanent delete.
 *
 * @param {string} target absolute path
 * @returns {Promise<{ok: boolean, message: string, code?: string}>}
 */
export async function recycleToBin(target) {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: 'Moving items to the Recycle Bin is only available on a Windows host.',
      code: 'UNSUPPORTED_PLATFORM',
    };
  }
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    return { ok: false, message: 'Refusing to recycle a path that is not absolute.', code: 'BAD_PARAMS' };
  }
  const resolved = path.resolve(target);
  if (resolved === path.parse(resolved).root) {
    return { ok: false, message: `Refusing to recycle a filesystem root: ${resolved}`, code: 'PATH_NOT_ALLOWED' };
  }
  const result = await runPSJson(RECYCLE_MOVE_SCRIPT, {
    env: { DEVICEX_ARG_PATH: resolved },
    timeout: RECYCLE_MOVE_TIMEOUT_MS,
  });
  if (!result.ok) {
    return {
      ok: false,
      message: shortErr(result.error || 'Could not move the item to the Recycle Bin.'),
      code: 'RECYCLE_FAILED',
    };
  }
  return { ok: true, message: 'Moved to the Recycle Bin.' };
}

/* -------------------------------------------------------------------------- */
/* Scan                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Scan one allowlist entry. A missing path is a normal "empty" result; any
 * other failure becomes a string in `error` and the scan continues.
 * @param {(typeof ITEMS)[number]} item
 * @returns {Promise<object>}
 */
async function scanItem(item) {
  /** @type {Record<string, any>} */
  const base = {
    id: item.id,
    label: item.label,
    detail: item.detail,
    category: item.category,
    path: item.path,
    bytes: 0,
    files: 0,
    requiresAdmin: item.requiresAdmin,
    exists: false,
    error: null,
  };
  if (process.platform !== 'win32') {
    return { ...base, error: 'Windows cleanup is only available on a Windows host.' };
  }
  if (item.kind === 'recycle') return scanRecycleBin(item);
  if (item.kind !== 'fs' || typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
    return { ...base, error: 'Cleanup item path is not configured on this host.' };
  }
  let stat;
  try {
    stat = await fsp.lstat(item.path);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return base;
    return { ...base, error: errorMessage(error) };
  }
  if (stat.isSymbolicLink()) return { ...base, exists: true, error: 'Root path is a symbolic link; skipped.' };
  if (!stat.isDirectory()) {
    return {
      ...base,
      exists: true,
      bytes: stat.isFile() ? stat.size : 0,
      files: stat.isFile() ? 1 : 0,
    };
  }
  const walk = await walkRoot(item.path);
  const error = walk.truncated ?? walk.errors[0] ?? null;
  return {
    ...base,
    exists: true,
    bytes: walk.bytes,
    files: walk.files,
    error: error === null ? null : shortErr(error),
  };
}

/**
 * Build one complete scan document.
 * @returns {Promise<object>}
 */
async function buildScan() {
  const startedAt = Date.now();
  /** @type {string[]} */
  const errors = [];
  const items = await Promise.all(
    ITEMS.map(async (item) => {
      try {
        const scanned = await scanItem(item);
        if (scanned.error) errors.push(`${item.id}: ${scanned.error}`);
        return scanned;
      } catch (error) {
        const message = shortErr(errorMessage(error));
        errors.push(`${item.id}: ${message}`);
        return {
          id: item.id,
          label: item.label,
          detail: item.detail,
          category: item.category,
          path: item.path,
          bytes: 0,
          files: 0,
          requiresAdmin: item.requiresAdmin,
          exists: false,
          error: message,
        };
      }
    }),
  );
  let totalBytes = 0;
  let totalFiles = 0;
  for (const item of items) {
    totalBytes += Number.isFinite(item.bytes) ? item.bytes : 0;
    totalFiles += Number.isFinite(item.files) ? item.files : 0;
  }
  return {
    platform: PLATFORM,
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    items,
    totalBytes,
    totalFiles,
    errors: errors.slice(0, MAX_ERRORS),
  };
}

/** @type {{value: object, at: number}|null} */
let scanCache = null;
/** @type {Promise<object>|null} */
let scanPending = null;

/**
 * Scan every allowlisted cleanup location. The result is cached for 60 s; pass
 * `{fresh: true}` to force a new scan.
 *
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<object>} the {@link scanCleanup} contract document.
 */
export async function scanCleanup(options = {}) {
  const fresh = options?.fresh === true;
  const now = Date.now();
  if (!fresh && scanCache !== null && now - scanCache.at < SCAN_TTL) return scanCache.value;
  if (scanPending !== null) return scanPending;
  const task = (async () => {
    const value = await buildScan();
    scanCache = { value, at: Date.now() };
    return value;
  })().finally(() => {
    if (scanPending === task) scanPending = null;
  });
  scanPending = task;
  return task;
}

/**
 * The cleanup allowlist as public metadata (ids, labels, categories and fixed
 * paths). Used by the action validator, tests and client labelling.
 * @returns {Array<{id: string, label: string, category: string,
 *   requiresAdmin: boolean, path: string|null}>}
 */
export function cleanupItems() {
  return ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    requiresAdmin: item.requiresAdmin,
    path: item.path,
  }));
}

/** Test seam: pure helpers (the offline Windows fixture harness never touches the fs). */
export const __test = {
  PLATFORM,
  ITEMS,
  SCAN_TTL,
  MAX_ENTRIES,
  TIME_BUDGET_MS,
  MAX_DELETE_IDS,
  normalizeWinItems,
  normalizeDeleteIds,
  isAllowlistedPath,
  assertInsideAllowlist,
  walkRoot,
  removeTreeAt(target, options, allowlist) {
    return removeTree(target, options, allowlist);
  },
  clearCache() {
    scanCache = null;
    scanPending = null;
  },
  cacheStatus() {
    return {
      cached: scanCache !== null,
      ageMs: scanCache === null ? null : Date.now() - scanCache.at,
      ttlMs: SCAN_TTL,
    };
  },
};
