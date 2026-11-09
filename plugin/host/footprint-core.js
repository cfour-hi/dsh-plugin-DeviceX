/**
 * Device X — uninstall footprint: pure classification kernel.
 *
 * No filesystem, no child processes, no clock. Everything here is a pure
 * function over plain data so the four confidence tiers can be unit-tested
 * without touching a real `~/Library` (see `test/footprint-core.test.mjs`).
 *
 * The classification rules encode what was actually observed on a real macOS
 * host, including the traps:
 *
 *  - Group Containers carry a 10-character Team ID prefix
 *    (`6N38VWS5BX.ru.keepcoder.Telegram`), and shared groups additionally carry
 *    a literal `group.` marker (`group.W5364U7YZB.io.tailscale.shared`);
 *  - a directory can match more than one installed app purely by name
 *    (`Doubao` vs `DoubaoWork`), so tiering needs *every* installed app, not
 *    just the one being uninstalled;
 *  - substring matching is a trap: `Code` would swallow `Codex` and
 *    `CodeBuddyExtension`, so name matching is anchored, never substring.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/footprint-core
 */

/**
 * A 10-character Team ID followed by a dot, at the start of a directory name.
 *
 * Case-insensitive on purpose: callers lowercase directory names before
 * matching, which turns `6N38VWS5BX` into `6n38vws5bx`.
 */
const TEAM_PREFIX = /^[A-Z0-9]{10}\./i;
/** The `group.` marker used by shared Group Containers, with or without a Team ID. */
const GROUP_PREFIX = /^group\./i;
/** The `group.<TeamID>.` form, kept separate so the Team ID is still checked. */
const GROUP_TEAM_PREFIX = /^group\.[A-Z0-9]{10}\./i;

/** Signals that a directory name is a vendor-level shared container. */
const VENDOR_ROOTS = new Set([
  'google',
  'microsoft',
  'adobe',
  'apple',
  'mozilla',
  'tencent',
  'alibaba',
  'bytedance',
  'dropbox',
  'jetbrains',
]);

/**
 * Strip the Team ID (and the `group.` marker) from a container directory name.
 * Non-container names pass through unchanged.
 * @param {unknown} name
 * @returns {string}
 */
export function stripTeamPrefix(name) {
  if (typeof name !== 'string') return '';
  if (GROUP_TEAM_PREFIX.test(name)) return name.replace(GROUP_TEAM_PREFIX, '');
  if (GROUP_PREFIX.test(name)) return name.replace(GROUP_PREFIX, '');
  return name.replace(TEAM_PREFIX, '');
}

/**
 * Normalise an application name to the slug used for name-similarity matching.
 *
 * Lowercase, drop a trailing `.app`, and collapse any run of non-alphanumeric
 * characters into a single `-`, then trim the edges. Separators are *kept* as
 * `-`: stripping them entirely would make `Claude-3p` collide with `claude3p`
 * and lose the boundary that `matchesAppName` relies on. `Clash Verge` and
 * `clash-verge` still compare equal.
 * @param {unknown} name
 * @returns {string}
 */
