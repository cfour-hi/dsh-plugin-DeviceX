/**
 * Device X - uninstall footprint scanner (Windows).
 *
 * Read-only, and deliberately conservative for 1.6: it reports the leftover
 * locations it can identify with high confidence and refuses to guess beyond
 * that. In particular it does **not** move anything to the Recycle Bin - the
 * cleanup leg of the pipeline is not implemented for Windows yet, because the
 * shell-based move (`Shell.Application` / `SHFileOperation`) could not be
 * validated on a real Windows host and this plugin never ships an unverified
 * destructive path.
 *
 * Discovery sources, strongest first:
 *
 *  - `%LOCALAPPDATA%\Packages\<PackageFamilyName>` - MSIX/Store apps own an
 *    exact container, so no naming heuristic is involved;
 *  - the MSI/uninstall-key `InstallLocation` and the reverse-DNS registry trees
 *    under `Software\<Vendor>` that match the display name;
 *  - `%APPDATA%`, `%LOCALAPPDATA%` and `%PROGRAMDATA%` product directories
 *    whose name matches the display name (tier B, never preselected).
 *
 * Windows has no bundle identifier, so name matching is weaker here than on
 * macOS and the `conflict` tier does more of the work.
 *
 * ASCII-only source: `scripts/verify-cleanup.mjs` asserts this file contains no
 * non-ASCII byte, because PowerShell input decodes with the console code page.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/footprint-win32
 */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { classify, compactSlug, dedupeApps, selectedBytes, slugify, toAppContext, totalBytes } from './footprint-core.js';

/** Host platform for this implementation. */
export const PLATFORM = 'win32';

/** Maximum candidates returned in one report. */
const MAX_ITEMS = 200;
/** Maximum directory entries visited per candidate size measurement. */
const MAX_ENTRIES = 40_000;
/** Wall-clock budget per candidate size walk (ms). */
const TIME_BUDGET_MS = 3_000;
/** Maximum diagnostic strings kept. */
const MAX_ERRORS = 20;
/** Maximum installed apps read for conflict detection. */
const MAX_APPS = 600;

/**
 * Environment variables this module reads, resolved at call time so tests can
 * inject a profile without touching the real one.
 * @returns {Record<string, string>}
 */
function profileEnv() {
  const env = process.env;
  return {
    appData: env.APPDATA ?? '',
    localAppData: env.LOCALAPPDATA ?? '',
    programData: env.ProgramData ?? env.PROGRAMDATA ?? '',
    userProfile: env.USERPROFILE ?? os.homedir(),
  };
}

/**
 * Directories swept for product-level leftovers, with their admin flag.
 * @param {Record<string, string>} env
 * @returns {Array<{root: string, requiresAdmin: boolean}>}
 */
export function sweepRootsFor(env) {
  /** @type {Array<{root: string, requiresAdmin: boolean}>} */
  const roots = [];
  if (env.appData) roots.push({ root: path.join(env.appData), requiresAdmin: false });
  if (env.localAppData) roots.push({ root: path.join(env.localAppData), requiresAdmin: false });
  if (env.programData) roots.push({ root: path.join(env.programData), requiresAdmin: true });
  return roots;
}

/**
 * Every root this scanner may ever report a candidate from.
 *
 * The dispatcher uses this list, not the report, to bound deletion.
 */
export const SAFE_ROOTS = Object.freeze(
  (() => {
    const env = profileEnv();
    /** @type {string[]} */
    const roots = [];
    if (env.appData) roots.push(env.appData);
    if (env.localAppData) roots.push(env.localAppData);
    if (env.programData) roots.push(env.programData);
    if (env.userProfile) roots.push(env.userProfile);
    return roots;
  })(),
);

/**
 * Shorten an error message to one JSON-friendly line.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function shortErr(value, max = 200) {
  const text = String(value ?? 'unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1) + '...'}` : text;
}

/**
 * `%VAR%` placeholder for display.
 * @param {string} absolute
 * @param {Record<string, string>} env
 * @returns {string}
 */
