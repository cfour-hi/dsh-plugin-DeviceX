/**
 * Device X — uninstall footprint dispatcher and scan-token store.
 *
 * The public surface is `scanFootprint({path, fresh})`. It returns a report
 * whose item paths stay on the server: the client receives an opaque `scanId`
 * plus per-item opaque ids, and `app.uninstall` accepts only
 * `(scanId, itemIds[])` for cleanup. That keeps the shipped safety property —
 * a deletion request can never name a path — while still letting the user pick
 * individual leftover directories, which are only known at runtime.
 *
 * A token is single-use, expires after {@link TOKEN_TTL_MS}, and remembers the
 * exact roots the scan was allowed to produce so a tampered id cannot reach
 * anything else.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/footprint
 */
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import * as darwin from './footprint-darwin.js';
import * as win32 from './footprint-win32.js';

/** Host platform. */
export const PLATFORM = process.platform;

/** Scan token lifetime (ms). */
export const TOKEN_TTL_MS = 10 * 60_000;
/** Maximum concurrently retained tokens. */
export const MAX_TOKENS = 16;
/** Cached report reuse window (ms); a re-open of the same dialog must be cheap. */
export const REPORT_TTL_MS = 60_000;

const impl = process.platform === 'win32' ? win32 : darwin;

/**
 * @typedef {object} ScanRecord
 * @property {string} scanId
 * @property {number} at
 * @property {boolean} consumed
 * @property {string} appPath
 * @property {Map<string, {path: string, requiresAdmin: boolean, kind: string, bytes: number}>} items
 * @property {string[]} roots the exact root prefixes this scan could produce
 */

/** @type {Map<string, ScanRecord>} */
const tokens = new Map();

/** @type {Map<string, {at: number, report: object}>} */
const reportCache = new Map();

/**
 * Register a finished report as a single-use cleanup token.
 *
 * The roots are derived from what the platform implementation declares, not
 * from the report, so a bug in the scanner cannot widen the deletion boundary.
 *
 * @param {object} report raw platform report
 * @param {readonly string[]} roots absolute root prefixes the scan was allowed to use
 * @returns {string} the opaque scan id
 */
function registerToken(report, roots) {
  const now = Date.now();
  for (const [id, record] of tokens) {
    if (record.consumed || now - record.at > TOKEN_TTL_MS) tokens.delete(id);
  }
  while (tokens.size >= MAX_TOKENS) {
    const oldest = tokens.keys().next();
    if (oldest.done) break;
    tokens.delete(oldest.value);
  }
  const scanId = randomUUID();
  /** @type {Map<string, {path: string, requiresAdmin: boolean, kind: string, bytes: number}>} */
  const items = new Map();
  for (const item of Array.isArray(report?.items) ? report.items : []) {
    if (typeof item?.id !== 'string' || typeof item?.path !== 'string') continue;
    const bytes = Number(item.bytes);
    items.set(item.id, {
      path: item.path,
      requiresAdmin: item.requiresAdmin === true,
      kind: typeof item.kind === 'string' ? item.kind : 'data',
      // Kept so the pipeline can report how much the Trash now holds. The
      // number is a measurement from scan time, not a guarantee: the directory
      // may have changed between the scan and the move.
      bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    });
  }
  tokens.set(scanId, {
    scanId,
    at: now,
    consumed: false,
    appPath: typeof report?.appPath === 'string' ? report.appPath : '',
    items,
    roots: Array.isArray(roots) ? roots.slice() : [],
  });
  return scanId;
}

/**
 * Drop expired entries from the report cache.
 * @param {number} now
 */
function pruneCache(now) {
  for (const [key, entry] of reportCache) {
    if (now - entry.at > REPORT_TTL_MS) reportCache.delete(key);
  }
}

/**
 * Scan one application's leftover footprint (read-only).
 *
 * @param {{path?: string, fresh?: boolean}} [options]
 * @returns {Promise<object>} `FootprintReport` including its `scanId`
 */
export async function scanFootprint(options = {}) {
  const appPath = typeof options.path === 'string' ? options.path.trim() : '';
  const fresh = options.fresh === true;
  const now = Date.now();
  pruneCache(now);

  if (appPath === '') {
    return {
      scanId: '',
      appPath: '',
      bundleId: null,
      sandboxed: false,
      targetedRoots: [],
      generatedAt: now,
      durationMs: 0,
      items: [],
      totalBytes: 0,
      selectedBytes: 0,
      errors: ['missing application path'],
    };
  }

  const key = path.resolve(appPath);
  const cached = reportCache.get(key);
  if (!fresh && cached && now - cached.at <= REPORT_TTL_MS) {
    const scanId = registerToken(cached.report, impl.__test?.SAFE_ROOTS ?? []);
    return { ...cached.report, scanId };
  }

  const report = await impl.scanFootprint({ appPath: key });
  reportCache.set(key, { at: now, report });
  const scanId = registerToken(report, impl.__test?.SAFE_ROOTS ?? []);
  return { ...report, scanId };
}