export function slugify(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\.app$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strict slug: lowercase alphanumerics only, no separators.
 *
 * Used where a real filesystem name has to be compared against a slug with no
 * known separator (`Packages/Acme.Widget_8wekyb3d8bbwe` → `acmewidget`).
 * @param {unknown} name
 * @returns {string}
 */
export function compactSlug(name) {
  return slugify(name).replace(/-/g, '');
}

/**
 * Lowercase a directory base name for indexing.
 * @param {unknown} name
 * @returns {string}
 */
function normalizeName(name) {
  return typeof name === 'string' ? name.toLowerCase() : '';
}

/**
 * True when `directoryName` is anchored to `bundleId`: either exactly equal, or
 * a dot-separated child of it (`com.x.App` → `com.x.App.ShipIt`). A bare
 * `startsWith` would make `com.foo` match `com.foobar`, which is wrong.
 * @param {string} directoryName lowercased directory base name
 * @param {string} bundleId lowercased bundle id
 * @returns {boolean}
 */
export function matchesBundleId(directoryName, bundleId) {
  if (directoryName === '' || bundleId === '') return false;
  if (directoryName === bundleId) return true;
  return directoryName.startsWith(`${bundleId}.`);
}

/**
 * True when a directory name looks like an app-name match for `slug`.
 *
 * Deliberately anchored at the start and separated by `-`, `.`, `_` or end of
 * string. `code` matches `code` and `code-3p`, but never `codex`.
 * @param {string} directoryName lowercased directory base name
 * @param {string} slug slugified app name
 * @returns {boolean}
 */
export function matchesAppName(directoryName, slug) {
  if (directoryName === '' || slug === '') return false;
  if (directoryName === slug) return true;
  return (
    directoryName.startsWith(`${slug}-`) ||
    directoryName.startsWith(`${slug}.`) ||
    directoryName.startsWith(`${slug}_`)
  );
}

/**
 * Strip everything after the first dot so a vendor product directory can be
 * compared on its leading segment (`com.google.chrome` → `com`).
 * @param {string} value
 * @returns {string}
 */
function leadingSegment(value) {
  const index = value.indexOf('.');
  return index < 0 ? value : value.slice(0, index);
}

/**
 * True when the directory is a vendor-level shared directory rather than one
 * product's own directory. `~/Library/Application Support/Google` is shared by
 * Chrome, Chrome for Testing and the updater, so it must never be deletable.
 * @param {string} directoryName original (not lowercased) base name
 * @returns {boolean}
 */
export function isVendorShared(directoryName) {
  if (typeof directoryName !== 'string' || directoryName === '') return false;
  const lowered = directoryName.toLowerCase();
  if (VENDOR_ROOTS.has(lowered)) return true;
  // `com.google` style vendor roots: reverse-DNS with nothing after the vendor.
  if (lowered.startsWith('com.') && lowered.split('.').length === 2 && VENDOR_ROOTS.has(leadingSegment(lowered.slice(4)))) {
    return true;
  }
  return false;
}

/**
 * Build the lookup index for a scan.
 *
 * @param {Array<{name: string, relPath: string, bytes?: number, files?: number,
 *   requiresAdmin?: boolean}>} entries every candidate directory found by a sweep
 * @returns {{entries: Array<object>, byLowerName: Map<string, number[]>}}
 */
export function buildIndex(entries) {
  const list = Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry.name === 'string' && typeof entry.relPath === 'string')
    : [];
  /** @type {Map<string, number[]>} */
  const byLowerName = new Map();
  list.forEach((entry, index) => {
    const key = normalizeName(entry.name);
    const bucket = byLowerName.get(key);
    if (bucket) bucket.push(index);
    else byLowerName.set(key, [index]);
  });
  return { entries: list, byLowerName };
}

/**
 * The app contexts needed to resolve a directory to one or more owners.
 * @typedef {object} AppContext
 * @property {string} name display name
 * @property {string|null} bundleId
 * @property {string} slug slugified display name
 */

/**
 * Normalise a raw installed-application record into an {@link AppContext}.
 * @param {{name?: unknown, bundleId?: unknown}} app
 * @returns {AppContext}
 */
export function toAppContext(app) {
  const name = typeof app?.name === 'string' ? app.name : '';
  const bundleId = typeof app?.bundleId === 'string' && app.bundleId !== '' ? app.bundleId : null;
  return { name, bundleId, slug: slugify(name) };
}

/**
 * Find every app that could own a directory name.
 *
 * The Team ID prefix is stripped first, so `6N38VWS5BX.ru.keepcoder.Telegram`
 * resolves to the app whose bundle id is `ru.keepcoder.Telegram`.
 *
 * Name matching compares *slugified* forms because directory names keep their
 * spaces and punctuation: `%APPDATA%\Acme Widget` must match the slug
 * `acmewidget`, and on macOS `Application Support/Clash Verge` is the same case.
 * Bundle-id matching still uses the raw lowercased name, since a bundle id is
 * never spelled with separators that slugify would remove.
 *
 * @param {string} directoryName
 * @param {AppContext[]} apps every installed app
 * @returns {AppContext[]}
 */
export function ownersOf(directoryName, apps) {
  const raw = normalizeName(directoryName);
  if (raw === '') return [];
  const bare = stripTeamPrefix(raw);
  const bareSlug = slugify(bare);
  const owners = [];
  for (const app of Array.isArray(apps) ? apps : []) {
    if (!app || typeof app !== 'object') continue;
    const bundleId = typeof app.bundleId === 'string' ? app.bundleId.toLowerCase() : '';
    const slug = typeof app.slug === 'string' ? app.slug : slugify(app.name);
    if (bundleId !== '' && matchesBundleId(bare, bundleId)) {
      owners.push(app);
      continue;
    }
    if (slug !== '' && matchesAppName(bareSlug, slug)) owners.push(app);
  }
  return owners;
}

/**
 * Decide whether two app contexts denote the same installed application.
 *
 * A bundle id is the real identity; the slug is only a fallback for records
 * that carry no bundle id. Comparing slugs alone would treat two genuinely
 * different apps that happen to share a name as one, which silently collapses
 * the `conflict` tier into `high`.
 *
 * @param {AppContext|null|undefined} left
 * @param {AppContext|null|undefined} right
 * @returns {boolean}
 */
export function isSameApp(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = typeof left.bundleId === 'string' ? left.bundleId.toLowerCase() : '';
  const rightId = typeof right.bundleId === 'string' ? right.bundleId.toLowerCase() : '';
  if (leftId !== '' && rightId !== '') return leftId === rightId;
  return left.slug !== '' && left.slug === right.slug;
}

