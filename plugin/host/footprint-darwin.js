/**
 * Device X — uninstall footprint scanner (macOS).
 *
 * Read-only. Finds where an installed `.app` keeps data outside its bundle:
 * a sweep of the user and system data roots, an optional Homebrew cask `zap`
 * recipe, and an entitlements probe that decides whether the app writes into a
 * sandbox container or into `~/Library` directly.
 *
 * Nothing here deletes, moves or opens a handle for writing. The only child
 * processes are `plutil` and `codesign` (both argv-only).
 *
 * Why not REA / `strings`: measured on a real host, most native binaries do not
 * contain `Library/...` path literals at all (they build paths at runtime from
 * `NSSearchPathForDirectoriesInDomains`), and REA's JavaScript graph does not
 * retain filesystem-path literals even when the source obviously has them. The
 * sweep below is what actually found the leftover directories, including the
 * one nobody's bundle-id rule can see (`Application Support/Claude-3p`, 11 GB).
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/footprint-darwin
 */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { collectSection } from './collector-darwin.js';
import { run } from './proc.js';
import { buildIndex, classify, dedupeApps, isSameApp, isVendorShared, selectedBytes, slugify, toAppContext, totalBytes } from './footprint-core.js';

/** Host platform for this implementation. */
export const PLATFORM = 'darwin';

/** Maximum directory entries visited per candidate (size measurement). */
const MAX_ENTRIES = 40_000;
/** Wall-clock budget per candidate size walk (ms). */
const TIME_BUDGET_MS = 3_000;
/** Maximum candidates returned in one report. */
const MAX_ITEMS = 200;
/** Maximum installed apps read for conflict detection. */
const MAX_APPS = 600;
/** Maximum diagnostic strings kept. */
const MAX_ERRORS = 20;

const HOME = os.homedir();
const PLUTIL = '/usr/bin/plutil';
const CODESIGN = '/usr/bin/codesign';

/** Directories whose direct children are candidate leftover locations. */
export const USER_ROOTS = Object.freeze([
  'Application Support',
  'Caches',
  'Preferences',
  'Preferences/ByHost',
  'Logs',
  'HTTPStorages',
  'WebKit',
  'Cookies',
  'Saved Application State',
  'Containers',
  'Group Containers',
  'Application Scripts',
]);

/** System-wide counterparts: reported, never deletable without admin rights. */
export const SYSTEM_ROOTS = Object.freeze([
  '/Library/Application Support',
  '/Library/Caches',
  '/Library/Preferences',
  '/Library/Logs',
  '/Library/LaunchAgents',
  '/Library/LaunchDaemons',
  '/Library/PrivilegedHelperTools',
]);

/** Where installed bundles live. */
const APP_DIRS = Object.freeze(['/Applications', path.join(HOME, 'Applications'), '/System/Applications']);

/** Homebrew cask receipt roots, in lookup order. */
const CASKROOM_CANDIDATES = ['/opt/homebrew/Caskroom', '/usr/local/Caskroom'];

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

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
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * `~`-abbreviate an absolute path for display.
 * @param {string} absolute
 * @returns {string}
 */
function displayPath(absolute) {
  return absolute === HOME ? '~' : absolute.startsWith(`${HOME}${path.sep}`) ? `~${absolute.slice(HOME.length)}` : absolute;
}

/**
 * Read one raw string value from an Info.plist without launching anything.
 * @param {string} plistPath
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function readPlistString(plistPath, key) {
  const result = await run(PLUTIL, ['-extract', key, 'raw', '-o', '-', plistPath], { timeout: 5_000 });
  if (!result.ok) return null;
  const value = String(result.stdout ?? '').trim();
  return value === '' ? null : value;
}

/* -------------------------------------------------------------------------- */
/* Installed applications (needed for conflict detection)                     */
/* -------------------------------------------------------------------------- */

