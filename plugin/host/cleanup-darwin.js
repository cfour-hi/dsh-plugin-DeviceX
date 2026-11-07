/**
 * Device X — cleanup scanner and deleter (macOS).
 *
 * A fixed allowlist of cache/log/trash/developer roots, a bounded recursive
 * size walk (`lstat` only, symlinks never followed) and a delete path that can
 * only ever touch one of those fixed absolute paths. Callers pass cleanup item
 * ids, never paths: `deleteCleanup(['user-caches'])` is the whole public
 * surface, and an id that is not in the allowlist is refused before any
 * filesystem call.
 *
 * Everything returned is JSON-safe and no public function throws: per-item
 * failures (permissions, disappearing files, admin-only roots) are reported in
 * the result instead.
 *
 * @module @cfour-hi/dsh-devicex/host/cleanup-darwin
 */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Host platform for this implementation. */
export const PLATFORM = 'darwin';

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

const HOME = os.homedir();

/**
 * The frozen cleanup allowlist. Every `path` here is a fixed absolute path
 * computed once at module load; nothing in this list is ever derived from a
 * request.
 *
 * `mode: 'recreate'` removes the whole directory and recreates it empty;
 * `mode: 'empty'` removes only the directory's contents (Trash keeps its own
 * directory and permissions).
 */