/**
 * Collapse repeated roster entries.
 *
 * The collector reports the same bundle from more than one source (an app and
 * its helper both listing the parent's bundle id, or the same bundle found in
 * two locations). Without this, one installed app with three duplicate rows
 * looks like three competing owners and every match degrades to `conflict`.
 *
 * Identity is the bundle id when present, else the slug. The first entry wins
 * so a bundle-id-bearing row is never displaced by a weaker one.
 *
 * @param {AppContext[]} apps
 * @returns {AppContext[]}
 */
export function dedupeApps(apps) {
  /** @type {AppContext[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const app of Array.isArray(apps) ? apps : []) {
    if (!app || typeof app !== 'object') continue;
    const bundleId = typeof app.bundleId === 'string' ? app.bundleId.toLowerCase() : '';
    const slug = typeof app.slug === 'string' ? app.slug : slugify(app.name);
    const key = bundleId !== '' ? `id:${bundleId}` : `slug:${slug}`;
    if (key === 'slug:' || seen.has(key)) continue;
    seen.add(key);
    out.push(app);
  }
  return out;
}

/**
 * Resolve one candidate directory to a confidence tier.
 *
 * @param {object} candidate
 * @param {string} candidate.name directory base name (as found on disk)
 * @param {string} [candidate.relPath] optional display path; classification
 *   only depends on the base name
 * @param {AppContext} subject the app being uninstalled
 * @param {AppContext[]} allApps every installed app (for conflict detection)
 * @param {{fromBrewZap?: boolean, kind?: string, holdsSubject?: boolean}} [hints]
 *   `holdsSubject` must be `true` for a vendor-shared directory that actually
 *   contains the subject app's own data; a vendor directory belonging to some
 *   unrelated product is not a leftover of *this* app and yields `null`.
 * @returns {{confidence: import('../../types/contracts.js').FootprintConfidence,
 *   source: import('../../types/contracts.js').FootprintSource,
 *   reason: string, alsoMatchedBy: string[]} | null} `null` when the directory is
 *   not attributable to the subject app at all; the caller drops those rows.
 */
export function classify(candidate, subject, allApps, hints = {}) {
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const isShared = isVendorShared(name);

  if (isShared) {
    // A vendor directory only concerns us when it actually holds data for the
    // subject app. Otherwise it is another product's directory and showing it
    // would be pure noise (IINA has nothing to do with `Application Support/
    // Google`), so it is dropped entirely.
    if (hints.holdsSubject !== true) return null;
    return {
      confidence: 'shared',
      source: 'bundle-id',
      reason: 'Vendor-level directory shared with other products; shown for reference only.',
      alsoMatchedBy: [],
    };
  }

  const owners = ownersOf(name, Array.isArray(allApps) ? allApps : []);
  const subjectOwns = owners.some((owner) => isSameApp(owner, subject));

  if (hints.fromBrewZap === true) {
    return {
      confidence: 'high',
      source: 'brew-zap',
      reason: 'Listed in this app\'s Homebrew cask zap recipe.',
      alsoMatchedBy: [],
    };
  }

  if (subjectOwns) {
    const bare = stripTeamPrefix(normalizeName(name));
    const viaBundleId =
      typeof subject?.bundleId === 'string' && matchesBundleId(bare, subject.bundleId.toLowerCase());
    const others = owners.filter((owner) => !isSameApp(owner, subject));
    if (others.length > 0) {
      return {
        confidence: 'conflict',
        source: 'name-match',
        reason: `Directory name also matches ${others.length} other installed app(s).`,
        alsoMatchedBy: others.map((owner) => owner.name).filter((value) => value !== ''),
      };
    }
    // Design §4: a bundle-id hit is tier A; a pure name-similarity hit is tier
    // B and must default to unselected, because the user knows better than the
    // machine whether `Claude-3p` really belongs to Claude.
    return {
      confidence: viaBundleId ? 'high' : 'medium',
      source: viaBundleId ? 'bundle-id' : 'name-match',
      reason: viaBundleId
        ? 'Directory name matches the app\'s bundle identifier.'
        : `Directory name resembles the app name: ${subject?.name ?? ''} ≈ ${name}.`,
      alsoMatchedBy: [],
    };
  }

  return null;
}

/**
 * Total bytes of a set of found items.
 * @param {Array<{bytes?: unknown}>} items
 * @returns {number}
 */
export function totalBytes(items) {
  let sum = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const value = Number(item?.bytes);
    if (Number.isFinite(value) && value > 0) sum += value;
  }
  return sum;
}

/**
 * Bytes that a default-confirmed dialog would remove: the `high` tier only.
 * @param {Array<{bytes?: unknown, confidence?: unknown}>} items
 * @returns {number}
 */
export function selectedBytes(items) {
  const high = (Array.isArray(items) ? items : []).filter((item) => item?.confidence === 'high');
  return totalBytes(high);
}

/** Test seam: the exact sets this module classifies by. */
export const __test = {
  VENDOR_ROOTS,
  TEAM_PREFIX,
  GROUP_TEAM_PREFIX,
};
