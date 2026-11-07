// @ts-check
/**
 * Hook forwarders to the loader-injected React.
 *
 * `.tsx` components cannot `import { useState } from "react"` without adding a
 * second runtime request, so they import these thin wrappers instead. Each one
 * delegates to the same injected instance at call time, keeping hook order and
 * identity identical to the rest of the client.
 */
import { getReact } from "./runtime.js";

/** @returns {any} */
export function useState(initial) {
  return getReact().useState(initial);
}

/** @returns {any} */
export function useEffect(effect, deps) {
  return getReact().useEffect(effect, deps);
}

/** @returns {any} */
export function useRef(initial) {
  return getReact().useRef(initial);
}

/** @returns {any} */
export function useCallback(callback, deps) {
  return getReact().useCallback(callback, deps);
}

/** @returns {any} */
export function useMemo(factory, deps) {
  return getReact().useMemo(factory, deps);
}

/** @returns {string} */
export function useId() {
  return getReact().useId();
}