const ITEMS = Object.freeze(
  [
    {
      id: 'user-caches',
      label: 'User caches',
      detail: '~/Library/Caches',
      category: 'cache',
      path: path.join(HOME, 'Library', 'Caches'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'user-logs',
      label: 'User logs',
      detail: '~/Library/Logs',
      category: 'logs',
      path: path.join(HOME, 'Library', 'Logs'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'trash',
      label: 'Trash',
      detail: '~/.Trash',
      category: 'trash',
      path: path.join(HOME, '.Trash'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'empty',
    },
    {
      id: 'xcode-derived-data',
      label: 'Xcode DerivedData',
      detail: '~/Library/Developer/Xcode/DerivedData',
      category: 'developer',
      path: path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'crash-reports',
      label: 'Crash reporter logs',
      detail: '~/Library/Application Support/CrashReporter',
      category: 'logs',
      path: path.join(HOME, 'Library', 'Application Support', 'CrashReporter'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'core-simulator-caches',
      label: 'CoreSimulator caches',
      detail: '~/Library/Developer/CoreSimulator/Caches',
      category: 'developer',
      path: path.join(HOME, 'Library', 'Developer', 'CoreSimulator', 'Caches'),
      requiresAdmin: false,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'system-caches',
      label: 'System caches',
      detail: '/Library/Caches',
      category: 'cache',
      path: '/Library/Caches',
      requiresAdmin: true,
      kind: 'fs',
      mode: 'recreate',
    },
    {
      id: 'system-logs',
      label: 'System logs',
      detail: '/Library/Logs',
      category: 'logs',
      path: '/Library/Logs',
      requiresAdmin: true,
      kind: 'fs',
      mode: 'recreate',
    },
  ].map((item) => Object.freeze(item)),
);

/** @type {Map<string, (typeof ITEMS)[number]>} */
const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Shorten an error message to one JSON-friendly line.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function shortErr(value, max = 220) {
  const text = String(value ?? 'unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Normalise a thrown filesystem error into a `code: message` string.
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error && typeof error === 'object') {
    const code = typeof error.code === 'string' ? error.code : null;
    const message = 'message' in error ? String(error.message) : String(error);
    return shortErr(code && !message.startsWith(code) ? `${code}: ${message}` : message);
  }
  return shortErr(String(error ?? 'unknown error'));
}

/**
 * True when `candidate` is `root` or lives beneath it (both already resolved).
 * @param {string} candidate
 * @param {string} root
 * @returns {boolean}
 */
function isInside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * Every fixed absolute path the deletion path may ever touch.
 * @returns {Set<string>}
 */
function allowlistPaths() {
  /** @type {Set<string>} */
  const allowed = new Set();
  for (const item of ITEMS) {
    if (typeof item.path === 'string' && path.isAbsolute(item.path)) {
      allowed.add(path.resolve(item.path));
    }
  }
  return allowed;
}

/**
 * True when `candidate` is exactly one of the allowlisted cleanup roots.
 * @param {unknown} candidate
 * @param {Set<string>} [allowlist]
 * @returns {boolean}
 */
function isAllowlistedPath(candidate, allowlist = allowlistPaths()) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  return allowlist.has(path.resolve(candidate));
}

/**
 * Refuse anything that is not exactly one of the allowlisted cleanup roots.
 * The returned value is the resolved absolute path and is the only value the
 * `fs.rm` path is ever given.
 * @param {unknown} target
 * @param {Set<string>} [allowlist]
 * @returns {string}
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
 * @typedef {object} WalkResult
 * @property {number} bytes bytes of regular files
 * @property {number} files number of regular files
 * @property {number} entries directory entries visited
 * @property {string|null} truncated reason when the caps stopped the walk
 * @property {string[]} errors first few unreadable directories
 */

/**
 * Recursive size walk. Uses `lstat` for every entry (never follows symlinks),
 * counts only regular files, and stops at a directory-entry cap or wall-clock
 * deadline. Unreadable directories are recorded and skipped, never thrown.
 *
 * @param {string} root
 * @param {{maxEntries?: number, timeBudgetMs?: number}} [options]
 * @returns {Promise<WalkResult>}
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
/* Deletion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Remove one allowlisted root. Cache/developer/log roots are recreated empty
 * so the owning app finds its directory again; Trash-like roots are handled by
 * {@link emptyDirectory} instead.
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
 * Empty one allowlisted directory but keep the directory itself (Trash).
 * @param {string} target
 * @param {Set<string>} [allowlist]
 * @returns {Promise<{ok: boolean, bytes: number, files: number, message: string}>}
 */
async function emptyDirectory(target, allowlist = allowlistPaths()) {
  const safe = assertInsideAllowlist(target, allowlist);
  let names;
  try {
    names = await fsp.readdir(safe);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: true, bytes: 0, files: 0, message: 'Already empty.' };
    }
    throw error;
  }
  let bytes = 0;
  let files = 0;
  /** @type {string[]} */
  const failures = [];
  for (const name of names) {
    const child = path.join(safe, name);
    if (!isInside(child, safe)) continue;
    try {
      const stat = await fsp.lstat(child);
      if (stat.isSymbolicLink()) {
        // Remove the link itself, never its target.
        await fsp.rm(child, { force: true });
        continue;
      }
      if (stat.isDirectory()) {
        const walk = await walkRoot(child);
        bytes += walk.bytes;
        files += walk.files;
        await fsp.rm(child, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        continue;
      }
      if (stat.isFile()) {
        bytes += stat.size;
        files += 1;
      }
      await fsp.rm(child, { force: true });
    } catch (error) {
      if (failures.length < 3) failures.push(`${name}: ${errorMessage(error)}`);
    }
  }
  return {
    ok: failures.length === 0,
    bytes,
    files,
    message:
      failures.length === 0
        ? `Emptied ${files} file(s), ${bytes} byte(s).`
        : `Emptied the item with ${failures.length} failure(s): ${failures.join('; ')}`,
  };
}

/**
 * Delete one resolved allowlist entry.
 * @param {(typeof ITEMS)[number]} item
 * @returns {Promise<{ok: boolean, bytes: number, files: number, message: string}>}
 */
async function deleteItem(item) {
  if (item.kind !== 'fs') {
    return { ok: false, bytes: 0, files: 0, message: `Unsupported cleanup item kind: ${String(item.kind)}` };
  }
  if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
    return { ok: false, bytes: 0, files: 0, message: 'Cleanup item path is not configured on this host.' };
  }
  if (item.mode === 'empty') return emptyDirectory(item.path);
  return removeTree(item.path, { recreate: item.mode === 'recreate' });
}

/**
 * Normalise and validate a deletion request. Only ids from {@link cleanupItems}
 * are accepted; caller paths, duplicate ids and oversized batches are refused.
 *
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
 * Per-item failures (admin-only roots, locked files) are reported in
 * `data.items[].message`; the function does not throw.
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
 * @returns {Promise<{platform: string, generatedAt: number, durationMs: number,
 *   items: Array<{id: string, label: string, detail: string,
 *   category: 'cache'|'logs'|'trash'|'temp'|'developer'|'updates',
 *   path: string, bytes: number, files: number, requiresAdmin: boolean,
 *   exists: boolean, error: string|null}>, totalBytes: number,
 *   totalFiles: number, errors: string[]}>}
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
 *   requiresAdmin: boolean, path: string}>}
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

/** Test seam: pure helpers and injected-root sandbox hooks. */
export const __test = {
  PLATFORM,
  ITEMS,
  SCAN_TTL,
  MAX_ENTRIES,
  TIME_BUDGET_MS,
  MAX_DELETE_IDS,
  normalizeDeleteIds,
  isAllowlistedPath,
  assertInsideAllowlist,
  walkRoot,
  /**
   * Remove an injected root (test sandbox only). The caller must pass the
   * sandbox path as its own allowlist; the public delete path never does this.
   * @param {string} target
   * @param {{recreate?: boolean}} [options]
   * @param {Set<string>} allowlist
   */
  removeTreeAt(target, options, allowlist) {
    return removeTree(target, options, allowlist);
  },
  /**
   * Empty an injected directory (test sandbox only).
   * @param {string} target
   * @param {Set<string>} allowlist
   */
  emptyDirectoryAt(target, allowlist) {
    return emptyDirectory(target, allowlist);
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