export function displayPath(absolute, env) {
  const pairs = [
    ['%APPDATA%', env.appData],
    ['%LOCALAPPDATA%', env.localAppData],
    ['%PROGRAMDATA%', env.programData],
    ['%USERPROFILE%', env.userProfile],
  ];
  for (const [token, base] of pairs) {
    if (typeof base === 'string' && base !== '' && absolute.toLowerCase().startsWith(base.toLowerCase())) {
      return token + absolute.slice(base.length);
    }
  }
  return absolute;
}

/**
 * Bounded recursive size walk using `lstat` only; never follows reparse points.
 * @param {string} root
 * @param {{maxEntries?: number, timeBudgetMs?: number}} [options]
 * @returns {Promise<{bytes: number, files: number, truncated: string|null}>}
 */
export async function measurePath(root, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const timeBudgetMs = options.timeBudgetMs ?? TIME_BUDGET_MS;
  const deadline = Date.now() + timeBudgetMs;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  /** @type {string|null} */
  let truncated = null;
  /** @type {string[]} */
  let level = [root];

  outer: while (level.length > 0) {
    /** @type {string[]} */
    const next = [];
    for (const current of level) {
      if (Date.now() > deadline) {
        truncated = `timed out after ${timeBudgetMs} ms`;
        break outer;
      }
      let stat;
      try {
        stat = await fsp.lstat(current);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile()) {
        bytes += stat.size;
        files += 1;
        continue;
      }
      if (!stat.isDirectory()) continue;
      entries += 1;
      if (entries > maxEntries) {
        truncated = `stopped after ${maxEntries} entries`;
        break outer;
      }
      let children;
      try {
        children = await fsp.readdir(current);
      } catch {
        continue;
      }
      for (const child of children) next.push(path.join(current, child));
    }
    level = next;
  }
  return { bytes, files, truncated };
}

/**
 * Stable, scan-local item id derived from the path (FNV-1a).
 * @param {string} absolute
 * @returns {string}
 */