/**
 * Read every installed application's name and bundle id.
 *
 * This is the whole point of scanning all apps rather than just the subject:
 * a directory that matches two installed apps must be downgraded to the
 * `conflict` tier instead of being preselected.
 *
 * The software section is the preferred source: it is already collected for the
 * Software tab, carries ~340 bundles (including nested helpers the plain folder
 * scan cannot see), and is cached for 300 s, so a scan costs no extra process
 * launches. The directory listing is the fallback for a cold/absent collector.
 *
 * @param {string[]} errors collector for non-fatal diagnostics
 * @returns {Promise<Array<{name: string, bundleId: string|null, slug: string}>>}
 */
export async function readInstalledApps(errors = []) {
  try {
    const section = await collectSection('software');
    const rows = Array.isArray(section?.applications) ? section.applications : [];
    /** @type {Array<{name: string, bundleId: string|null, slug: string}>} */
    const apps = [];
    for (const row of rows) {
      if (!row || typeof row.name !== 'string' || row.name === '') continue;
      if (apps.length >= MAX_APPS) break;
      const bundleId = typeof row.bundleId === 'string' && row.bundleId !== '' ? row.bundleId : null;
      apps.push(toAppContext({ name: row.name, bundleId }));
    }
    if (apps.length > 0) return apps;
  } catch (error) {
    errors.push(`software section: ${shortErr(error)}`);
  }
  return readAppsFromDirectories(errors);
}

/**
 * Fallback roster: enumerate `.app` bundles in the three standard locations and
 * read each `CFBundleIdentifier` with `plutil`.
 * @param {string[]} errors
 * @returns {Promise<Array<{name: string, bundleId: string|null, slug: string}>>}
 */