/**
 * @typedef {object} ResolvedItem
 * @property {string} id
 * @property {string} path
 * @property {boolean} requiresAdmin
 * @property {string} kind
 * @property {number} bytes measured at scan time
 */

/**
 * Resolve requested item ids through a scan token.
 *
 * Every rejection reason is explicit so the caller can explain it: an unknown
 * or expired token, an id that belongs to a different scan, a path that left
 * the recorded roots, a symbolic link, or a root directory itself.
 *
 * @param {unknown} scanId
 * @param {unknown} itemIds
 * @returns {{ok: true, items: ResolvedItem[], appPath: string} | {ok: false, message: string, code: string}}
 */
export function resolveScanItems(scanId, itemIds) {
  if (typeof scanId !== 'string' || scanId === '') {
    return { ok: false, message: 'A scan id is required to clean up leftovers.', code: 'BAD_PARAMS' };
  }
  const record = tokens.get(scanId);
  if (record === undefined) {
    return { ok: false, message: 'This scan has expired. Re-open the uninstall dialog.', code: 'SCAN_NOT_FOUND' };
  }
  if (record.consumed) {
    return { ok: false, message: 'This scan was already used. Re-open the uninstall dialog.', code: 'SCAN_CONSUMED' };
  }
  if (Date.now() - record.at > TOKEN_TTL_MS) {
    tokens.delete(scanId);
    return { ok: false, message: 'This scan has expired. Re-open the uninstall dialog.', code: 'SCAN_EXPIRED' };
  }

  /** @type {unknown[]} */
  let requested;
  if (Array.isArray(itemIds)) requested = itemIds;
  else if (typeof itemIds === 'string') requested = itemIds.split(',');
  else return { ok: false, message: 'itemIds must be an array of scan item ids.', code: 'BAD_PARAMS' };

  /** @type {ResolvedItem[]} */
  const resolved = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const raw of requested) {
    if (typeof raw !== 'string') {
      return { ok: false, message: 'Scan item ids must be strings.', code: 'BAD_PARAMS' };
    }
    const id = raw.trim();
    if (id === '') continue;
    if (seen.has(id)) {
      return { ok: false, message: `Duplicate scan item id: ${id}`, code: 'BAD_PARAMS' };
    }
    seen.add(id);
    const item = record.items.get(id);
    if (item === undefined) {
      return {
        ok: false,
        message: `Item ${id} does not belong to this scan.`,
        code: 'ITEM_NOT_IN_SCAN',
      };
    }
    if (item.requiresAdmin) {
      return {
        ok: false,
        message: `${item.path} needs administrator rights and cannot be removed by this plugin.`,
        code: 'REQUIRES_ADMIN',
      };
    }
    const absolute = path.resolve(item.path);
    if (!isInsideRoots(absolute, record.roots)) {
      return {
        ok: false,
        message: `Refusing to touch a path outside the scanned roots: ${absolute}`,
        code: 'PATH_NOT_ALLOWED',
      };
    }
    if (absolute === path.dirname(absolute)) {
      return { ok: false, message: `Refusing to remove a filesystem root: ${absolute}`, code: 'PATH_NOT_ALLOWED' };
    }
    resolved.push({ id, path: absolute, requiresAdmin: false, kind: item.kind, bytes: item.bytes });
  }

  if (resolved.length === 0) {
    return { ok: false, message: 'No scan items were selected.', code: 'BAD_PARAMS' };
  }
  return { ok: true, items: resolved, appPath: record.appPath };
}

/**
 * True when `candidate` is one of the allowed roots or lives beneath one.
 * @param {string} candidate absolute, resolved
 * @param {string[]} roots absolute roots
 * @returns {boolean}
 */
export function isInsideRoots(candidate, roots) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  for (const root of Array.isArray(roots) ? roots : []) {
    if (typeof root !== 'string' || root === '') continue;
    if (candidate === root) return true;
    if (candidate.startsWith(`${root}${path.sep}`)) return true;
  }
  return false;
}

/**
 * Mark a token used. Called only after the cleanup actually ran, so a failed
 * pipeline can be retried with the same dialog still open.
 * @param {string} scanId
 */
export function consumeToken(scanId) {
  const record = tokens.get(scanId);
  if (record !== undefined) record.consumed = true;
}

/** Test seam: clear all stores. */
export function __resetForTests() {
  tokens.clear();
  reportCache.clear();
}

/** Test seam. */
export const __test = {
  PLATFORM,
  TOKEN_TTL_MS,
  MAX_TOKENS,
  REPORT_TTL_MS,
  tokens,
  reportCache,
  darwin,
  win32,
  isInsideRoots,
  registerToken,
};
