/**
 * Device X host collectors — Windows implementation.
 *
 * The public data contract is `docs/build-contract.md`: `Metrics`, the six
 * section shapes and `Inventory` are identical to the macOS collector, with
 * `null` where Windows genuinely does not expose a value. The Windows-specific
 * sources are PowerShell/CIM (see `plugin/host/win/*.ps1`). Every call goes
 * through the frozen `./win.js` bridge (encoded command, argv only, bounded
 * buffer, timeout); nothing here invokes a shell or interpolates data into
 * script text.
 *
 * Rules honoured here (same as `collector-darwin.js`):
 *  - every data source failure yields null/empty values plus a non-fatal entry
 *    in the section's `errors[]`; collectors never throw (unknown section
 *    names are the one deliberate exception);
 *  - everything returned is JSON-safe: no `undefined`, no NaN/Infinity, no
 *    circular references;
 *  - slow sections are cached with TTLs, de-duplicated while in flight and can
 *    be warmed in the background;
 *  - `collectMetrics()` is a fast poll path built from a single PowerShell
 *    invocation plus `os.cpus()` deltas for CPU percentages;
 *  - CPU%, network and disk byte rates are deltas against the previous sample,
 *    exactly like the macOS implementation.
 *
 * @module @cfour-hi/dsh-devicex/host/collector-win32
 */
import * as os from 'node:os';

import { actionCatalog, actionHistory } from './actions-win32.js';
import { sleep } from './proc.js';
import { readScript, runPSJson } from './win.js';

/** Host platform for this implementation. */
export const PLATFORM = 'win32';

/** Frozen section identifiers, in UI order. */
export const SECTIONS = ['hardware', 'system', 'software', 'network', 'security', 'processes'];

/** Per-section cache TTLs (ms) — recommended values from docs/windows-contract.md. */
const SECTION_TTL = {
  hardware: 300_000,
  system: 120_000,
  software: 600_000,
  network: 15_000,
  security: 60_000,
  processes: 30_000,
};

/** Wall-clock timeout per bundled script (PowerShell startup + CIM query). */
const SCRIPT_TIMEOUT = {
  'metrics.ps1': 15_000,
  'hardware.ps1': 30_000,
  'system.ps1': 25_000,
  'software.ps1': 45_000,
  'network.ps1': 30_000,
  'security.ps1': 30_000,
  'processes.ps1': 25_000,
};

/**
 * Fast-metrics cache TTL. The macOS collector stays inside the contract's
 * <250 ms poll budget, but one Windows sample needs a PowerShell spawn plus
 * ~20 CIM queries, netsh and per-process owner lookups — routinely far above
 * 250 ms. The UI still polls every 2500 ms, so a 3000 ms TTL serves roughly
 * every other poll from cache and halves the PowerShell load. This is a
 * deliberate, documented deviation from the darwin budget; a <=3 s stale
 * metrics snapshot is acceptable for the panel, and network/disk rates stay
 * meaningful because they are deltas against the previous *sampled* timestamp.
 */
const METRICS_TTL = 3_000;

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coerce to a finite number, else null.
 * @param {unknown} value
 * @returns {number|null}
 */
function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Coerce to a trimmed, non-empty string, else null.
 * @param {unknown} value
 * @returns {string|null}
 */
