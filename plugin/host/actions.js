/**
 * Device X action engine — platform dispatcher.
 *
 * Both implementations expose the same surface (`GROUPS`, `actionCatalog`,
 * `actionHistory`, `runAction`) and return the same result union:
 * `{ ok: true, message, data? }` or `{ ok: false, message, code? }`.
 * `device_control` and the browser API call through this module, so a caller
 * never needs to know which platform produced the answer.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/actions
 */
import * as darwin from './actions-darwin.js';
import * as win32 from './actions-win32.js';

/** Action groups, in UI order. */
export const GROUPS = ['process', 'app', 'system', 'network', 'software', 'power'];

/** @type {import('../../types/contracts.js').PlatformActions} */
const impl = process.platform === 'win32' ? win32 : darwin;

/**
 * The platform's whitelisted action catalog.
 * @returns {object[]}
 */
export function actionCatalog() {
  return impl.actionCatalog();
}

/**
 * Recent action attempts, newest first.
 * @returns {object[]}
 */
export function actionHistory() {
  return impl.actionHistory();
}

/**
 * Validate and run one whitelisted action.
 * @param {string} id
 * @param {Record<string, unknown>} params
 * @returns {Promise<object>}
 */
export function runAction(id, params) {
  return impl.runAction(id, params);
}
