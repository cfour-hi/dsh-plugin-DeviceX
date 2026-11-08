/**
 * Device X cleanup — platform dispatcher.
 *
 * The cleanup API is identical on every supported platform; this module only
 * picks the implementation:
 *
 *  - `darwin` → `cleanup-darwin.js` (macOS cache/log/trash/developer roots)
 *  - `win32`  → `cleanup-win32.js` (Windows temp/update/thumbnail roots and the
 *    Recycle Bin)
 *
 * `dsh.bundle.platforms` limits installation to those two hosts; the darwin
 * branch is the safe fallback for anything else (every root then fails into
 * the item's `error` string instead of throwing).
 *
 * Deletion never accepts a path from the caller: `deleteCleanup(ids)` maps ids
 * to the fixed absolute allowlist entries and refuses everything else.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/cleanup
 */
import * as darwin from './cleanup-darwin.js';
import * as win32 from './cleanup-win32.js';

/** Host platform. */
export const PLATFORM = process.platform;

const impl = process.platform === 'win32' ? win32 : darwin;

/**
 * Scan every allowlisted cleanup location. Cached for 60 s.
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<object>} the cleanup scan document.
 */
export function scanCleanup(options = {}) {
  return impl.scanCleanup(options);
}

/**
 * Delete the contents of allowlisted cleanup items (ids only, never paths).
 * @param {unknown} ids cleanup item ids (array or comma separated string).
 * @returns {Promise<object>} `{ok, message, data:{deletedBytes, items}}`.
 */
export function deleteCleanup(ids) {
  return impl.deleteCleanup(ids);
}

/**
 * The cleanup allowlist as public metadata (ids, labels, categories, fixed
 * paths). Used by the action validator, tests and client labelling.
 * @returns {Array<{id: string, label: string, category: string,
 *   requiresAdmin: boolean, path: string|null}>}
 */
export function cleanupItems() {
  return impl.cleanupItems();
}

/** Test seam exposing the selected implementation for offline verification. */
export const __test = {
  platform: impl.PLATFORM,
  hostPlatform: PLATFORM,
  darwin,
  win32,
};