async function readAppsFromDirectories(errors = []) {
  /** @type {Array<{name: string, bundleId: string|null, slug: string}>} */
  const apps = [];
  for (const dir of APP_DIRS) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // /System/Applications is present on every supported macOS; a miss on the
      // optional ~/Applications is normal and must not become an error line.
      if (dir !== path.join(HOME, 'Applications')) errors.push(`readdir ${displayPath(dir)}: ${shortErr(error)}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
      if (apps.length >= MAX_APPS) break;
      const bundlePath = path.join(dir, entry.name);
      const bundleId = await readPlistString(path.join(bundlePath, 'Contents', 'Info.plist'), 'CFBundleIdentifier');
      apps.push(toAppContext({ name: entry.name.replace(/\.app$/, ''), bundleId }));
    }
  }
  return apps;
}

/* -------------------------------------------------------------------------- */
/* Sandbox detection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * True when the bundle declares the App Sandbox entitlement.
 *
 * `codesign` writes entitlements to stdout; its diagnostics go to stderr. A
 * failure is reported as "not sandboxed" plus an error line rather than being
 * guessed at, because the answer decides which roots we sweep.
 *
 * @param {string} bundlePath resolved `.app` path
 * @param {string[]} errors
 * @returns {Promise<boolean>}
 */
export async function isSandboxed(bundlePath, errors = []) {
  const result = await run(CODESIGN, ['-d', '--entitlements', '-', bundlePath], { timeout: 10_000 });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (!result.ok && text === '') {
    errors.push(`codesign entitlements: ${shortErr(result.error ?? 'no output')}`);
    return false;
  }
  return /com\.apple\.security\.app-sandbox/.test(text);
}

/* -------------------------------------------------------------------------- */
/* Homebrew cask zap recipe                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Glob patterns from a cask's recorded `zap` stanza, if this app is managed by
 * Homebrew. These are curated by humans and much better than any heuristic, so
 * they are treated as top-tier evidence.
 *
 * @param {string|null} bundleId
 * @param {string[]} errors
 * @returns {Promise<string[]>} raw glob patterns, `~`-relative or absolute
 */
export async function readBrewZap(bundleId, errors = []) {
  if (typeof bundleId !== 'string' || bundleId === '') return [];
  for (const caskroom of CASKROOM_CANDIDATES) {
    let casks;
    try {
      casks = await fsp.readdir(caskroom, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const cask of casks) {
      if (!cask.isDirectory()) continue;
      const receipt = path.join(caskroom, cask.name, '.metadata', 'INSTALL_RECEIPT.json');
      let raw;
      try {
        raw = await fsp.readFile(receipt, 'utf8');
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      // Only trust the receipt when it belongs to this exact bundle id.
      const installed = parsed?.uninstall_artifacts;
      if (!Array.isArray(installed)) continue;
      const belongs = JSON.stringify(installed).includes(bundleId);
      if (!belongs) continue;
      /** @type {string[]} */
      const patterns = [];
      for (const artifact of installed) {
        if (!artifact || typeof artifact !== 'object') continue;
        const zap = artifact.zap;
        if (!Array.isArray(zap)) continue;
        for (const entry of zap) {
          if (!entry || typeof entry !== 'object') continue;
          if (Array.isArray(entry.trash)) {
            for (const value of entry.trash) if (typeof value === 'string') patterns.push(value);
          }
          if (Array.isArray(entry.rmdir)) {
            for (const value of entry.rmdir) if (typeof value === 'string') patterns.push(value);
          }
        }
      }
      if (patterns.length > 0) return patterns;
    }
  }
  return [];
}

/**
 * Expand a zap pattern into candidate base names inside the user roots.
 *
 * Cask recipes mix absolute paths, `~/`-relative paths and globs. Only the
 * final path segment is used here, because the sweep enumerates directories
 * per root and matches by base name; a glob segment is reduced to its literal
 * prefix ( `IINA*.plist` → `iina` ).
 *
 * @param {string[]} patterns
 * @returns {Set<string>} lowercased base names
 */
export function zapBaseNames(patterns) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    if (typeof pattern !== 'string') continue;
    const base = pattern.split('/').filter((segment) => segment !== '').pop();
    if (base === undefined) continue;
    const literal = base.split('*')[0].toLowerCase();
    if (literal !== '') names.add(literal);
  }
  return names;
}

/* -------------------------------------------------------------------------- */
/* Bounded size walk                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} WalkResult
 * @property {number} bytes
 * @property {number} files
 * @property {string|null} truncated
 */

/**
 * Measure one candidate with `lstat` only (never following symlinks), capped by
 * entry count and wall clock. A truncated walk still reports what it saw.
 *
 * @param {string} root
 * @param {{maxEntries?: number, timeBudgetMs?: number}} [options]
 * @returns {Promise<WalkResult>}
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

/* -------------------------------------------------------------------------- */
/* Sweep                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One candidate directory found by the sweep.
 * @typedef {object} Candidate
 * @property {string} name base name as found on disk
 * @property {string} absolute absolute path
 * @property {boolean} requiresAdmin
 * @property {string} root which sweep root produced it
 */

/**
 * Enumerate the direct children of every root, without descending.
 *
 * Depth is deliberately 1: an app's own directory is a direct child of these
 * roots, and recursing would turn a 12 ms scan into a multi-second one with no
 * extra reach (measured: depth 2 cost 3.1 s and added zero true positives).
 *
 * @param {string[]} roots absolute roots
 * @param {boolean} requiresAdmin value to stamp on candidates from these roots
 * @param {string[]} errors
 * @param {{timeBudgetMs?: number}} [options]
 * @returns {Promise<Candidate[]>}
 */
export async function sweepRoots(roots, requiresAdmin, errors = [], options = {}) {
  const deadline = Date.now() + (options.timeBudgetMs ?? 5_000);
  /** @type {Candidate[]} */
  const out = [];
  for (const root of roots) {
    if (Date.now() > deadline) {
      errors.push('sweep budget exhausted');
      break;
    }
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      // A missing or unreadable root is normal (TCC, absent /Library subdir).
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push({ name: entry.name, absolute: path.join(root, entry.name), requiresAdmin, root: path.basename(root) });
    }
  }
  return out;
}

/**
 * True when a vendor-level directory actually contains the subject app's data.
 *
 * `~/Library/Application Support/Google` is shared by Chrome, Chrome for
 * Testing and the updater; it is only relevant to Chrome. So a vendor directory
 * is inspected one level deep and kept only when a child matches the subject.
 * This is what stops an unrelated product's 17 GB vendor folder from appearing
 * in an IINA uninstall dialog.
 *
 * @param {string} vendorAbsolute
 * @param {{bundleId: string|null, slug: string}} subject
 * @returns {Promise<boolean>}
 */
export async function vendorHoldsSubject(vendorAbsolute, subject) {
  let entries;
  try {
    entries = await fsp.readdir(vendorAbsolute, { withFileTypes: true });
  } catch {
    return false;
  }
  const bundleId = typeof subject?.bundleId === 'string' ? subject.bundleId.toLowerCase() : '';
  const slug = typeof subject?.slug === 'string' ? subject.slug : '';
  for (const entry of entries) {
    const lowered = entry.name.toLowerCase();
    if (bundleId !== '' && (lowered === bundleId || lowered.startsWith(`${bundleId}.`))) return true;
    if (slug !== '' && lowered === slug) return true;
    // Vendor directories often nest the product one level deeper, e.g.
    // `Google/Chrome`, `Microsoft/DeveloperTools`.
    if (slug !== '' && slugify(entry.name) === slug) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Stable, scan-local item id. Derived from the path so the same scan produces
 * stable ids across two sweeps; the id is never a path and never reveals one.
 * @param {string} absolute
 * @returns {string}
 */
function itemId(absolute) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < absolute.length; index += 1) {
    hash ^= absolute.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Scan one application's leftover footprint. Read-only; never throws.
 *
 * @param {{appPath?: string, installedApps?: Array<object>, timeBudgetMs?: number}} [options]
 * @returns {Promise<object>} a `FootprintReport` (without `scanId`, which the
 *   dispatcher adds when it registers the token)
 */
export async function scanFootprint(options = {}) {
  const startedAt = Date.now();
  /** @type {string[]} */
  const errors = [];
  const appPath = typeof options.appPath === 'string' ? options.appPath : '';

  const empty = (extra = {}) => ({
    appPath,
    bundleId: null,
    sandboxed: false,
    targetedRoots: [],
    generatedAt: startedAt,
    durationMs: Date.now() - startedAt,
    items: [],
    totalBytes: 0,
    selectedBytes: 0,
    errors,
    ...extra,
  });

  if (appPath === '') {
    errors.push('missing application path');
    return empty();
  }

  let bundleId = null;
  try {
    bundleId = await readPlistString(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleIdentifier');
  } catch (error) {
    errors.push(`read Info.plist: ${shortErr(error)}`);
  }
  if (bundleId === null) {
    errors.push(`no CFBundleIdentifier in ${displayPath(appPath)}`);
    return empty();
  }

  const subject = toAppContext({ name: path.basename(appPath).replace(/\.app$/, ''), bundleId });
  const sandboxed = await isSandboxed(appPath, errors);

  const installedApps = Array.isArray(options.installedApps)
    ? options.installedApps.map((app) => toAppContext(app))
    : await readInstalledApps(errors);
  // The subject must be present in the roster even if the sweep of app folders
  // missed it (e.g. a bundle outside the three standard locations). Duplicate
  // rows are collapsed first: the collector reports some bundles three times,
  // which would otherwise read as three competing owners.
  const roster = dedupeApps(
    installedApps.some((app) => isSameApp(app, subject)) ? installedApps : [...installedApps, subject],
  );

  const zapPatterns = await readBrewZap(bundleId, errors);
  const zapNames = zapBaseNames(zapPatterns);

  const userRoots = USER_ROOTS.map((root) => path.join(HOME, 'Library', root));
  const timeBudgetMs = options.timeBudgetMs;
  const userCandidates = await sweepRoots(userRoots, false, errors, { timeBudgetMs });
  const systemCandidates = await sweepRoots([...SYSTEM_ROOTS], true, errors, { timeBudgetMs });

  /**
   * @typedef {Candidate & {fromBrewZap: boolean,
   *   confidence: import('../../types/contracts.js').FootprintConfidence,
   *   source: import('../../types/contracts.js').FootprintSource,
   *   reason: string, alsoMatchedBy: string[]}} Classified
   */
  /** @type {Map<string, Classified>} */
  const kept = new Map();

  for (const candidate of /** @type {Candidate[]} */ ([...userCandidates, ...systemCandidates])) {
    const lowered = candidate.name.toLowerCase();
    const fromBrewZap = [...zapNames].some((literal) => lowered === literal || lowered.startsWith(literal));
    // A vendor-level directory is only relevant when it actually holds the
    // subject's own data; otherwise it belongs to some other product.
    let holdsSubject = false;
    if (isVendorShared(candidate.name)) {
      holdsSubject = await vendorHoldsSubject(candidate.absolute, subject);
      if (!holdsSubject) continue;
    }
    const verdict = classify(candidate, subject, roster, { fromBrewZap, holdsSubject });
    if (verdict === null) continue;
    const existing = kept.get(candidate.absolute);
    if (existing && existing.confidence === 'high') continue;
    kept.set(candidate.absolute, { ...candidate, ...verdict, fromBrewZap });
  }

  // The app bundle itself is always the first, mandatory row.
  /** @type {Array<object>} */
  const items = [];
  const appMeasure = await measurePath(appPath);
  items.push({
    id: itemId(appPath),
    kind: 'app',
    path: appPath,
    displayPath: displayPath(appPath),
    bytes: appMeasure.bytes,
    files: appMeasure.files,
    confidence: 'high',
    source: 'bundle-id',
    reason: 'The application bundle itself.',
    requiresAdmin: false,
    exists: true,
    ...(appMeasure.truncated ? { warning: appMeasure.truncated } : {}),
  });

  const ordered = [...kept.values()].sort((left, right) => {
    const rank = { high: 0, medium: 1, conflict: 2, shared: 3 };
    const diff = (rank[left.confidence] ?? 9) - (rank[right.confidence] ?? 9);
    return diff !== 0 ? diff : left.absolute.localeCompare(right.absolute);
  });

  for (const candidate of ordered.slice(0, MAX_ITEMS)) {
    const measure = await measurePath(candidate.absolute);
    const kind = candidate.requiresAdmin
      ? 'system'
      : candidate.confidence === 'shared'
        ? 'shared'
        : /\/Containers\//.test(candidate.absolute)
          ? 'container'
          : 'data';
    items.push({
      id: itemId(candidate.absolute),
      kind,
      path: candidate.absolute,
      displayPath: displayPath(candidate.absolute),
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
  if (ordered.length > MAX_ITEMS) {
    errors.push(`report truncated to ${MAX_ITEMS} of ${ordered.length} candidates`);
  }

  return {
    appPath,
    bundleId,
    sandboxed,
    targetedRoots: [...userRoots.map((root) => displayPath(root)), ...SYSTEM_ROOTS],
    generatedAt: startedAt,
    durationMs: Date.now() - startedAt,
    items,
    totalBytes: totalBytes(items),
    selectedBytes: selectedBytes(items) - appMeasure.bytes,
    errors,
  };
}

/**
 * Every root this scanner may ever report a candidate from.
 *
 * The dispatcher uses this list — not the report — to bound deletion, so a bug
 * in the sweep cannot widen what `app.uninstall` is allowed to touch. It is
 * computed once at module load and never derived from a request.
 */
export const SAFE_ROOTS = Object.freeze([
  ...USER_ROOTS.map((root) => path.join(HOME, 'Library', root)),
  ...SYSTEM_ROOTS,
  ...APP_DIRS,
]);

/** Test seam: fixed roots and the pure helpers, for offline verification. */
export const __test = {
  PLATFORM,
  USER_ROOTS,
  SYSTEM_ROOTS,
  APP_DIRS,
  SAFE_ROOTS,
  MAX_ITEMS,
  MAX_ENTRIES,
  TIME_BUDGET_MS,
  measurePath,
  sweepRoots,
  zapBaseNames,
  readBrewZap,
  isSandboxed,
  readInstalledApps,
  vendorHoldsSubject,
  itemId,
  buildIndex,
};
