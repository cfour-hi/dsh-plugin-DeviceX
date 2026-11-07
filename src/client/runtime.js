// @ts-check
/**
 * Device X client runtime — the one place the module-loader's `react` seed is
 * stored. `entry.js` sets it from the loader factory; core modules read it
 * when `createClient()` runs, so nothing touches React during module eval.
 */
let reactInstance = null;

/** Store the platform React instance handed over by the loader factory. */
export function setReact(react) {
  reactInstance = react;
}

/** Read the stored React instance (throws only if the loader forgot to set it). */
export function getReact() {
  if (reactInstance === null) throw new Error("Device X: react runtime was not provided by the module loader");
  return reactInstance;
}
