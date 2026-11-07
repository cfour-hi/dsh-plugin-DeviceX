// @ts-check
/**
 * Classic JSX runtime for the Device X client.
 *
 * The bundle is loaded through `window.__ModuleLoader__.load({ factory })`:
 * React is not bundled and arrives via the loader's `require("react")` seed, so
 * JSX cannot import `react/jsx-runtime` (that would add a second runtime
 * request and break the "single seed, zero dependency" bundle contract).
 * Instead the build uses the classic transform with `jsxFactory: "h"` and this
 * module exports an `h` that resolves the injected React lazily, plus a
 * fragment marker that `h` maps to `React.Fragment`.
 */
import { getReact } from "./runtime.js";

const FRAGMENT = Symbol.for("devicex.fragment");

/** Fragment marker for `<></>` in `.tsx` components (mapped inside `h`). */
export const Fragment = FRAGMENT;

/**
 * `React.createElement` bound to the loader-injected React instance.
 * @param {any} type element type (string tag, component, or Fragment marker)
 * @param {any} props element props (may be null)
 * @param {...any} children element children
 * @returns {any} React element
 */
export function h(type, props, ...children) {
  const React = getReact();
  return React.createElement(type === FRAGMENT ? React.Fragment : type, props, ...children);
}