function str(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Tolerant array normalizer. Windows PowerShell 5.1 `ConvertTo-Json` can
 * collapse a single-element array into a scalar, so arrays emitted by the
 * bundled scripts are normalized through this helper.
 * @param {unknown} value
 * @returns {any[]}
 */
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

/**
 * Coerce a number to a fixed number of decimals (null-safe).
 * @param {unknown} value
 * @param {number} [digits]
 * @returns {number|null}
 */
function round(value, digits = 1) {
  const parsed = num(value);
  if (parsed === null) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

/**
 * Clamp a number into [min, max]; non-finite becomes min.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  const parsed = num(value);
  if (parsed === null) return min;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * First numeric value among the given keys of an object.
 * @param {Record<string, unknown>} object
 * @param {string[]} keys
 * @returns {number|null}
 */
function firstNum(object, keys) {
  if (!isObject(object)) return null;
  for (const key of keys) {
    const parsed = num(object[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * First string value among the given keys of an object.
 * @param {Record<string, unknown>} object
 * @param {string[]} keys
 * @returns {string|null}
 */
function firstStr(object, keys) {
  if (!isObject(object)) return null;
  for (const key of keys) {
    const parsed = str(object[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Tolerant boolean: true/false booleans, "true"/"false" strings, 1/0 numbers.
 * Returns null when the value is not a recognizable boolean.
 * @param {unknown} value
 * @returns {boolean|null}
 */
function boolOrNull(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false;
  }
  return null;
}

/**
 * Shorten an error message for an `errors[]` entry.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function shortErr(value, max = 220) {
  const text = String(value ?? 'unknown error').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Deep JSON-safe conversion: `undefined`, non-finite numbers and functions
 * become `null`; values are cloned so callers cannot mutate a cache entry.
 * Cycles (which should not exist here) collapse to `null`.
 * @param {unknown} value
 * @param {Set<object>} [seen]
 * @returns {any}
 */
function jsonSafe(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const array = value.map((item) => jsonSafe(item, seen));
    seen.delete(value);
    return array;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    seen.delete(value);
    return Number.isFinite(time) ? time : null;
  }
  /** @type {Record<string, unknown>} */
  const object = {};
  for (const [key, item] of Object.entries(value)) {
    object[key] = jsonSafe(item, seen);
  }
  seen.delete(value);
  return object;
}

/** os.hostname() that cannot throw. @returns {string|null} */
function safeHostname() {
  try {
    return os.hostname();
  } catch {
    return null;
  }
}

/** os.userInfo().username that cannot throw. @returns {string|null} */
function safeUsername() {
  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

/** Number of logical CPUs that cannot throw. @returns {number} */
function safeCpuCount() {
  try {
    return os.cpus().length;
  } catch {
    return 0;
  }
}

/** Sum a numeric field across objects, ignoring nulls. */
function sumField(items, field) {
  let total = null;
  for (const item of items) {
    const value = num(item?.[field]);
    if (value === null) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/**
 * Normalize the `errors` array of a raw PowerShell document plus an optional
 * transport error. Also produces a populated `errors[]` for empty/failed input.
 * @param {unknown} raw
 * @param {string|null|undefined} transportError
 * @param {string} label
 * @returns {string[]}
 */
function collectErrors(raw, transportError, label) {
  const errors = [];
  if (transportError) errors.push(`${label}: ${shortErr(transportError)}`);
  if (!isObject(raw)) {
    errors.push(`${label}: PowerShell returned no data`);
    return errors;
  }
  if (Object.keys(raw).length === 0) errors.push(`${label}: PowerShell returned an empty document`);
  for (const item of asArray(raw.errors)) {
    const text = str(item);
    if (text) errors.push(shortErr(text));
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* PowerShell execution seam (injectable for tests)                           */
/* -------------------------------------------------------------------------- */

/** Default runner: read a bundled script and run it through the frozen bridge. */
async function defaultRunner(scriptName, options = {}) {
  return runPSJson(readScript(scriptName), {
    timeout: options.timeout ?? SCRIPT_TIMEOUT[scriptName] ?? 20_000,
  });
}

/** @type {(scriptName: string, options?: {timeout?: number}) => Promise<any>} */
let scriptRunner = defaultRunner;

/**
 * Run one bundled collection script. Never throws: a bridge failure becomes
 * `{ok:false, error}`.
 * @param {string} scriptName
 * @returns {Promise<{ok: true, data: any} | {ok: false, error: string}>}
 */
async function runScript(scriptName) {
  try {
    const result = await scriptRunner(scriptName, { timeout: SCRIPT_TIMEOUT[scriptName] ?? 20_000 });
    if (result && result.ok === true) return { ok: true, data: result.data };
    const error = result && (result.error || result.stderr) ? result.error || result.stderr : 'PowerShell returned no data';
    return { ok: false, error: shortErr(error) };
  } catch (error) {
    return { ok: false, error: shortErr(error instanceof Error ? error.message : error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Caching                                                                    */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, {value: any, at: number}>} */
const sectionCache = new Map();
/** @type {Map<string, Promise<any>>} */
const sectionInflight = new Map();

/* -------------------------------------------------------------------------- */
/* Rate tracking (metrics deltas)                                             */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, {at: number, read: number, write: number}>} */
const rateState = new Map();

/**
 * Turn two cumulative byte counters into per-second rates.
 * @param {string} key
 * @param {{read: number, write: number}|null} current
 * @param {number} at
 * @returns {{readBytesPerSec: number, writeBytesPerSec: number}}
 */
function rateOf(key, current, at) {
  if (!current) return { readBytesPerSec: 0, writeBytesPerSec: 0 };
  const previous = rateState.get(key);
  rateState.set(key, { at, read: current.read, write: current.write });
  if (!previous || at <= previous.at) return { readBytesPerSec: 0, writeBytesPerSec: 0 };
  const dt = (at - previous.at) / 1000;
  if (!(dt > 0)) return { readBytesPerSec: 0, writeBytesPerSec: 0 };
  return {
    readBytesPerSec: Math.max(0, Math.round((current.read - previous.read) / dt)),
    writeBytesPerSec: Math.max(0, Math.round((current.write - previous.write) / dt)),
  };
}

/**
 * Extract a cumulative counter pair from a raw script document.
 * @param {unknown} raw
 * @returns {{read: number, write: number}|null}
 */
function countersOf(raw) {
  if (!isObject(raw)) return null;
  const read = num(raw.read);
  const write = num(raw.write);
  if (read === null && write === null) return null;
  return { read: read ?? 0, write: write ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* CPU usage (os.cpus deltas, same algorithm as collector-darwin.js)          */
/* -------------------------------------------------------------------------- */

/** Previous `os.cpus()` snapshot for delta-based CPU usage. */
let cpuSnapshot = null;
/** Last computed CPU usage, used when two polls land within the same tick. */
let lastCpuUsage = { usagePercent: 0, perCore: [] };

/**
 * Whole-machine and per-core CPU usage from successive `os.cpus()` snapshots.
 * @returns {Promise<{usagePercent: number, perCore: number[]}>}
 */
async function cpuUsage() {
  const takeSnapshot = () =>
    os.cpus().map((cpu) => ({
      idle: cpu.times.idle,
      total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
    }));
  const compute = (previous, current) => {
    let idleDelta = 0;
    let totalDelta = 0;
    const perCore = current.map((core, index) => {
      const before = previous[index] ?? core;
      const idle = Math.max(0, core.idle - before.idle);
      const total = Math.max(0, core.total - before.total);
      idleDelta += idle;
      totalDelta += total;
      if (total <= 0) return lastCpuUsage.perCore[index] ?? 0;
      return round(clamp(100 * (1 - idle / total), 0, 100), 1);
    });
    const usagePercent =
      totalDelta > 0 ? round(clamp(100 * (1 - idleDelta / totalDelta), 0, 100), 1) : lastCpuUsage.usagePercent;
    lastCpuUsage = { usagePercent, perCore };
    return lastCpuUsage;
  };
  const current = takeSnapshot();
  if (!cpuSnapshot) {
    await sleep(80);
    const sampled = takeSnapshot();
    cpuSnapshot = sampled;
    return compute(current, sampled);
  }
  const previous = cpuSnapshot;
  cpuSnapshot = current;
  return compute(previous, current);
}

/* -------------------------------------------------------------------------- */
/* Shared value mappers                                                       */
/* -------------------------------------------------------------------------- */

/** Map a Win32_Processor.Architecture code to a readable architecture. */
function mapProcessorArchitecture(value) {
  switch (num(value)) {
    case 0:
      return 'x86';
    case 5:
      return 'arm';
    case 6:
      return 'ia64';
    case 9:
      return 'x64';
    case 12:
      return 'arm64';
    default:
      return null;
  }
}

/** Map a SMBIOS memory type code to a readable generation. */
function mapMemoryType(value) {
  switch (num(value)) {
    case 20:
      return 'DDR';
    case 21:
      return 'DDR2';
    case 22:
      return 'DDR2 FB-DIMM';
    case 24:
      return 'DDR3';
    case 26:
      return 'DDR4';
    case 27:
      return 'LPDDR';
    case 28:
      return 'LPDDR2';
    case 29:
      return 'LPDDR3';
    case 30:
      return 'LPDDR4';
    case 34:
      return 'DDR5';
    case 35:
      return 'LPDDR5';
    default:
      return null;
  }
}

/** Best-effort GPU vendor from the adapter name. */
function gpuVendor(name) {
  if (!name) return null;
  if (/nvidia/i.test(name)) return 'NVIDIA';
  if (/amd|radeon/i.test(name)) return 'AMD';
  if (/intel/i.test(name)) return 'Intel';
  if (/apple/i.test(name)) return 'Apple';
  if (/qualcomm|adreno/i.test(name)) return 'Qualcomm';
  if (/microsoft/i.test(name)) return 'Microsoft';
  return null;
}

/**
 * Windows reports Wi-Fi link quality as a percentage, not dBm. The conventional
 * quality% ≈ 2 × (dBm + 100) mapping is used so the UI receives a plausible
 * `rssi`; this is an approximation and is documented as such.
 * @param {unknown} percent
 * @param {unknown} dbm
 * @returns {number|null}
 */
function rssiFromSignal(percent, dbm) {
  const explicit = num(dbm);
  if (explicit !== null) return Math.round(explicit);
  const quality = num(percent);
  if (quality === null) return null;
  return Math.round(clamp(quality, 0, 100) / 2 - 100);
}

/**
 * Metrics-level Wi-Fi sample: `{ssid, rssi, channel} | null`.
 * @param {unknown} raw
 * @returns {{ssid: string, rssi: number|null, channel: number|null}|null}
 */
function mapMetricWifi(raw) {
  if (!isObject(raw)) return null;
  const ssid = str(raw.ssid);
  // Windows may redact the SSID behind a location-permission placeholder.
  if (!ssid || /^<.*>$/.test(ssid)) return null;
  return {
    ssid,
    rssi: rssiFromSignal(raw.signalPercent, raw.rssiDbm),
    channel: num(raw.channel),
  };
}

/**
 * Network-section Wi-Fi sample: `{ssid,bssid,rssi,noise,channel,security,txRateMbps} | null`.
 * @param {unknown} raw
 * @returns {{ssid: string, bssid: string|null, rssi: number|null, noise: null,
 *   channel: number|null, security: string|null, txRateMbps: number|null}|null}
 */
function mapNetworkWifi(raw) {
  if (!isObject(raw)) return null;
  const ssid = str(raw.ssid);
  if (!ssid || /^<.*>$/.test(ssid)) return null;
  return {
    ssid,
    bssid: str(raw.bssid),
    rssi: rssiFromSignal(raw.signalPercent, raw.rssiDbm),
    noise: null,
    channel: num(raw.channel),
    security: firstStr(raw, ['authentication', 'security']),
    txRateMbps: num(raw.transmitRateMbps) ?? num(raw.receiveRateMbps),
  };
}

/**
 * Memory pressure estimate from the last metrics sample. Windows has no
 * pressure-level counter, so this is a documented heuristic on available RAM.
 * @param {number|null} totalBytes
 * @param {number|null} freeBytes
 * @param {number|null} availableBytes
 * @returns {'normal'|'warning'|'critical'|null}
 */
function memoryPressure(totalBytes, freeBytes, availableBytes) {
  const effectiveFree = availableBytes ?? freeBytes;
  if (effectiveFree === null || totalBytes === null || totalBytes <= 0) return null;
  const ratio = effectiveFree / totalBytes;
  if (ratio < 0.05) return 'critical';
  if (ratio < 0.12) return 'warning';
  return 'normal';
}

/**
 * Store the five standard `metrics.battery` fields (present==false → null).
 * @param {unknown} raw
 * @returns {object|null}
 */
function mapMetricBattery(raw) {
  if (!isObject(raw) || raw.present === false) return null;
  return {
    present: true,
    percent: num(raw.percent),
    charging: boolOrNull(raw.charging) ?? false,
    plugged: boolOrNull(raw.plugged) ?? false,
    powerSource: str(raw.powerSource),
    timeRemainingMin: num(raw.timeRemainingMin),
    temperatureC: round(raw.temperatureC, 1),
    cycleCount: num(raw.cycleCount),
    healthPercent: num(raw.healthPercent),
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: metrics.thermal and hardware.drivers                               */
/* -------------------------------------------------------------------------- */

/** Contract cap for `hardware.drivers` (both platforms). */
const MAX_DRIVERS = 250;
/** Contract cap for `hardware.driverProblems` (Windows only). */
const MAX_DRIVER_PROBLEMS = 50;

/** Allowed `metrics.thermal.note` values (frozen). */
const THERMAL_NOTES = ['cpu-needs-admin', 'wmi-unsupported', 'unavailable'];

/**
 * Accept only a physically plausible temperature (a malformed CIM/nvidia-smi
 * value must never become a bogus reading).
 * @param {unknown} value
 * @returns {number|null}
 */
function plausibleTemperature(value) {
  const parsed = num(value);
  if (parsed === null || parsed < -20 || parsed > 150) return null;
  return round(parsed, 1);
}

/**
 * The contract's null-filled thermal object (fallback metrics / hard failure).
 * @param {'cpu-needs-admin'|'wmi-unsupported'|'unavailable'|null} [note]
 * @returns {{available: false, cpuCelsius: null, gpuCelsius: null,
 *   batteryCelsius: null, nvmeCelsius: null, pressure: null, fans: never[],
 *   sources: never[], note: 'cpu-needs-admin'|'wmi-unsupported'|'unavailable'|null}}
 */
function emptyThermal(note = null) {
  return {
    available: false,
    cpuCelsius: null,
    gpuCelsius: null,
    batteryCelsius: null,
    nvmeCelsius: null,
    pressure: null,
    fans: [],
    sources: [],
    note,
  };
}

/**
 * Pure mapper for the `thermal` block emitted by metrics.ps1.
 *
 * Windows sources: `MSAcpi_ThermalZoneTemperature` (WMI thermal zones, the
 * script keeps only plausible zones and reports their max as `cpuCelsius`),
 * optional `nvidia-smi` (GPU temperature + fan percent) and the
 * `Win32_Battery`/`BatteryStatus` block for `batteryCelsius`. There is no
 * Windows thermal-pressure counter, so `pressure` is always null.
 *
 * @param {unknown} raw thermal sub-document
 * @param {object|null} battery mapped `metrics.battery`
 * @returns {object} frozen `metrics.thermal` shape
 */
function mapThermal(raw, battery) {
  const data = isObject(raw) ? raw : {};
  const fans = asArray(data.fans)
    .filter(isObject)
    .slice(0, 8)
    .map((fan) => ({ name: str(fan.name), rpm: num(fan.rpm) }));
  const cpuCelsius = plausibleTemperature(data.cpuCelsius);
  const gpuCelsius = plausibleTemperature(data.gpuCelsius);
  const batteryCelsius =
    battery && typeof battery.temperatureC === 'number'
      ? plausibleTemperature(battery.temperatureC)
      : plausibleTemperature(data.batteryCelsius);
  const sources = asArray(data.sources)
    .map((value) => str(value))
    .filter((value) => value !== null)
    .slice(0, 12);
  const note = THERMAL_NOTES.includes(str(data.note)) ? str(data.note) : cpuCelsius === null ? 'wmi-unsupported' : null;
  const nvmeCelsius = plausibleTemperature(data.nvmeCelsius);
  const available = [cpuCelsius, gpuCelsius, batteryCelsius, nvmeCelsius].some(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
  return {
    available,
    cpuCelsius,
    gpuCelsius,
    batteryCelsius,
    nvmeCelsius,
    pressure: null,
    fans,
    sources,
    note,
  };
}

/**
 * Normalise a driver date into the contract's `yyyy-MM-dd` form. Accepts the
 * string already formatted by hardware.ps1 as well as defensive alternatives
 * (ISO timestamps, numeric epoch ms) without ever throwing.
 * @param {unknown} value
 * @returns {string|null}
 */
function mapDriverDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  const text = str(value);
  if (text === null) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/**
 * Pure mapper for one `Win32_PnPSignedDriver` record.
 * @param {unknown} raw
 * @returns {{name: string, class: string|null, manufacturer: string|null,
 *   version: string|null, date: string|null, signer: string|null,
 *   inf: string|null, deviceId: string|null, kind: 'kext'|'driverkit'|'pnp',
 *   problem: string|null}}
 */
function mapDriver(raw) {
  const entry = isObject(raw) ? raw : {};
  const name = str(entry.name) ?? str(entry.deviceName) ?? str(entry.DeviceName) ?? 'Unknown device';
  const kind = str(entry.kind);
  return {
    name,
    class: str(entry.class) ?? str(entry.deviceClass),
    manufacturer: str(entry.manufacturer),
    version: str(entry.version) ?? str(entry.driverVersion),
    date: mapDriverDate(entry.date ?? entry.driverDate),
    signer: str(entry.signer) ?? str(entry.driverProviderName),
    inf: str(entry.inf) ?? str(entry.infName),
    deviceId: str(entry.deviceId) ?? str(entry.deviceID),
    kind: kind === 'kext' || kind === 'driverkit' ? kind : 'pnp',
    problem: str(entry.problem),
  };
}

/**
 * Pure mapper for one problem PnP device (`ConfigManagerErrorCode != 0`).
 * @param {unknown} raw
 * @returns {{name: string, code: string, class: string|null}}
 */
function mapDriverProblem(raw) {
  const entry = isObject(raw) ? raw : {};
  return {
    name: str(entry.name) ?? str(entry.deviceName) ?? 'Unknown device',
    code: str(entry.code) ?? str(entry.configManagerErrorCode) ?? 'unknown',
    class: str(entry.class) ?? str(entry.deviceClass),
  };
}

/**
 * A driver is third-party unless its provider/manufacturer is Microsoft.
 * Empty vendors are not counted as third-party (never invent a value).
 * @param {{signer: string|null, manufacturer: string|null}} driver
 * @returns {boolean}
 */
function isThirdPartyDriver(driver) {
  const vendor = driver.signer ?? driver.manufacturer;
  return vendor !== null && !/^microsoft/i.test(vendor);
}

/**
 * Build the header-style Windows OS version string, e.g.
 * `Windows 11 23H2 (22631)`.
 * @param {Record<string, any>} rawOs
 * @returns {string|null}
 */
function windowsOsVersion(rawOs) {
  if (!isObject(rawOs)) return null;
  const caption = str(rawOs.caption);
  const displayVersion = str(rawOs.displayVersion);
  const version = str(rawOs.version);
  const build = str(rawOs.build);
  // Never fabricate a version: without any OS fact the value is genuinely
  // unavailable and the contract allows null.
  if (caption === null && displayVersion === null && version === null && build === null) return null;
  let family = null;
  if (caption) {
    const cleaned = caption.replace(/^Microsoft\s+/i, '').trim();
    const match = /^(Windows\s+\S+)/i.exec(cleaned);
    family = match ? match[1] : cleaned;
  }
  if (!family) family = 'Windows';
  let text = family;
  if (displayVersion) text += ` ${displayVersion}`;
  else if (version) text += ` ${version}`;
  if (build && !text.includes(build)) text += ` (${build})`;
  return text;
}

/* -------------------------------------------------------------------------- */
/* Mapper: metrics                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pure mapper for `metrics.ps1` output.
 *
 * `context.cpu` carries the `os.cpus()` delta sample; `context.rates` carries
 * the network/disk byte-rate deltas. Both default to safe zero values so the
 * mapper is directly usable by the offline fixture verification.
 *
 * @param {unknown} raw
 * @param {{cpu?: {usagePercent?: number, perCore?: number[]}, rates?: {network?: object, disk?: object}, now?: number}} [context]
 * @returns {object} frozen `Metrics` shape
 */
function mapMetrics(raw, context = {}) {
  const data = isObject(raw) ? raw : {};
  const now = num(context.now) ?? Date.now();
  const cpuSample = isObject(context.cpu) ? context.cpu : {};
  const rates = isObject(context.rates) ? context.rates : {};
  const diskRates = isObject(rates.disk) ? rates.disk : {};
  const networkRates = isObject(rates.network) ? rates.network : {};

  const cpuRaw = isObject(data.cpu) ? data.cpu : {};
  const memoryRaw = isObject(data.memory) ? data.memory : {};
  const diskRaw = isObject(data.disk) ? data.disk : {};
  const networkRaw = isObject(data.network) ? data.network : {};
  const processRaw = isObject(data.processes) ? data.processes : {};
  const osRaw = isObject(data.os) ? data.os : {};
  const battery = mapMetricBattery(data.battery);

  const logicalCores = num(cpuRaw.logicalCores) ?? safeCpuCount() ?? 0;
  const physicalCores = num(cpuRaw.physicalCores) ?? logicalCores;
  const perCore = asArray(cpuSample.perCore)
    .map((value) => round(value, 1))
    .filter((value) => value !== null);

  const totalBytes = num(memoryRaw.totalBytes) ?? os.totalmem();
  const freeBytes = num(memoryRaw.freeBytes) ?? os.freemem();
  const usedBytes =
    num(memoryRaw.usedBytes) ?? (totalBytes !== null && freeBytes !== null ? Math.max(0, totalBytes - freeBytes) : null);
  const availableBytes = num(memoryRaw.availableBytes);
  const cachedBytes = num(memoryRaw.cacheBytes);

  const networkCounters = countersOf(networkRaw.counters);
  const bootTimeMs = num(osRaw.lastBootUpTimeMs);

  const topProcesses = asArray(processRaw.top)
    .filter(isObject)
    .slice(0, 5)
    .map((entry) => {
      const workingSetBytes = num(entry.workingSetBytes);
      const memPercent =
        num(entry.memPercent) ??
        (workingSetBytes !== null && totalBytes !== null && totalBytes > 0
          ? round(clamp((workingSetBytes / totalBytes) * 100, 0, 100), 1)
          : 0);
      return {
        pid: num(entry.pid) ?? 0,
        name: str(entry.name),
        cpu: round(clamp((num(entry.cpuPercent) ?? 0) / Math.max(1, logicalCores), 0, 100), 1) ?? 0,
        memPercent: memPercent ?? 0,
        user: str(entry.user),
      };
    });

  const hostname = str(data.hostname) ?? safeHostname() ?? 'unknown';
  const osVersion = windowsOsVersion(osRaw);
  const uptimeSec =
    bootTimeMs !== null && bootTimeMs > 0 && now > bootTimeMs
      ? Math.floor((now - bootTimeMs) / 1000)
      : (() => {
          try {
            return Math.floor(os.uptime());
          } catch {
            return null;
          }
        })();

  return {
    ts: now,
    hostname,
    osVersion,
    uptimeSec,
    cpu: {
      model: str(cpuRaw.name) ?? (safeCpuCount() > 0 ? str(os.cpus()[0]?.model) : null),
      usagePercent: round(cpuSample.usagePercent, 1) ?? 0,
      perCore,
      loadAvg: [], // Windows has no load-average metric; empty (never faked).
      logicalCores,
      physicalCores,
    },
    memory: {
      totalBytes,
      usedBytes,
      appBytes: num(memoryRaw.appBytes),
      wiredBytes: num(memoryRaw.wiredBytes),
      compressedBytes: num(memoryRaw.compressedBytes),
      cachedBytes:
        cachedBytes !== null && totalBytes !== null ? clamp(Math.round(cachedBytes), 0, totalBytes) : null,
      freeBytes,
      swapTotalBytes: num(memoryRaw.pageFileTotalBytes),
      swapUsedBytes: num(memoryRaw.pageFileUsedBytes),
      pressure: memoryPressure(totalBytes, freeBytes, availableBytes),
    },
    disk: {
      totalBytes: num(diskRaw.totalBytes),
      usedBytes: num(diskRaw.usedBytes),
      freeBytes: num(diskRaw.freeBytes),
      readBytesPerSec: num(diskRates.readBytesPerSec) ?? 0,
      writeBytesPerSec: num(diskRates.writeBytesPerSec) ?? 0,
    },
    network: {
      rxBytesPerSec: num(networkRates.readBytesPerSec) ?? 0,
      txBytesPerSec: num(networkRates.writeBytesPerSec) ?? 0,
      totalRxBytes: networkCounters ? networkCounters.read : null,
      totalTxBytes: networkCounters ? networkCounters.write : null,
      wifi: mapMetricWifi(networkRaw.wifi),
      primaryIpv4: asArray(networkRaw.primaryIpv4)
        .map((value) => str(value))
        .filter((value) => value !== null),
      defaultInterface: str(networkRaw.defaultInterface),
    },
    battery,
    thermal: mapThermal(data.thermal, battery),
    processes: {
      total: num(processRaw.total) ?? 0,
      top: topProcesses,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: hardware                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pure mapper for `hardware.ps1` output.
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `hardware` section shape
 */
function mapHardware(raw, transportError) {
  const label = 'hardware.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);
  const cpuRaw = isObject(data.cpu) ? data.cpu : {};
  const memoryRaw = isObject(data.memory) ? data.memory : {};
  const physicalRaw = asArray(data.physicalDisks).filter(isObject);
  const diskDrivesRaw = asArray(data.diskDrives).filter(isObject);
  const controllerRaw = asArray(data.videoControllers).filter(isObject);
  const monitorRaw = asArray(data.monitors).filter(isObject);

  const modules = asArray(memoryRaw.modules)
    .filter(isObject)
    .map((module) => ({
      slot: str(module.deviceLocator) ?? str(module.slot),
      sizeBytes: num(module.capacityBytes) ?? num(module.sizeBytes),
      type: mapMemoryType(module.smbiosType) ?? str(module.type),
      speedMHz: num(module.speedMHz) ?? num(module.configuredSpeedMHz),
      manufacturer: str(module.manufacturer),
      partNumber: str(module.partNumber),
    }));

  const moduleTotal = sumField(modules, 'sizeBytes');
  const totalBytes = num(memoryRaw.totalBytes) ?? moduleTotal;
  const memory = {
    totalBytes,
    type: modules.length > 0 ? modules[0].type : str(memoryRaw.type),
    speedMHz: modules.length > 0 ? modules[0].speedMHz : num(memoryRaw.speedMHz),
    modules,
  };

  const gpu = controllerRaw.map((controller) => ({
    name: str(controller.name),
    cores: num(controller.cores),
    vramBytes: num(controller.adapterRamBytes),
    vendor: gpuVendor(str(controller.name)),
    metal: null,
  }));

  /** @type {Array<{name: string|null, resolution: string|null, refreshHz: number|null, main: boolean, connection: string|null}>} */
  const displays = [];
  for (const controller of controllerRaw) {
    const width = num(controller.currentWidth);
    const height = num(controller.currentHeight);
    if (width === null || height === null || width <= 0 || height <= 0) continue;
    displays.push({
      name: str(controller.name),
      resolution: `${width}x${height}`,
      refreshHz: num(controller.currentRefreshHz),
      main: displays.length === 0,
      connection: null,
    });
  }
  if (displays.length === 0 && monitorRaw.length > 0) {
    monitorRaw.forEach((monitor, index) => {
      displays.push({
        name: str(monitor.name) ?? str(monitor.manufacturer),
        resolution: null,
        refreshHz: null,
        main: index === 0,
        connection: null,
      });
    });
  }

  const physical =
    physicalRaw.length > 0
      ? physicalRaw.map((disk) => ({
          name: str(disk.name) ?? str(disk.model),
          model: str(disk.model) ?? str(disk.name),
          sizeBytes: num(disk.sizeBytes),
          mediaType: str(disk.mediaType),
          smartStatus: str(disk.smartStatus),
        }))
      : diskDrivesRaw.map((disk) => ({
          name: str(disk.model),
          model: str(disk.model),
          sizeBytes: num(disk.sizeBytes),
          mediaType: str(disk.mediaType),
          smartStatus: null,
        }));

  const volumes = asArray(data.volumes)
    .filter(isObject)
    .map((volume) => {
      const total = num(volume.totalBytes);
      const free = num(volume.freeBytes);
      const driveType = num(volume.driveType);
      return {
        name: str(volume.name) ?? str(volume.deviceId),
        mount: str(volume.deviceId),
        fs: str(volume.fs),
        totalBytes: total,
        usedBytes: total !== null && free !== null ? Math.max(0, total - free) : null,
        freeBytes: free,
        removable: driveType === null ? null : driveType === 2,
        internal: driveType === null ? null : driveType === 3,
      };
    });

  let battery = null;
  if (isObject(data.battery) && data.battery.present !== false) {
    battery = {
      percent: num(data.battery.percent),
      condition: str(data.battery.condition),
      cycleCount: num(data.battery.cycleCount),
      designCapacityMah: num(data.battery.designCapacityMah),
      maxCapacityMah: num(data.battery.maxCapacityMah),
      temperatureC: round(data.battery.temperatureC, 1),
      healthPercent: num(data.battery.healthPercent),
    };
  }

  const usb = asArray(data.usb)
    .filter(isObject)
    .map((device) => ({
      name: str(device.name),
      vendor: str(device.vendor),
      productId: str(device.productId),
      serial: str(device.serial),
      speed: str(device.speed),
      bus: str(device.bus),
    }));

  const bluetoothControllers = asArray(data.bluetoothControllers).filter(isObject);
  const bluetoothController =
    bluetoothControllers.length > 0
      ? {
          address: str(bluetoothControllers[0].address),
          chipset: str(bluetoothControllers[0].chipset) ?? str(bluetoothControllers[0].name),
          firmware: str(bluetoothControllers[0].firmware),
          state: str(bluetoothControllers[0].state),
        }
      : null;
  const bluetoothDevices = asArray(data.bluetoothDevices)
    .filter(isObject)
    .map((device) => ({
      name: str(device.name),
      address: str(device.address),
      connected: device.connected === false ? false : true,
      batteryPercent: num(device.batteryPercent),
      type: str(device.type),
    }));

  const audio = asArray(data.audio)
    .filter(isObject)
    .map((device) => ({
      name: str(device.name),
      kind: device.kind === 'input' ? 'input' : 'output',
      manufacturer: str(device.manufacturer),
      default: device.default === true,
    }));

  const cameras = asArray(data.cameras)
    .filter(isObject)
    .map((camera) => ({
      name: str(camera.name),
      modelId: str(camera.modelId),
      uniqueId: str(camera.uniqueId),
    }));

  // `drivers` comes from Win32_PnPSignedDriver (cap 250); `driverProblems` from
  // Win32_PnPEntity rows whose ConfigManagerErrorCode is non-zero (cap 50).
  // The summary is derived here so it can never disagree with the arrays;
  // `truncated` flags that the raw driver list exceeded the cap.
  const rawDrivers = asArray(data.drivers).filter(isObject);
  const drivers = rawDrivers.slice(0, MAX_DRIVERS).map(mapDriver);
  const driverProblems = asArray(data.driverProblems)
    .filter(isObject)
    .slice(0, MAX_DRIVER_PROBLEMS)
    .map(mapDriverProblem);
  const driverSummary = {
    total: drivers.length,
    thirdParty: drivers.filter(isThirdPartyDriver).length,
    problems: driverProblems.length,
    truncated: rawDrivers.length > MAX_DRIVERS,
  };

  return {
    cpu: {
      model: str(cpuRaw.name),
      vendor: str(cpuRaw.manufacturer),
      physicalCores: num(cpuRaw.physicalCores) ?? safeCpuCount(),
      logicalCores: num(cpuRaw.logicalCores) ?? safeCpuCount(),
      speedGHz:
        num(cpuRaw.maxClockSpeedMHz) === null ? null : round(num(cpuRaw.maxClockSpeedMHz) / 1000, 2),
      architecture: mapProcessorArchitecture(cpuRaw.architecture),
      features: asArray(cpuRaw.features)
        .map((value) => str(value))
        .filter((value) => value !== null),
    },
    memory,
    gpu,
    displays,
    storage: { physical, volumes },
    battery,
    usb,
    bluetooth: { controller: bluetoothController, devices: bluetoothDevices },
    audio,
    cameras,
    drivers,
    driverSummary,
    driverProblems,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: system                                                             */
/* -------------------------------------------------------------------------- */

/** Map PROCESSOR_ARCHITECTURE to the contract-ish arch string. */
function mapHostArchitecture(value) {
  const text = str(value);
  if (!text) return null;
  switch (text.toUpperCase()) {
    case 'AMD64':
      return 'x64';
    case 'ARM64':
      return 'arm64';
    case 'X86':
      return 'x86';
    case 'IA64':
      return 'ia64';
    default:
      return text.toLowerCase();
  }
}

/**
 * Pure mapper for `system.ps1` output.
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `system` section shape
 */
function mapSystem(raw, transportError) {
  const label = 'system.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);
  const osRaw = isObject(data.os) ? data.os : {};
  const deviceRaw = isObject(data.device) ? data.device : {};
  const bootRaw = isObject(data.boot) ? data.boot : {};
  const usersRaw = isObject(data.users) ? data.users : {};
  const currentRaw = isObject(usersRaw.current) ? usersRaw.current : null;
  const environmentRaw = isObject(data.environment) ? data.environment : {};
  const localeRaw = isObject(data.locale) ? data.locale : {};

  const hostname = str(deviceRaw.hostname) ?? safeHostname() ?? 'unknown';
  const computerName = str(deviceRaw.computerName) ?? hostname;
  const localHostname = str(deviceRaw.localHostname) ?? hostname;

  const caption = str(osRaw.caption);
  let family = null;
  if (caption) {
    const cleaned = caption.replace(/^Microsoft\s+/i, '').trim();
    const match = /^(Windows\s+\S+)/i.exec(cleaned);
    family = match ? match[1] : cleaned;
  }

  const version = str(osRaw.version);
  const build = str(osRaw.build);
  const bootTime = num(bootRaw.bootTimeMs);
  const now = Date.now();
  let uptimeSec = num(bootRaw.uptimeSec);
  if (uptimeSec === null) {
    if (bootTime !== null && bootTime > 0 && now > bootTime) {
      uptimeSec = Math.floor((now - bootTime) / 1000);
    } else {
      try {
        uptimeSec = Math.floor(os.uptime());
      } catch {
        uptimeSec = null;
      }
    }
  }

  const currentName = str(usersRaw.current) ?? str(currentRaw?.name) ?? safeUsername();
  const adminNames = asArray(usersRaw.admins)
    .map((value) => str(value))
    .filter((value) => value !== null);
  const adminSet = new Set(adminNames.map((value) => value.toLowerCase()));

  const currentFullName = str(currentRaw?.fullName);
  const currentHome = str(currentRaw?.home) ?? str(environmentRaw.HOME);
  const user =
    currentName === null
      ? null
      : {
          name: currentName,
          fullName: currentFullName,
          uid: null,
          gid: null,
          home: currentHome,
          shell: null,
          admin: adminSet.has(currentName.toLowerCase()),
        };

  const users = asArray(usersRaw.localUsers)
    .filter(isObject)
    .map((account) => {
      const name = str(account.name);
      return {
        name,
        uid: null,
        gid: null,
        fullName: str(account.fullName),
        home: str(account.home),
        shell: null,
        admin: name !== null && adminSet.has(name.toLowerCase()),
        isCurrent: name !== null && currentName !== null && name.toLowerCase() === currentName.toLowerCase(),
      };
    })
    .filter((account) => account.name !== null);

  /** @type {Array<{label: string|null, path: string, scope: 'user'|'system', loaded: boolean, pid: number|null, lastExitStatus: number|null, program: string}>} */
  const launchAgents = asArray(data.startup)
    .filter(isObject)
    .filter((entry) => str(entry.source) === null || str(entry.source) === 'registry')
    .map((entry) => {
      const path = str(entry.path) ?? '';
      return {
        label: str(entry.label) ?? path,
        path,
        scope: str(entry.scope) === 'user' ? 'user' : 'system',
        loaded: entry.loaded !== false,
        pid: null,
        lastExitStatus: null,
        program: str(entry.program) ?? '',
      };
    })
    .filter((entry) => entry.path !== '');
  launchAgents.sort((left, right) => {
    if (left.scope !== right.scope) return left.scope === 'user' ? -1 : 1;
    return (left.label ?? left.path).localeCompare(right.label ?? right.path);
  });

  const loginItems = asArray(data.loginItems)
    .map((item) => ({ name: isObject(item) ? str(item.name) : str(item) }))
    .filter((item) => item.name !== null);

  let timezone = str(localeRaw.timezone);
  if (timezone === null) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      timezone = null;
    }
  }

  return {
    os: {
      name: family ?? 'Windows',
      version,
      build,
      kernel: version ? `Windows NT ${version}` : null,
      arch: mapHostArchitecture(osRaw.processorArchitecture) ?? process.arch ?? null,
      release: build,
    },
    device: {
      hostname,
      computerName,
      localHostname,
      model: str(deviceRaw.model) ?? str(deviceRaw.manufacturer),
      modelId: str(deviceRaw.modelId),
      chip: str(deviceRaw.chip),
      serial: str(deviceRaw.serial),
      hardwareUuid: str(deviceRaw.hardwareUuid),
    },
    boot: { bootTime, uptimeSec },
    user,
    users,
    launchAgents,
    loginItems,
    environment: {
      PATH: str(environmentRaw.PATH) ?? str(process.env.PATH),
      SHELL: str(environmentRaw.SHELL),
      HOME: str(environmentRaw.HOME) ?? str(process.env.USERPROFILE) ?? str(process.env.HOME),
      USER: str(environmentRaw.USER) ?? str(process.env.USERNAME) ?? str(process.env.USER),
      LANG: str(environmentRaw.LANG),
      TERM: str(environmentRaw.TERM),
    },
    locale: {
      timezone,
      locale: str(localeRaw.locale),
      language: str(localeRaw.language),
    },
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: software                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pure mapper for `software.ps1` output.
 *
 * Windows sources:
 *  - installed applications from the registry Uninstall keys; `uninstallId` is
 *    `<HIVE>:<full key path>` (the action engine's uninstall input) and
 *    `bundleId` is the registry key name (GUID or product key);
 *  - `source` is `user` for HKCU entries and `other` for HKLM entries (the
 *    client only disables uninstall for `system`, which is reserved for
 *    protected macOS apps);
 *  - `homebrew` is present but unavailable; `winget` is an additive field
 *    detected by the script (cached with the section's 10-minute TTL).
 *
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `software` section shape (+ additive `winget`)
 */
function mapSoftware(raw, transportError) {
  const label = 'software.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);

  const applications = asArray(data.applications)
    .filter(isObject)
    .map((application) => {
      const hiveText = str(application.hive)?.toUpperCase() ?? null;
      const hive = hiveText === 'HKLM' || hiveText === 'HKCU' ? hiveText : null;
      const keyPathText = str(application.keyPath);
      // Only build the action-facing uninstallId for a genuine Uninstall key
      // path; a malformed document must not yield an id the action engine would
      // reject (or worse, misread).
      const keyPath =
        keyPathText !== null &&
        /^Software\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\/i.test(keyPathText)
          ? keyPathText
          : null;
      const keyName = str(application.keyName);
      const estimatedSizeKb = num(application.estimatedSizeKB);
      return {
        name: str(application.displayName),
        path: str(application.installLocation) ?? '',
        version: str(application.version),
        bundleId: keyName,
        uninstallId: hive !== null && keyPath !== null ? `${hive}:${keyPath}` : null,
        source: hive === 'HKCU' ? 'user' : 'other',
        arch: str(application.arch),
        lastUsed: null,
        sizeBytes: estimatedSizeKb === null ? null : Math.round(estimatedSizeKb * 1024),
      };
    })
    .filter((application) => application.name !== null);
  applications.sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));

  const wingetRaw = isObject(data.winget) ? data.winget : {};

  return {
    applications,
    totalApplications: applications.length,
    homebrew: { available: false, prefix: null, installed: [], outdated: [] },
    winget: {
      available: wingetRaw.available === true,
      version: str(wingetRaw.version),
    },
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: network                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Classify a Windows adapter for the contract's interface type enum.
 * @param {Record<string, any>} adapter
 * @returns {'wifi'|'ethernet'|'loopback'|'bridge'|'other'}
 */
function mapInterfaceType(adapter) {
  const name = str(adapter.name) ?? '';
  const description = str(adapter.description) ?? '';
  const combined = `${name} ${description}`;
  if (/loopback/i.test(combined)) return 'loopback';
  const medium = num(adapter.ndisMedium);
  if (medium === 9 || medium === 1 || medium === 8 || medium === 12) return 'wifi';
  if (/wi-?fi|wireless|wlan|802\.11/i.test(combined)) return 'wifi';
  if (/hyper-v|vethernet|bridge|virtual switch/i.test(combined)) return 'bridge';
  if (medium === 14 || medium === 17 || medium === 18) return 'ethernet';
  if (/ethernet|802\.3|gbe/i.test(combined)) return 'ethernet';
  return 'other';
}

/**
 * Map the WinHTTP/IE proxy settings into the contract's three slots.
 * @param {unknown} raw
 * @returns {{http: string|null, https: string|null, socks: string|null}}
 */
function mapProxy(raw) {
  const result = { http: null, https: null, socks: null };
  if (!isObject(raw)) return result;
  const enabled = raw.enable === true || raw.enable === 1 || raw.enable === '1';
  if (!enabled) return result;
  const server = str(raw.server);
  if (!server) return result;
  if (server.includes('=')) {
    for (const part of server.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const key = part.slice(0, separator).trim().toLowerCase();
      const value = str(part.slice(separator + 1));
      if (!value) continue;
      if (key === 'http') result.http = value;
      else if (key === 'https') result.https = value;
      else if (key === 'socks' || key === 'socks5') result.socks = value;
    }
  } else {
    result.http = server;
    result.https = server;
  }
  return result;
}

/**
 * Pure mapper for `network.ps1` output.
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `network` section shape
 */
function mapNetwork(raw, transportError) {
  const label = 'network.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);
  const routeRaw = isObject(data.defaultRoute) ? data.defaultRoute : null;
  const defaultInterface = str(routeRaw?.interface);

  /** @type {Array<{name: string, type: string, up: boolean, ipv4: string[], ipv6: string[], mac: string|null, mtu: number|null, primary: boolean}>} */
  const interfaces = [];
  const seenNames = new Set();
  for (const adapter of asArray(data.adapters).filter(isObject)) {
    const name = str(adapter.name);
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    const ipv4 = asArray(adapter.ipv4)
      .map((value) => str(value))
      .filter((value) => value !== null);
    const ipv6 = asArray(adapter.ipv6)
      .map((value) => str(value))
      .filter((value) => value !== null);
    const type = mapInterfaceType(adapter);
    const status = (str(adapter.status) ?? '').toLowerCase();
    const up = status === 'up' || status === 'connected' || adapter.up === true;
    const isPrimary = defaultInterface !== null && name === defaultInterface;
    if (type === 'loopback') {
      // network.ps1 intentionally drops 127.0.0.1/::1 from the address maps;
      // the loopback interface still needs its well-known addresses so the UI
      // receives a complete interface card.
      if (ipv4.length === 0) ipv4.push('127.0.0.1');
      if (ipv6.length === 0) ipv6.push('::1');
    }
    if (type !== 'loopback' && !isPrimary && !up && ipv4.length === 0 && ipv6.length === 0) continue;
    let mtu = num(adapter.mtu);
    // The Windows loopback adapter reports a sentinel MTU (4294967295); it is
    // not a meaningful value, so report null instead of a bogus number.
    if (mtu !== null && mtu > 1_000_000) mtu = null;
    interfaces.push({
      name,
      type,
      up,
      ipv4,
      ipv6,
      mac: str(adapter.mac),
      mtu,
      primary: isPrimary,
    });
  }
  if (!interfaces.some((entry) => entry.type === 'loopback')) {
    interfaces.unshift({
      name: 'Loopback',
      type: 'loopback',
      up: true,
      ipv4: ['127.0.0.1'],
      ipv6: ['::1'],
      mac: null,
      mtu: null,
      primary: false,
    });
  }
  interfaces.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    if (left.type === 'loopback' && right.type !== 'loopback') return 1;
    if (right.type === 'loopback' && left.type !== 'loopback') return -1;
    return left.name.localeCompare(right.name);
  });

  const dnsRaw = isObject(data.dns) ? data.dns : {};
  const dnsServers = [];
  for (const server of asArray(dnsRaw.servers)) {
    const text = str(server);
    if (text && !dnsServers.includes(text)) dnsServers.push(text);
  }
  const searchDomains = [];
  for (const domain of asArray(dnsRaw.searchDomains)) {
    const text = str(domain);
    if (text && !searchDomains.includes(text)) searchDomains.push(text);
  }

  /** @type {Array<{proto: string, address: string, port: number, pid: number|null, process: string}>} */
  const listeningPorts = [];
  const pushListeners = (items, proto) => {
    for (const listener of items) {
      if (!isObject(listener)) continue;
      const port = num(listener.port);
      if (port === null || port <= 0) continue;
      listeningPorts.push({
        proto,
        address: str(listener.address) ?? '*',
        port,
        pid: num(listener.pid),
        process: str(listener.process),
      });
    }
  };
  pushListeners(asArray(data.tcpListeners), 'tcp');
  pushListeners(asArray(data.udpListeners), 'udp');
  listeningPorts.sort((left, right) => left.port - right.port || left.proto.localeCompare(right.proto));
  listeningPorts.splice(500);

  return {
    interfaces,
    wifi: mapNetworkWifi(data.wifi),
    defaultRoute:
      routeRaw && (str(routeRaw.gateway) !== null || str(routeRaw.interface) !== null)
        ? { gateway: str(routeRaw.gateway), interface: str(routeRaw.interface) }
        : null,
    dns: { servers: dnsServers.slice(0, 12), searchDomains: searchDomains.slice(0, 12) },
    proxy: mapProxy(data.proxy),
    listeningPorts,
    establishedCount: num(data.establishedCount) ?? 0,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: security                                                           */
/* -------------------------------------------------------------------------- */

/** Normalize one `{enabled, raw}` status block. */
function statusFlag(raw) {
  const value = isObject(raw) ? raw : {};
  return { enabled: boolOrNull(value.enabled), raw: str(value.raw) };
}

/**
 * Pure mapper for `security.ps1` output.
 *
 * Windows mapping: BitLocker → fileVault, Secure Boot → sip, Defender real-time
 * protection → gatekeeper, Windows Firewall profiles → firewall, Remote Desktop
 * → remoteLogin, Winlogon auto-logon → autoLogin. TCC has no Windows analogue,
 * so the documented fixed `{readable:false, ...}` payload is returned.
 *
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `security` section shape
 */
function mapSecurity(raw, transportError) {
  const label = 'security.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);
  const usersRaw = isObject(data.users) ? data.users : {};
  const firewallRaw = isObject(data.firewall) ? data.firewall : {};

  const admins = asArray(usersRaw.admins)
    .map((value) => str(value))
    .filter((value) => value !== null);

  return {
    fileVault: statusFlag(data.fileVault),
    sip: statusFlag(data.sip),
    gatekeeper: statusFlag(data.gatekeeper),
    firewall: {
      ...statusFlag(firewallRaw),
      stealthMode: boolOrNull(firewallRaw.stealthMode),
    },
    tcc: {
      readable: false,
      reason: 'Windows does not expose a per-app consent store',
      grants: [],
    },
    users: {
      current: str(usersRaw.current) ?? safeUsername(),
      admins,
      total: num(usersRaw.total),
    },
    remoteLogin: boolOrNull(data.remoteLogin),
    autoLogin: str(data.autoLogin),
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Mapper: processes                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pure mapper for `processes.ps1` output.
 *
 * Windows perf counters report CPU across all logical processors; the raw value
 * is divided by the logical core count to get the Task-Manager-style 0..100
 * percent used by the rest of the contract.
 *
 * @param {unknown} raw
 * @param {string|null} [transportError]
 * @returns {object} frozen `processes` section shape
 */
function mapProcesses(raw, transportError) {
  const label = 'processes.ps1';
  const data = isObject(raw) ? raw : {};
  const errors = collectErrors(raw, transportError, label);
  const cores = num(data.logicalCores) ?? safeCpuCount();
  const totalMemoryBytes = num(data.totalMemoryBytes) ?? (() => {
    try {
      return os.totalmem();
    } catch {
      return null;
    }
  })();

  const table = asArray(data.processes)
    .filter(isObject)
    .map((process) => {
      const pid = num(process.pid);
      const workingSetBytes = num(process.workingSetBytes) ?? num(process.privateWorkingSetBytes) ?? num(process.rssBytes);
      const memPercent =
        num(process.memPercent) ??
        (workingSetBytes !== null && totalMemoryBytes !== null && totalMemoryBytes > 0
          ? round(clamp((workingSetBytes / totalMemoryBytes) * 100, 0, 100), 1)
          : null);
      const creationDateMs = num(process.creationDateMs);
      let elapsed = num(process.elapsed);
      if (elapsed === null && creationDateMs !== null) {
        const seconds = Math.floor((Date.now() - creationDateMs) / 1000);
        elapsed = seconds >= 0 ? seconds : null;
      }
      return {
        pid: pid ?? 0,
        ppid: num(process.ppid),
        user: str(process.user),
        cpu: round(clamp((num(process.cpuPercent) ?? 0) / Math.max(1, cores || 1), 0, 100), 1) ?? 0,
        memPercent: memPercent ?? 0,
        rssBytes: workingSetBytes,
        state: str(process.state),
        elapsed,
        command: str(process.command) ?? str(process.name) ?? '',
      };
    })
    .filter((process) => process.pid > 0);

  const sorted = [...table].sort((left, right) => {
    if (right.cpu !== left.cpu) return right.cpu - left.cpu;
    return right.memPercent - left.memPercent;
  });
  const list = sorted.slice(0, 200);

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const process of table) {
    const user = process.user ?? 'unknown';
    counts.set(user, (counts.get(user) ?? 0) + 1);
  }
  const byUser = [...counts.entries()]
    .map(([user, count]) => ({ user, count }))
    .sort((left, right) => right.count - left.count);

  return {
    total: num(data.total) ?? table.length,
    list,
    byUser,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Section builders (PowerShell → cached contract shapes)                     */
/* -------------------------------------------------------------------------- */

/**
 * Run a collection script and map its JSON document.
 * @param {string} scriptName
 * @param {(raw: any, error?: string|null) => object} mapper
 * @returns {Promise<object>}
 */
async function collectWith(scriptName, mapper) {
  const result = await runScript(scriptName);
  if (!result.ok) return mapper(null, result.error);
  try {
    return mapper(result.data);
  } catch (error) {
    // A mapper bug must still yield a contract-shaped, failing section.
    return mapper(null, `mapper failure: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function buildHardware() {
  return collectWith('hardware.ps1', mapHardware);
}

async function buildSystem() {
  return collectWith('system.ps1', mapSystem);
}

async function buildSoftware() {
  return collectWith('software.ps1', mapSoftware);
}

async function buildNetwork() {
  return collectWith('network.ps1', mapNetwork);
}

async function buildSecurity() {
  return collectWith('security.ps1', mapSecurity);
}

async function buildProcesses() {
  return collectWith('processes.ps1', mapProcesses);
}

const BUILDERS = {
  hardware: buildHardware,
  system: buildSystem,
  software: buildSoftware,
  network: buildNetwork,
  security: buildSecurity,
  processes: buildProcesses,
};

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

/** @type {object|null} */
let lastMetrics = null;
let lastMetricsAt = 0;
/** @type {Promise<object>|null} */
let metricsPending = null;

/**
 * Best-effort zeroed metrics object (the tick path must never throw).
 * @returns {object}
 */
function fallbackMetrics() {
  return {
    ts: Date.now(),
    hostname: safeHostname() ?? 'unknown',
    osVersion: null,
    uptimeSec: (() => {
      try {
        return Math.floor(os.uptime());
      } catch {
        return null;
      }
    })(),
    cpu: {
      model: null,
      usagePercent: 0,
      perCore: [],
      loadAvg: [],
      logicalCores: safeCpuCount(),
      physicalCores: safeCpuCount(),
    },
    memory: {
      totalBytes: (() => {
        try {
          return os.totalmem();
        } catch {
          return null;
        }
      })(),
      usedBytes: null,
      appBytes: null,
      wiredBytes: null,
      compressedBytes: null,
      cachedBytes: null,
      freeBytes: (() => {
        try {
          return os.freemem();
        } catch {
          return null;
        }
      })(),
      swapTotalBytes: null,
      swapUsedBytes: null,
      pressure: null,
    },
    disk: { totalBytes: null, usedBytes: null, freeBytes: null, readBytesPerSec: 0, writeBytesPerSec: 0 },
    network: {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      totalRxBytes: null,
      totalTxBytes: null,
      wifi: null,
      primaryIpv4: [],
      defaultInterface: null,
    },
    battery: null,
    thermal: emptyThermal(),
    processes: { total: 0, top: [] },
  };
}

/**
 * Build one metrics snapshot: a single PowerShell invocation (OS-specific
 * facts) in parallel with the cheap `os.cpus()` CPU delta sample.
 * @returns {Promise<object>}
 */
async function buildMetrics() {
  const [result, usage] = await Promise.all([runScript('metrics.ps1'), cpuUsage()]);
  const ts = Date.now();
  if (!result.ok) {
    // Keep the last good sample for continuity (documented); otherwise fall
    // back to the Node-only facts.
    if (lastMetrics !== null) return { ...lastMetrics, ts };
    return jsonSafe(mapMetrics(null, { cpu: usage, now: ts }));
  }
  const data = isObject(result.data) ? result.data : {};
  const rates = {
    network: rateOf('network', countersOf(data.network?.counters), ts),
    disk: rateOf('disk', countersOf(data.diskIo), ts),
  };
  return jsonSafe(mapMetrics(data, { cpu: usage, rates, now: ts }));
}

/* -------------------------------------------------------------------------- */
/* Public collectors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Start slow section collection in the background (fire-and-forget). Two small
 * waves keep the number of simultaneous PowerShell processes low; metrics are
 * primed last so the first UI poll still gets a fresh sample.
 * @returns {void}
 */
export function warmup() {
  const prime = async () => {
    for (const group of [['system', 'network', 'processes'], ['hardware', 'security', 'software']]) {
      await Promise.all(group.map((section) => collectSection(section).catch(() => {})));
    }
    await collectMetrics().catch(() => {});
  };
  Promise.resolve()
    .then(prime)
    .catch(() => {});
}

/**
 * One metrics snapshot for the 2500 ms UI poll. Never throws.
 * @returns {Promise<object>}
 */
export async function collectMetrics() {
  const now = Date.now();
  if (lastMetrics !== null && now - lastMetricsAt < METRICS_TTL) return lastMetrics;
  if (metricsPending !== null) return metricsPending;
  const task = (async () => {
    try {
      const value = await buildMetrics();
      if (value && typeof value === 'object') {
        lastMetrics = value;
        lastMetricsAt = Date.now();
        return value;
      }
      return fallbackMetrics();
    } catch {
      return fallbackMetrics();
    }
  })().finally(() => {
    if (metricsPending === task) metricsPending = null;
  });
  metricsPending = task;
  return task;
}

/**
 * Build (or serve from cache) one section.
 *
 * Unknown section names reject; every PowerShell/data failure is captured in
 * the returned section's `errors[]` instead of throwing.
 *
 * @param {'hardware'|'system'|'software'|'network'|'security'|'processes'} section
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function collectSection(section, options = {}) {
  if (!SECTIONS.includes(section)) {
    throw new Error(`Unknown section: ${String(section)}`);
  }
  const fresh = options?.fresh === true;
  const ttl = SECTION_TTL[section] ?? 30_000;
  const now = Date.now();
  const cached = sectionCache.get(section);
  if (!fresh && cached && now - cached.at < ttl) return cached.value;
  const pending = sectionInflight.get(section);
  if (pending) return pending;

  const builder = BUILDERS[section];
  const task = (async () => {
    let value;
    try {
      value = await builder();
    } catch (error) {
      value = { errors: [shortErr(error instanceof Error ? error.message : error)] };
    }
    const safe = jsonSafe(value);
    sectionCache.set(section, { value: safe, at: Date.now() });
    return safe;
  })().finally(() => {
    if (sectionInflight.get(section) === task) sectionInflight.delete(section);
  });

  sectionInflight.set(section, task);
  return task;
}

/**
 * Full inventory for the panel's initial load and the agent tool.
 * @param {{sections?: string[], fresh?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function collectInventory(options = {}) {
  const requested = Array.isArray(options?.sections)
    ? SECTIONS.filter((section) => options.sections.includes(section))
    : [...SECTIONS];
  const fresh = options?.fresh === true;
  const errors = [];

  const [metrics, ...sectionValues] = await Promise.all([
    collectMetrics(),
    ...requested.map((section) => collectSection(section, { fresh })),
  ]);
  /** @type {Record<string, object>} */
  const sections = {};
  requested.forEach((section, index) => {
    sections[section] = sectionValues[index];
  });
  if (!metrics || typeof metrics !== 'object') errors.push('metrics unavailable');

  let catalog = [];
  let history = [];
  try {
    catalog = asArray(actionCatalog());
  } catch (error) {
    errors.push(`action catalog: ${shortErr(error instanceof Error ? error.message : error)}`);
  }
  try {
    history = asArray(actionHistory());
  } catch (error) {
    errors.push(`action history: ${shortErr(error instanceof Error ? error.message : error)}`);
  }

  return jsonSafe({
    generatedAt: Date.now(),
    platform: PLATFORM,
    hostname: safeHostname() ?? 'unknown',
    metrics,
    sections,
    actions: { catalog, history },
    errors,
  });
}

/**
 * Drop cached section data (one section or all of them).
 * `clearCache('metrics')` drops the fast-metrics cache as well.
 * @param {string} [section]
 * @returns {void}
 */
export function clearCache(section) {
  if (section === undefined || section === null || section === '') {
    sectionCache.clear();
    lastMetrics = null;
    lastMetricsAt = 0;
    return;
  }
  if (section === 'metrics') {
    lastMetrics = null;
    lastMetricsAt = 0;
    return;
  }
  sectionCache.delete(String(section));
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reset all module-level state (caches, deltas, metrics) and restore the real
 * PowerShell runner. Intended for the offline verification harness only.
 * @returns {void}
 */
function resetInternalState() {
  sectionCache.clear();
  sectionInflight.clear();
  rateState.clear();
  cpuSnapshot = null;
  lastCpuUsage = { usagePercent: 0, perCore: [] };
  lastMetrics = null;
  lastMetricsAt = 0;
  metricsPending = null;
  scriptRunner = defaultRunner;
}

/**
 * Stable pure helpers used by `scripts/verify-windows.mjs` and the offline
 * fixture harness. `setRunner` is the optional test seam for the PowerShell
 * bridge: it makes the caching/warmup logic testable on any platform.
 */
export const __test = {
  asArray,
  mapMetrics,
  mapHardware,
  mapSystem,
  mapSoftware,
  mapNetwork,
  mapSecurity,
  mapProcesses,
  cpuUsage,
  SECTION_TTL,
  setRunner(fn) {
    scriptRunner = typeof fn === 'function' ? fn : defaultRunner;
  },
  resetRunner() {
    scriptRunner = defaultRunner;
  },
  reset() {
    resetInternalState();
  },
};