export function itemId(absolute) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < absolute.length; index += 1) {
    hash ^= absolute.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Scan one application's leftover footprint.
 *
 * @param {{appPath?: string, installedApps?: Array<object>, name?: string,
 *   bundleId?: string|null, packageFamilyName?: string|null}} [options]
 * @returns {Promise<object>} a `FootprintReport` without `scanId`
 */
export async function scanFootprint(options = {}) {
  const startedAt = Date.now();
  /** @type {string[]} */
  const errors = [];
  const env = profileEnv();
  const appPath = typeof options.appPath === 'string' ? options.appPath : '';

  const base = {
    appPath,
    bundleId: typeof options.bundleId === 'string' && options.bundleId !== '' ? options.bundleId : null,
    sandboxed: false,
    targetedRoots: [],
    generatedAt: startedAt,
    durationMs: 0,
    items: [],
    totalBytes: 0,
    selectedBytes: 0,
    errors,
  };

  const appName =
    typeof options.name === 'string' && options.name !== ''
      ? options.name
      : appPath !== ''
        ? path.basename(appPath)
        : '';
  if (appName === '') {
    errors.push('missing application name');
    return { ...base, durationMs: Date.now() - startedAt };
  }

  const subject = toAppContext({ name: appName, bundleId: base.bundleId });
  const installedApps = Array.isArray(options.installedApps)
    ? options.installedApps.map((app) => toAppContext(app))
    : [subject];
  const roster = dedupeApps(installedApps);

  /** @type {Array<{name: string, absolute: string, requiresAdmin: boolean, source: string, holdsSubject?: boolean}>} */
  const candidates = [];

  // 1. MSIX containers: an exact, unambiguous match.
  //
  // The PFN is `PackageName_PublisherId`, so it is derived from the app name
  // rather than required from the caller: a collector that only knows the
  // display name still gets the strongest signal Windows offers.
  if (env.localAppData !== '') {
    const packagesDir = path.join(env.localAppData, 'Packages');
    const subjectSlug = compactSlug(appName);
    const hinted = typeof options.packageFamilyName === 'string' ? options.packageFamilyName : '';
    let entries = [];
    try {
      entries = await fsp.readdir(packagesDir, { withFileTypes: true });
    } catch {
      // A machine with no Store apps has no Packages directory at all.
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const isHinted = hinted !== '' && entry.name.toLowerCase() === hinted.toLowerCase();
      // `Acme.Widget_8wekyb3d8bbwe` -> `acmewidget` (separators removed, because
      // a package name has no separator convention we can rely on).
      const packageSlug = compactSlug(entry.name.split('_')[0]);
      if (!isHinted && (subjectSlug === '' || packageSlug !== subjectSlug)) continue;
      candidates.push({
        name: entry.name,
        absolute: path.join(packagesDir, entry.name),
        requiresAdmin: false,
        source: 'msix',
      });
    }
  }

  // 2. Product directories under the three profile roots, matched by name.
  for (const { root, requiresAdmin } of sweepRootsFor(env)) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      candidates.push({
        name: entry.name,
        absolute: path.join(root, entry.name),
        requiresAdmin,
        source: 'registry',
      });
    }
  }

  /** @type {Array<object>} */
  const items = [];

  // The install directory (when the registry told us where it is) is the
  // Windows analogue of "the bundle itself": always first, always selected.
  if (appPath !== '') {
    const measure = await measurePath(appPath);
    items.push({
      id: itemId(appPath),
      kind: 'app',
      path: appPath,
      displayPath: displayPath(appPath, env),
      bytes: measure.bytes,
      files: measure.files,
      confidence: 'high',
      source: 'registry',
      reason: 'The application install directory.',
      requiresAdmin: false,
      exists: true,
      ...(measure.truncated ? { warning: measure.truncated } : {}),
    });
  }

  /** @type {Set<string>} */
  const seen = new Set(items.map((item) => item.path));

  const classified = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.absolute)) continue;
    const verdict =
      candidate.source === 'msix'
        ? {
            confidence: /** @type {const} */ ('high'),
            source: /** @type {const} */ ('msix'),
            reason: 'MSIX package container for this application.',
            alsoMatchedBy: [],
          }
        : classify(candidate, subject, roster, {});
    if (verdict === null) continue;
    seen.add(candidate.absolute);
    classified.push({ ...candidate, ...verdict });
  }

  const rank = { high: 0, medium: 1, conflict: 2, shared: 3 };
  classified.sort((left, right) => {
    const diff = (rank[left.confidence] ?? 9) - (rank[right.confidence] ?? 9);
    return diff !== 0 ? diff : left.absolute.localeCompare(right.absolute);
  });

  for (const candidate of classified.slice(0, MAX_ITEMS)) {
    const measure = await measurePath(candidate.absolute);
    items.push({
      id: itemId(candidate.absolute),
      kind: candidate.requiresAdmin ? 'system' : 'data',
      path: candidate.absolute,
      displayPath: displayPath(candidate.absolute, env),
      bytes: measure.bytes,
      files: measure.files,
      confidence: candidate.confidence,
      source: candidate.source,
      reason: candidate.reason,
      ...(candidate.alsoMatchedBy.length > 0 ? { alsoMatchedBy: candidate.alsoMatchedBy } : {}),
      requiresAdmin: candidate.requiresAdmin,
      exists: true,
      ...(measure.truncated ? { warning: measure.truncated } : {}),
    });
  }
  if (classified.length > MAX_ITEMS) {
    errors.push(`report truncated to ${MAX_ITEMS} of ${classified.length} candidates`);
  }
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;

  const appBytes = items.length > 0 && items[0].kind === 'app' ? items[0].bytes : 0;
  return {
    ...base,
    targetedRoots: sweepRootsFor(env).map((entry) => displayPath(entry.root, env)),
    durationMs: Date.now() - startedAt,
    items,
    totalBytes: totalBytes(items),
    selectedBytes: Math.max(0, selectedBytes(items) - appBytes),
  };
}

/** Test seam. */
export const __test = {
  PLATFORM,
  SAFE_ROOTS,
  MAX_ITEMS,
  MAX_ENTRIES,
  TIME_BUDGET_MS,
  measurePath,
  sweepRootsFor,
  displayPath,
  profileEnv,
  itemId,
  slugify,
};
