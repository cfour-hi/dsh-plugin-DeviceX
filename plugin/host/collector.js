/**
 * Device X host collectors — platform dispatcher.
 *
 * The data contract (`Metrics`, the six sections, `Inventory`) is identical on
 * every supported platform; this module only picks the implementation:
 *
 *  - `darwin` → `collector-darwin.js` (macOS commands, the original target)
 *  - `win32`  → `collector-win32.js` (PowerShell/CIM)
 *
 * `dsh.bundle.platforms` limits installation to those two hosts; the darwin
 * branch is the safe fallback for an already-loaded tree on anything else
 * (every command then fails into the section's `errors[]` instead of throwing).
 *
 * @module @cfour-hi/dsh-devicex/host/collector
 */
import * as darwin from './collector-darwin.js';
import * as win32 from './collector-win32.js';

/** Host platform. */
/** @type {import('../../types/contracts.js').Platform} */
export const PLATFORM = /** @type {import('../../types/contracts.js').Platform} */ (process.platform);

/** Frozen section identifiers, in UI order. */
export const SECTIONS = ['hardware', 'system', 'software', 'network', 'security', 'processes'];

/** @type {import('../../types/contracts.js').PlatformCollector} */
const impl = process.platform === 'win32' ? win32 : darwin;

/**
 * Start slow section collection in the background.
 * @returns {void}
 */
export function warmup() {
  return impl.warmup();
}

/**
 * One fast metrics snapshot for the 2500 ms UI poll.
 * @returns {Promise<object>}
 */
export function collectMetrics() {
  return impl.collectMetrics();
}

/**
 * Collect one section.
 * @param {string} section one of SECTIONS.
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<object>}
 */
export function collectSection(section, options = {}) {
  return impl.collectSection(section, options);
}

/**
 * Full inventory for the panel's initial load and the agent tool.
 * @param {{sections?: string[], fresh?: boolean}} [options]
 * @returns {Promise<object>}
 */
export function collectInventory(options = {}) {
  return impl.collectInventory(options);
}

/**
 * Drop cached section data.
 * @param {string} [section]
 * @returns {void}
 */
export function clearCache(section) {
  return impl.clearCache(section);
}
