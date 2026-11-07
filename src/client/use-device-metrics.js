// @ts-check
/**
 * Page-level hooks: reduced-motion preference and the 2500 ms metrics poll with
 * a client-side sample ring buffer for the Overview sparklines.
 */
import { api } from "./api.js";
import { POLL_MS, MAX_SAMPLES } from "./constants.js";
import { asArray, numOr } from "./helpers.js";
import { normalizeMetrics } from "./normalizers.js";
import { useCallback, useEffect, useRef, useState } from "./hooks.js";

/** Track `prefers-reduced-motion` and re-render when it changes. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== "function") return void 0;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches === true);
    onChange();
    if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
    return () => {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
    };
  }, []);
  return reduced;
}

/**
 * Poll `/metrics` every 2500 ms while mounted; manual `refresh()` kicks an
 * immediate sample. Keeps a ring buffer for CPU/memory/disk/network/battery.
 */
export function useDeviceMetrics() {
  const [state, setState] = useState({ status: "loading", metrics: null, error: null, updatedAt: 0 });
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const timerRef = useRef(null);
  const tickRef = useRef(null);
  const samplesRef = useRef({ cpu: [], memory: [], disk: [], rx: [], tx: [], battery: [] });
  const fetchOnce = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let raw;
    try {
      raw = await api.metrics();
    } catch (error) {
      if (aliveRef.current) {
        setState((previous) => ({ ...previous, status: previous.metrics ? "stale" : "error", error }));
      }
      inFlightRef.current = false;
      return;
    }
    if (!aliveRef.current) {
      inFlightRef.current = false;
      return;
    }
    const metrics = normalizeMetrics(raw);
    const samples = samplesRef.current;
    pushSample(samples.cpu, numOr(metrics.cpu.usagePercent, -1), MAX_SAMPLES);
    pushSample(samples.memory, percentOrNull(metrics.memory.usedBytes, metrics.memory.totalBytes), MAX_SAMPLES);
    pushSample(samples.disk, percentOrNull(metrics.disk.usedBytes, metrics.disk.totalBytes), MAX_SAMPLES);
    pushSample(samples.rx, metrics.network.rxBytesPerSec, MAX_SAMPLES);
    pushSample(samples.tx, metrics.network.txBytesPerSec, MAX_SAMPLES);
    pushSample(samples.battery, metrics.battery && metrics.battery.present ? metrics.battery.percent : -1, MAX_SAMPLES);
    setState({ status: "ready", metrics, error: null, updatedAt: Date.now() });
    inFlightRef.current = false;
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    let generation = 0;
    const tick = async () => {
      if (cancelled) return;
      const current = (generation += 1);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      await fetchOnce();
      if (cancelled || current !== generation) return;
      timerRef.current = setTimeout(tick, POLL_MS);
    };
    tickRef.current = tick;
    tick();
    return () => {
      cancelled = true;
      aliveRef.current = false;
      tickRef.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [fetchOnce]);
  const refresh = useCallback(() => {
    if (tickRef.current) return tickRef.current();
    return fetchOnce();
  }, [fetchOnce]);
  return { status: state.status, metrics: state.metrics, error: state.error, updatedAt: state.updatedAt, samples: samplesRef.current, refresh };
}

/** Push a finite sample into a bounded ring buffer. */
function pushSample(buffer, value, max) {
  if (typeof value !== "number" || !isFinite(value)) return;
  buffer.push(value);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}

/** Percentage of part/total, or null. */
function percentOrNull(part, total) {
  if (typeof part !== "number" || typeof total !== "number" || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}
