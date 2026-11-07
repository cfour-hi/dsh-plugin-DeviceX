/**
 * Device X — host-side data collectors.
 *
 * Plain Node ESM (runs inside the DSH Host process). No harness imports: only
 * `node:*` and one sibling module (`./actions.js`, for the action catalog that
 * belongs to the inventory payload).
 *
 * Rules honoured here:
 *  - every macOS command goes through `execFile` (argv only), never a shell;
 *  - a failed command yields null/empty values plus a non-fatal string in the
 *    section's `errors[]`; collectors never throw (unknown section names are
 *    the one deliberate exception);
 *  - everything returned is JSON-safe: no `undefined`, no NaN/Infinity, no
 *    circular references;
 *  - slow sections are cached with TTLs and can be warmed in the background;
 *  - `collectMetrics()` is a fast poll path (<250 ms) built from cheap parallel
 *    commands plus deltas against the previous poll.
 *
 * @module @cfour-hi/dsh-devicex/host/collector
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { actionCatalog, actionHistory } from './actions-darwin.js';
import { lines, run, runJson, sleep } from './proc.js';

/** Host platform (`darwin` on the target machine). */
export const PLATFORM = process.platform;

/** Frozen section identifiers, in UI order. */
export const SECTIONS = ['hardware', 'system', 'software', 'network', 'security', 'processes'];

/* -------------------------------------------------------------------------- */
/* Command paths (absolute, so a minimal Host PATH cannot break collection)    */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROFILER = '/usr/sbin/system_profiler';
const SYSCTL = '/usr/sbin/sysctl';
const SW_VERS = '/usr/bin/sw_vers';
const UNAME = '/usr/bin/uname';
const SCUTIL = '/usr/sbin/scutil';
const IOREG = '/usr/sbin/ioreg';
const VM_STAT = '/usr/bin/vm_stat';
const PMSET = '/usr/bin/pmset';
const IF_CONFIG = '/sbin/ifconfig';
const ROUTE = '/sbin/route';
const NETSTAT = '/usr/sbin/netstat';
const PS = '/bin/ps';
const DF = '/bin/df';
const NETWORKSETUP = '/usr/sbin/networksetup';
const LSOF = '/usr/sbin/lsof';
const DSCL = '/usr/bin/dscl';
const LAUNCHCTL = '/bin/launchctl';
const OSASCRIPT = '/usr/bin/osascript';
const DEFAULTS = '/usr/bin/defaults';
const PLUTIL = '/usr/bin/plutil';
const MDLS = '/usr/bin/mdls';
const FD_SETUP = '/usr/bin/fdesetup';
const CSRUTIL = '/usr/bin/csrutil';
const SPCTL = '/usr/sbin/spctl';
const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';
const SYSTEMSETUP = '/usr/sbin/systemsetup';
const SQLITE3 = '/usr/bin/sqlite3';
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];

/**
 * Environment for commands whose text output can contain process names:
 * macOS `ps` meta-escapes non-ASCII under the C locale, so these run with a
 * UTF-8 locale. Everything else keeps the deterministic C locale.
 * @returns {NodeJS.ProcessEnv}
 */
function utf8Env() {
  return { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };
}

const HARDWARE_PROFILER_TYPES = [
  'SPHardwareDataType',
  'SPMemoryDataType',
  'SPStorageDataType',
  'SPUSBDataType',
  'SPBluetoothDataType',
  'SPAudioDataType',
  'SPCameraDataType',
  'SPDisplaysDataType',
  'SPPowerDataType',
  'SPExtensionsDataType',
];

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

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
 * Clamp a number into [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * First numeric value among the given keys of an object.
 * @param {Record<string, unknown>} object
 * @param {string[]} keys
 * @returns {number|null}
 */
function firstNum(object, keys) {
  if (!object || typeof object !== 'object') return null;
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
  if (!object || typeof object !== 'object') return null;
  for (const key of keys) {
    const parsed = str(object[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Convert a human byte string ("16 GB", "500.3 GB (500277792768 Bytes)") to
 * bytes. Returns null when nothing parseable is found.
 * @param {unknown} text
 * @returns {number|null}
 */
function bytesFromText(text) {
  const source = str(text);
  if (!source) return null;
  // Prefer an explicit exact "(N Bytes)" figure when present.
  const exact = /\((\d+)\s*bytes?\)/i.exec(source);
  if (exact) return Number(exact[1]);
  const match = /([\d.]+)\s*(bytes?|kb|mb|gb|tb)/i.exec(source);
  if (!match) {
    const plain = /^(\d+)$/.exec(source);
    return plain ? Number(plain[1]) : null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const factor =
    unit === 'tb' ? 1024 ** 4 : unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.round(value * factor);
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

/* -------------------------------------------------------------------------- */
/* Caching                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-section TTLs (ms). */
const SECTION_TTL = {
  hardware: 300_000,
  system: 60_000,
  software: 300_000,
  network: 15_000,
  security: 120_000,
  processes: 4_000,
};

/** @type {Map<string, {value: any, at: number}>} */
const sectionCache = new Map();
/** @type {Map<string, Promise<any>>} */
const sectionInflight = new Map();

/** General async memo store: `{value, at, pending}`. @type {Map<string, {value:any, at:number, pending:Promise<any>|null}>} */
const memoStore = new Map();

/**
 * Async memo with TTL and in-flight de-duplication. On failure the previous
 * value (or null) is returned and the timestamp is refreshed.
 *
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<any>} loader
 * @returns {Promise<any>}
 */
function memo(key, ttl, loader) {
  const now = Date.now();
  let record = memoStore.get(key);
  if (!record) {
    record = { value: null, at: 0, pending: null };
    memoStore.set(key, record);
  }
  if (record.pending) return record.pending;
  if (now - record.at < ttl) return Promise.resolve(record.value);
  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      record.value = value;
      return value;
    })
    .catch(() => record.value)
    .finally(() => {
      record.at = Date.now();
      record.pending = null;
    });
  record.pending = pending;
  return pending;
}

/**
 * Non-blocking cache: returns the last value immediately and refreshes it in
 * the background when stale. Used by `collectMetrics()` for slow samples
 * (Wi-Fi) so a poll never waits on `system_profiler`.
 *
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<any>} loader
 * @returns {any}
 */
function fastValue(key, ttl, loader) {
  const now = Date.now();
  let record = memoStore.get(key);
  if (!record) {
    record = { value: null, at: 0, pending: null };
    memoStore.set(key, record);
  }
  if (now - record.at < ttl) return record.value;
  if (!record.pending) {
    record.pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        record.value = value;
        return value;
      })
      .catch(() => record.value)
      .finally(() => {
        record.at = Date.now();
        record.pending = null;
      });
  }
  return record.value;
}

/* -------------------------------------------------------------------------- */
/* Rate tracking (metrics deltas)                                             */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, {at: number, read: number, write: number}>} */
const rateState = new Map();

/**
 * Have two cumulative counters at different times → bytes/second.
 * @param {string} key
 * @param {{read: number, write: number}} current
 * @param {number} at
 * @returns {{readBytesPerSec: number, writeBytesPerSec: number}}
 */
function rateOf(key, current, at) {
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

/* -------------------------------------------------------------------------- */
/* Parsers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {{pageSize: number, free: number, active: number, inactive: number,
 *   speculative: number, wired: number, purgeable: number, fileBacked: number,
 *   anonymous: number, compressed: number}} VmStat
 */

/**
 * Parse `vm_stat` into page counts.
 * @param {string} text
 * @returns {VmStat}
 */
function parseVmStat(text) {
  const result = {
    pageSize: 4096,
    free: 0,
    active: 0,
    inactive: 0,
    speculative: 0,
    wired: 0,
    purgeable: 0,
    fileBacked: 0,
    anonymous: 0,
    compressed: 0,
  };
  const pageSize = /page size of (\d+) bytes/.exec(text);
  if (pageSize) result.pageSize = Number(pageSize[1]);
  const read = (label, key) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped}:\\s+(\\d+)\\.`, 'm').exec(text);
    if (match) result[key] = Number(match[1]);
  };
  read('Pages free', 'free');
  read('Pages active', 'active');
  read('Pages inactive', 'inactive');
  read('Pages speculative', 'speculative');
  read('Pages wired down', 'wired');
  read('Pages purgeable', 'purgeable');
  read('File-backed pages', 'fileBacked');
  read('Anonymous pages', 'anonymous');
  read('Pages occupied by compressor', 'compressed');
  return result;
}

/**
 * Parse `sysctl -n vm.swapusage` ("total = 12288.00M used = ...").
 * @param {string} text
 * @returns {{total: number, used: number}}
 */
function parseSwap(text) {
  const total = /total\s*=\s*([\d.]+)([MG])/.exec(text);
  const used = /used\s*=\s*([\d.]+)([MG])/.exec(text);
  const toBytes = (match) => {
    if (!match) return 0;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * (match[2] === 'G' ? 1024 ** 3 : 1024 ** 2));
  };
  return { total: toBytes(total), used: toBytes(used) };
}

/**
 * Parse `pmset -g batt`.
 * @param {string} text
 * @returns {{present: boolean, percent: number|null, charging: boolean,
 *   plugged: boolean, powerSource: string|null, timeRemainingMin: number|null,
 *   batteryState: string|null}}
 */
function parsePmsetBattery(text) {
  const sourceMatch = /Now drawing from '([^']+)'/.exec(text);
  const line = /^-\s*InternalBattery-\d+.*$/m.exec(text);
  const result = {
    present: Boolean(line),
    percent: null,
    charging: false,
    plugged: false,
    powerSource: sourceMatch ? sourceMatch[1] : null,
    timeRemainingMin: null,
    batteryState: null,
  };
  if (!line) return result;
  const percent = /(\d+)%/.exec(line[0]);
  if (percent) result.percent = Number(percent[1]);
  const state = /;\s*([^;]+?)\s*;/.exec(line[0]);
  if (state) result.batteryState = state[1].trim();
  result.charging = /charging/.test(result.batteryState ?? '') && !/charged/.test(result.batteryState ?? '');
  result.plugged = (result.powerSource ?? '').toLowerCase().includes('ac');
  const remaining = /(\d+):(\d{2})\s*remaining/.exec(line[0]);
  if (remaining) {
    const minutes = Number(remaining[1]) * 60 + Number(remaining[2]);
    result.timeRemainingMin = minutes > 0 && minutes < 6000 ? minutes : null;
  }
  if (/charged/.test(result.batteryState ?? '')) result.timeRemainingMin = null;
  return result;
}

/**
 * Parse the interesting top-level keys of `ioreg -rn AppleSmartBattery`.
 * Only line-anchored matches are used so the nested `BatteryData` dictionary
 * cannot shadow the top-level figures.
 * @param {string} text
 * @returns {{present: boolean, currentCapacity: number|null,
 *   maxCapacity: number|null, rawMaxCapacity: number|null,
 *   designCapacity: number|null, temperatureC: number|null,
 *   cycleCount: number|null, charging: boolean|null, external: boolean|null,
 *   timeRemaining: number|null}}
 */
function parseIoregBattery(text) {
  const read = (key) => {
    const match = new RegExp(`^\\s+"${key}" = (\\d+)`, 'm').exec(text);
    return match ? Number(match[1]) : null;
  };
  const readBool = (key) => {
    const match = new RegExp(`^\\s+"${key}" = (Yes|No|true|false)`, 'm').exec(text);
    if (!match) return null;
    return match[1] === 'Yes' || match[1] === 'true';
  };
  const temperature = read('Temperature');
  const installed = readBool('BatteryInstalled');
  return {
    present: installed === true,
    currentCapacity: read('CurrentCapacity'),
    maxCapacity: read('MaxCapacity'),
    rawMaxCapacity: read('AppleRawMaxCapacity'),
    designCapacity: read('DesignCapacity'),
    temperatureC: temperature === null ? null : round(temperature / 100, 1),
    cycleCount: read('CycleCount'),
    charging: readBool('IsCharging'),
    external: readBool('ExternalConnected'),
    timeRemaining: read('TimeRemaining'),
  };
}

/**
 * Compute battery health percentage from raw max / design capacity.
 * @param {ReturnType<typeof parseIoregBattery>} battery
 * @returns {number|null}
 */
function batteryHealth(battery) {
  if (battery.rawMaxCapacity === null || battery.designCapacity === null || battery.designCapacity <= 0) return null;
  return clamp(Math.round((battery.rawMaxCapacity / battery.designCapacity) * 100), 0, 100);
}

/**
 * Parse cumulative disk byte counters from `ioreg -c IOBlockStorageDriver -r -w0`.
 * @param {string} text
 * @returns {{read: number, write: number}}
 */
function parseIoregDisk(text) {
  let read = 0;
  let write = 0;
  const readMatches = text.matchAll(/"Bytes \(Read\)"=(\d+)/g);
  for (const match of readMatches) read += Number(match[1]) || 0;
  const writeMatches = text.matchAll(/"Bytes \(Write\)"=(\d+)/g);
  for (const match of writeMatches) write += Number(match[1]) || 0;
  return { read, write };
}

/**
 * Sum cumulative network bytes from `netstat -ib` link rows (loopback excluded).
 * @param {string} text
 * @returns {{read: number, write: number}}
 */
function parseNetstatBytes(text) {
  let read = 0;
  let write = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim() || /^Name\s/.test(line)) continue;
    const match = /^(\S+)\s+(\d+)\s+(<Link#\d+>)\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name === 'lo0') continue;
    let rest = match[4].trim().split(/\s+/);
    if (rest.length && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(rest[0])) rest = rest.slice(1);
    if (rest.length < 7) continue;
    const ibytes = Number(rest[2]);
    const obytes = Number(rest[5]);
    if (Number.isFinite(ibytes)) read += ibytes;
    if (Number.isFinite(obytes)) write += obytes;
  }
  return { read, write };
}

/**
 * Parse `df -kP <path>` for one filesystem.
 * @param {string} text
 * @returns {{totalBytes: number, usedBytes: number, freeBytes: number}|null}
 */
function parseDf(text) {
  const rows = lines(text);
  if (rows.length < 2) return null;
  const parts = rows[rows.length - 1].trim().split(/\s+/);
  if (parts.length < 4) return null;
  const totalKb = Number(parts[1]);
  const availKb = Number(parts[3]);
  if (!Number.isFinite(totalKb) || !Number.isFinite(availKb)) return null;
  const totalBytes = totalKb * 1024;
  const freeBytes = availKb * 1024;
  return { totalBytes, usedBytes: Math.max(0, totalBytes - freeBytes), freeBytes };
}

/**
 * @typedef {{name: string, up: boolean, mtu: number, mac: string|null,
 *   ipv4: string[], ipv6: string[], status: string|null}} Iface
 */

/**
 * Parse `ifconfig -a`.
 * @param {string} text
 * @returns {Iface[]}
 */
function parseIfconfig(text) {
  /** @type {Iface[]} */
  const result = [];
  /** @type {Iface|null} */
  let current = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    if (!/^\s/.test(rawLine)) {
      const header = /^([A-Za-z0-9_.-]+):\s+flags=([0-9a-f]+)(?:<([^>]*)>)?\s+mtu\s+(\d+)/.exec(rawLine);
      if (header) {
        current = {
          name: header[1],
          up: (header[3] ?? '').split(',').includes('UP'),
          mtu: Number(header[4]),
          mac: null,
          ipv4: [],
          ipv6: [],
          status: null,
        };
        result.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const line = rawLine.trim();
    const ipv4 = /^inet\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+netmask\s+\S+)?/.exec(line);
    if (ipv4) {
      current.ipv4.push(ipv4[1]);
      continue;
    }
    const ipv6 = /^inet6\s+([0-9a-fA-F:]+)(?:%[A-Za-z0-9]+)?(?:\s+prefixlen\s+\d+)?/.exec(line);
    if (ipv6) {
      const address = ipv6[1];
      if (address !== '::1') current.ipv6.push(address);
      continue;
    }
    const mac = /^ether\s+([0-9a-fA-F:]{17})/.exec(line);
    if (mac) {
      current.mac = mac[1].toLowerCase();
      continue;
    }
    const status = /^status:\s+(\S+)/.exec(line);
    if (status) current.status = status[1];
  }
  return result;
}

/**
 * Parse `networksetup -listallhardwareports` into device → hardware port name.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseHardwarePorts(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  let port = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const portMatch = /^Hardware Port:\s*(.+)$/.exec(line);
    if (portMatch) {
      port = portMatch[1].trim();
      continue;
    }
    const deviceMatch = /^Device:\s*(\S+)$/.exec(line);
    if (deviceMatch && port) {
      map.set(deviceMatch[1], port);
    }
  }
  return map;
}

/**
 * Classify an interface for the network section.
 * @param {Iface} iface
 * @param {Map<string, string>} hardwarePorts
 * @returns {'wifi'|'ethernet'|'loopback'|'bridge'|'other'}
 */
function interfaceType(iface, hardwarePorts) {
  if (iface.name === 'lo0' || iface.name.startsWith('lo')) return 'loopback';
  if (iface.name.startsWith('bridge')) return 'bridge';
  const port = hardwarePorts.get(iface.name);
  if (port) {
    if (/wi-?fi|airport/i.test(port)) return 'wifi';
    if (/ethernet|thunderbolt|lan|usb/i.test(port)) return 'ethernet';
  }
  if (/^en\d+$/.test(iface.name)) return 'ethernet';
  return 'other';
}

/**
 * Parse `route -n get default`.
 * @param {string} text
 * @returns {{gateway: string|null, interface: string|null}|null}
 */
function parseDefaultRoute(text) {
  const gateway = /gateway:\s*(\S+)/.exec(text);
  const iface = /interface:\s*(\S+)/.exec(text);
  if (!gateway && !iface) return null;
  return { gateway: gateway ? gateway[1] : null, interface: iface ? iface[1] : null };
}

/**
 * Parse `scutil --dns`.
 * @param {string} text
 * @returns {{servers: string[], searchDomains: string[]}}
 */
function parseDns(text) {
  /** @type {string[]} */
  const servers = [];
  /** @type {string[]} */
  const searchDomains = [];
  const serverMatches = String(text ?? '').matchAll(/nameserver\[\d+]\s*:\s*(\S+)/g);
  for (const match of serverMatches) {
    if (!servers.includes(match[1])) servers.push(match[1]);
  }
  const domainMatches = String(text ?? '').matchAll(/search domain\[\d+]\s*:\s*(\S+)/g);
  for (const match of domainMatches) {
    if (!searchDomains.includes(match[1])) searchDomains.push(match[1]);
  }
  return { servers: servers.slice(0, 8), searchDomains: searchDomains.slice(0, 8) };
}

/**
 * Parse `scutil --proxy`'s dictionary dump.
 * @param {string} text
 * @returns {Record<string, string|number>}
 */
function parseScutilDictionary(text) {
  /** @type {Record<string, string|number>} */
  const result = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*?)\s*$/.exec(rawLine);
    if (!match) continue;
    const value = match[2];
    if (value === '') continue;
    result[match[1]] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return result;
}

/**
 * Turn raw scutil proxy keys into the contract's three proxy slots.
 * @param {Record<string, string|number>} config
 * @returns {{http: string|null, https: string|null, socks: string|null}}
 */
function parseProxy(config) {
  const slot = (enableKey, hostKey, portKey) => {
    const enabled = Number(config[enableKey] ?? 0) === 1;
    const host = str(config[hostKey]);
    if (!enabled || !host) return null;
    const port = num(config[portKey]);
    return port ? `${host}:${port}` : host;
  };
  return {
    http: slot('HTTPEnable', 'HTTPProxy', 'HTTPPort'),
    https: slot('HTTPSEnable', 'HTTPSProxy', 'HTTPSPort'),
    socks: slot('SOCKSEnable', 'SOCKSProxy', 'SOCKSPort'),
  };
}

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN` rows.
 * @param {string} text
 * @returns {Array<{proto: string, address: string, port: number,
 *   pid: number|null, process: string}>}
 */
function parseLsofListeners(text) {
  /** @type {Array<{proto: string, address: string, port: number, pid: number|null, process: string}>} */
  const result = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^COMMAND\s/.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const process = parts[0].replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    const pid = num(parts[1]);
    const nameField = parts[8];
    const at = nameField.lastIndexOf(':');
    if (at === -1) continue;
    const address = nameField.slice(0, at).replace(/^\[/, '').replace(/\]$/, '');
    const port = num(nameField.slice(at + 1));
    if (port === null) continue;
    result.push({ proto: 'tcp', address: address || '*', port, pid, process });
  }
  return result;
}

/**
 * Parse `ps -axo pid=,ppid=,user=,%cpu=,%mem=,rss=,state=,etime=,command=`.
 * @param {string} text
 * @returns {Array<{pid: number, ppid: number|null, user: string|null,
 *   cpu: number, memPercent: number, rssBytes: number|null, state: string|null,
 *   elapsed: number|null, command: string}>}
 */
function parsePs(text) {
  /** @type {ReturnType<typeof parsePs>} */
  const result = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const rss = Number(match[6]);
    result.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      user: match[3] || null,
      cpu: round(Number(match[4]), 1) ?? 0,
      memPercent: round(Number(match[5]), 1) ?? 0,
      rssBytes: Number.isFinite(rss) ? rss * 1024 : null,
      state: match[7] || null,
      elapsed: parseElapsed(match[8]),
      command: match[9] ? match[9].trim() : '',
    });
  }
  return result;
}

/**
 * Convert a `ps` ELAPSED field ("08-07:05:32", "16:01", "02:03") to seconds.
 * @param {string} value
 * @returns {number|null}
 */
function parseElapsed(value) {
  if (!value) return null;
  let days = 0;
  let rest = value;
  const dayMatch = /^(\d+)-(.+)$/.exec(value);
  if (dayMatch) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2];
  }
  const parts = rest.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) [hours, minutes, seconds] = parts;
  else if (parts.length === 2) [minutes, seconds] = parts;
  else [seconds] = parts;
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/**
 * Parse `launchctl list` into label → {pid, status}.
 * @param {string} text
 * @returns {Map<string, {pid: number|null, status: number|null}>}
 */
function parseLaunchctlList(text) {
  /** @type {Map<string, {pid: number|null, status: number|null}>} */
  const map = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const parts = rawLine.trim().split('\t');
    if (parts.length < 3) continue;
    const label = parts.slice(2).join('\t').trim();
    if (!label || label === 'Label') continue;
    map.set(label, { pid: num(parts[0]), status: num(parts[1]) });
  }
  return map;
}

/**
 * Decode the five XML entities needed for plist strings.
 * @param {string} value
 * @returns {string}
 */
function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extract Label/Program/ProgramArguments/Disabled from an XML plist.
 * @param {string} text
 * @returns {{Label: string|null, Program: string|null,
 *   ProgramArguments: string[], Disabled: boolean|null}}
 */
function parseXmlPlist(text) {
  const value = (key) => {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(text);
    return match ? decodeXml(match[1]).trim() : null;
  };
  const bool = (key) => {
    const match = new RegExp(`<key>${key}</key>\\s*<(true|false)\\s*/>`).exec(text);
    return match ? match[1] === 'true' : null;
  };
  let programArguments = [];
  const argsBlock = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
  if (argsBlock) {
    programArguments = [...argsBlock[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) =>
      decodeXml(match[1]),
    );
  }
  return { Label: value('Label'), Program: value('Program'), ProgramArguments: programArguments, Disabled: bool('Disabled') };
}

/**
 * Read and parse one launchd plist (XML, JSON or binary).
 * @param {string} file
 * @returns {Promise<{Label: string|null, Program: string|null,
 *   ProgramArguments: string[], Disabled: boolean|null}|null>}
 */
async function parsePlistFile(file) {
  const buffer = await fsp.readFile(file);
  if (buffer.subarray(0, 6).toString('latin1') === 'bplist') {
    const converted = await runJson(PLUTIL, ['-convert', 'json', '-o', '-', file], { timeout: 5_000 });
    if (!converted.ok || !converted.data || typeof converted.data !== 'object') return null;
    const data = converted.data;
    return {
      Label: str(data.Label),
      Program: str(data.Program),
      ProgramArguments: Array.isArray(data.ProgramArguments) ? data.ProgramArguments.map((item) => String(item)) : [],
      Disabled: typeof data.Disabled === 'boolean' ? data.Disabled : null,
    };
  }
  const text = buffer.toString('utf8');
  if (text.trim().startsWith('{')) {
    try {
      const data = JSON.parse(text);
      return {
        Label: str(data.Label),
        Program: str(data.Program),
        ProgramArguments: Array.isArray(data.ProgramArguments) ? data.ProgramArguments.map((item) => String(item)) : [],
        Disabled: typeof data.Disabled === 'boolean' ? data.Disabled : null,
      };
    } catch {
      return null;
    }
  }
  return parseXmlPlist(text);
}

/**
 * Parse the first `system_profiler -json SPAirPortDataType` network info.
 * @param {any} spData parsed system profiler JSON
 * @returns {{ssid: string|null, bssid: string|null, rssi: number|null,
 *   noise: number|null, channel: number|null, security: string|null,
 *   txRateMbps: number|null}|null}
 */
function parseAirportWifi(spData) {
  const interfaces = spData?.SPAirPortDataType?.[0]?.spairport_airport_interfaces;
  if (!Array.isArray(interfaces)) return null;
  for (const iface of interfaces) {
    const info = iface?.spairport_current_network_information;
    if (!info || typeof info !== 'object') continue;
    const channelText = str(info.spairport_network_channel) ?? '';
    const channelMatch = /(\d+)/.exec(channelText);
    const rate = num(info.spairport_network_rate);
    return {
      ssid: str(info._name) ?? str(info.spairport_network_ssid),
      bssid: firstStr(info, ['spairport_network_bssid', 'spairport_network_BSSID']),
      rssi: firstNum(info, ['spairport_network_rssi', 'spairport_rssi']),
      noise: firstNum(info, ['spairport_network_noise', 'spairport_noise']),
      channel: channelMatch ? Number(channelMatch[1]) : null,
      security: firstStr(info, ['spairport_security_mode', 'spairport_network_security']),
      txRateMbps: rate,
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Shared command-backed facts                                                */
/* -------------------------------------------------------------------------- */

/**
 * Static OS/hardware facts used by metrics and the system section.
 * @returns {Promise<{hostname: string, os: {name: string, version: string|null,
 *   build: string|null, kernel: string|null, arch: string, release: string|null},
 *   model: string|null, modelId: string|null, chip: string|null,
 *   serial: string|null, hardwareUuid: string|null, physicalCores: number|null,
 *   logicalCores: number, totalMemoryBytes: number, cpuModel: string|null}>}
 */
function staticFacts() {
  return memo('staticFacts', 300_000, async () => {
    const [swRes, unameRes, sysctlRes, hwRes] = await Promise.all([
      run(SW_VERS),
      run(UNAME, ['-a']),
      run(SYSCTL, ['-n', 'hw.physicalcpu', 'hw.logicalcpu', 'hw.memsize']),
      runJson(SYSTEM_PROFILER, ['-json', 'SPHardwareDataType'], { timeout: 20_000 }),
    ]);
    /** @type {Record<string, string>} */
    const sw = {};
    for (const line of lines(swRes.stdout)) {
      const match = /^([^:]+):\s*(.*)$/.exec(line);
      if (match) sw[match[1].trim()] = match[2].trim();
    }
    const unameText = unameRes.stdout.trim();
    const unameParts = unameText.split(/\s+/);
    const kernelRelease = unameParts[2] ?? null;
    const sysctlValues = lines(sysctlRes.stdout).map((line) => Number(line));
    const physicalCores = num(sysctlValues[0]);
    const logicalCores = num(sysctlValues[1]) ?? os.cpus().length;
    const totalMemoryBytes = num(sysctlValues[2]) ?? os.totalmem();
    const hw = hwRes.ok ? hwRes.data?.SPHardwareDataType?.[0] ?? null : null;
    const cpus = os.cpus();
    return {
      hostname: os.hostname(),
      os: {
        name: sw.ProductName ?? 'macOS',
        version: sw.ProductVersion ?? null,
        build: sw.BuildVersion ?? null,
        kernel: kernelRelease ? `Darwin ${kernelRelease}` : null,
        arch: process.arch,
        release: kernelRelease,
      },
      model: hw ? str(hw.machine_name) : null,
      modelId: hw ? str(hw.machine_model) : null,
      chip: hw ? str(hw.chip_type) : null,
      serial: hw ? str(hw.serial_number) : null,
      hardwareUuid: hw ? str(hw.platform_UUID) : null,
      physicalCores: physicalCores ?? cpus.length,
      logicalCores: logicalCores ?? cpus.length,
      totalMemoryBytes: totalMemoryBytes ?? os.totalmem(),
      cpuModel: cpus.length ? str(cpus[0].model) : null,
    };
  });
}

/**
 * Real (non-service) local users plus the admin membership set.
 * @returns {Promise<{users: Array<{name: string, uid: number, gid: number|null,
 *   fullName: string|null, home: string|null, shell: string|null,
 *   admin: boolean, isCurrent: boolean}>, adminNames: string[],
 *   currentName: string}>}
 */
function userFacts() {
  return memo('userFacts', 120_000, async () => {
    const currentName = os.userInfo().username;
    const [listRes, adminRes] = await Promise.all([
      run(DSCL, ['.', '-list', '/Users', 'UniqueID']),
      run(DSCL, ['.', '-read', '/Groups/admin', 'GroupMembership']),
    ]);
    /** @type {string[]} */
    const adminNames = [];
    const adminMatch = /GroupMembership:\s*(.*)/.exec(adminRes.stdout);
    if (adminMatch) {
      adminNames.push(...adminMatch[1].trim().split(/\s+/).filter(Boolean));
    }
    /** @type {Array<{name: string, uid: number}>} */
    const candidates = [];
    for (const line of lines(listRes.stdout)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const uid = Number(parts[1]);
      const name = parts[0];
      if (!Number.isFinite(uid) || uid < 500) continue;
      if (name.startsWith('_')) continue;
      candidates.push({ name, uid });
    }
    const users = await Promise.all(
      candidates.map(async (candidate) => {
        const detail = await run(DSCL, [
          '.',
          '-read',
          `/Users/${candidate.name}`,
          'RealName',
          'NFSHomeDirectory',
          'UserShell',
          'PrimaryGroupID',
        ]);
        /** @type {Record<string, string>} */
        const attributes = {};
        let pendingKey = null;
        for (const rawLine of String(detail.stdout ?? '').split(/\r?\n/)) {
          if (!rawLine.trim()) continue;
          const keyed = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(rawLine);
          if (keyed) {
            if (keyed[2].trim() !== '') {
              attributes[keyed[1]] = keyed[2].trim();
              pendingKey = null;
            } else {
              pendingKey = keyed[1];
            }
            continue;
          }
          if (pendingKey) {
            attributes[pendingKey] = rawLine.trim();
            pendingKey = null;
          }
        }
        return {
          name: candidate.name,
          uid: candidate.uid,
          gid: num(attributes.PrimaryGroupID),
          fullName: str(attributes.RealName),
          home: str(attributes.NFSHomeDirectory),
          shell: str(attributes.UserShell),
          admin: adminNames.includes(candidate.name),
          isCurrent: candidate.name === currentName,
        };
      }),
    );
    return { users, adminNames, currentName };
  });
}

/**
 * Cached `ifconfig -a` parse.
 * @returns {Promise<Iface[]>}
 */
function interfaces() {
  return memo('interfaces', 5_000, async () => {
    const result = await run(IF_CONFIG, ['-a']);
    return parseIfconfig(result.stdout);
  });
}

/**
 * Cached `route -n get default` parse.
 * @returns {Promise<{gateway: string|null, interface: string|null}|null>}
 */
function defaultRoute() {
  return memo('defaultRoute', 5_000, async () => {
    const result = await run(ROUTE, ['-n', 'get', 'default']);
    return parseDefaultRoute(result.stdout);
  });
}

/**
 * Cached `df` of the data volume.
 * @returns {Promise<{totalBytes: number, usedBytes: number, freeBytes: number}|null>}
 */
function diskUsage() {
  return memo('diskUsage', 5_000, async () => {
    let result = await run(DF, ['-kP', '/System/Volumes/Data']);
    if (!result.ok) result = await run(DF, ['-kP', '/']);
    return parseDf(result.stdout);
  });
}

/**
 * Cached process table (shared by metrics and the processes section).
 * @returns {Promise<ReturnType<typeof parsePs>>}
 */
function processTable() {
  return memo('processTable', 2_500, async () => {
    const result = await run(
      PS,
      ['-axo', 'pid=,ppid=,user=,%cpu=,%mem=,rss=,state=,etime=,command='],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, env: utf8Env() },
    );
    if (!result.ok) throw new Error(result.error ?? 'ps failed');
    return parsePs(result.stdout);
  });
}

/**
 * Cached Wi-Fi sample for the metrics poll (refreshed in the background).
 * @returns {{ssid: string|null, bssid: string|null, rssi: number|null,
 *   noise: number|null, channel: number|null, security: string|null,
 *   txRateMbps: number|null}|null}
 */
function wifiMetricSample() {
  return fastValue('wifiSample', 60_000, async () => {
    const result = await runJson(SYSTEM_PROFILER, ['-json', 'SPAirPortDataType'], { timeout: 20_000 });
    if (!result.ok) return null;
    return parseAirportWifi(result.data);
  });
}

/**
 * Humanise a system_profiler GPU vendor token.
 * @param {string|null} vendor
 * @returns {string|null}
 */
function humaniseGpuVendor(vendor) {
  if (!vendor) return null;
  if (/sppci_vendor_Apple/i.test(vendor)) return 'Apple';
  const known = vendor.replace(/^sppci_vendor_/i, '');
  return known || null;
}

/**
 * Resolve a display connection kind from the profiler fields.
 * @param {string|null} connectionType
 * @param {string|null} displayType
 * @param {any} screen
 * @returns {string|null}
 */
function displayConnection(connectionType, displayType, screen) {
  if (connectionType && /internal|builtin/i.test(connectionType)) return 'built-in';
  if (connectionType && /(hdmi|displayport|thunderbolt|dvi|vga|external)/i.test(connectionType)) return 'external';
  if (displayType && /built-?in|retina/i.test(displayType)) return 'built-in';
  if (screen && (screen.spdisplays_main === 'spdisplays_yes' || screen._spdisplays_pixels)) return 'external';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Section: hardware                                                          */
/* -------------------------------------------------------------------------- */

/** Contract cap for `hardware.drivers` (both platforms). */
const MAX_DRIVERS = 250;
/** Contract cap for `hardware.driverProblems` (Windows only; empty on macOS). */
const MAX_DRIVER_PROBLEMS = 50;

/**
 * Keep only the calendar date part of an ISO timestamp (the driver contract
 * uses `yyyy-MM-dd`; a full timestamp is not a deviation worth exposing).
 * @param {unknown} value
 * @returns {string|null}
 */
function isoDateOnly(value) {
  const text = str(value);
  if (!text) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : null;
}

/**
 * Vendor shown in `hardware.drivers[].manufacturer`.
 *
 * Apple's own extensions are identified by bundle id / install location; a
 * third-party extension is either the organisation named in its signing
 * subject or, when that cannot be parsed, the literal `Third-party` (never a
 * fabricated company name).
 * @param {string|null} bundleId
 * @param {string} extensionPath
 * @param {string|null} signedBy
 * @returns {string}
 */
function darwinDriverVendor(bundleId, extensionPath, signedBy) {
  if (
    (bundleId !== null && bundleId.startsWith('com.apple.')) ||
    /\/System\/Library\//.test(extensionPath) ||
    /TeamID:\s*@apple/.test(signedBy ?? '')
  ) {
    return 'Apple';
  }
  const subject =
    /Subject:\s*(?:Developer ID Application|Developer ID Installer|Apple Development|Mac Developer):\s*([^,]+)/.exec(
      signedBy ?? '',
    );
  if (subject) {
    const vendor = subject[1].replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim();
    if (vendor) return vendor;
  }
  return 'Third-party';
}

/**
 * Descending version comparison for the driver ordering (`31.0.15` before
 * `2.4.0`; purely numeric segments so Apple's `1` and `2.4.0` sort sanely).
 * @param {string|null} left
 * @param {string|null} right
 * @returns {number}
 */
function compareDriverVersions(left, right) {
  const segments = (value) =>
    str(value) === null
      ? []
      : String(value)
          .split(/[^0-9]+/)
          .filter((part) => part !== '')
          .map((part) => Number(part));
  const a = segments(left);
  const b = segments(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Map `SPExtensionsDataType` records to the frozen `hardware.drivers` shape.
 * `kind` is `driverkit` for DriverKit/system extensions and `kext` otherwise.
 *
 * The ordering keeps the most useful rows when the 250-entry cap bites:
 * third-party extensions first, then loaded ones, then version descending.
 * `truncated` reports whether the raw list exceeded {@link MAX_DRIVERS}.
 * @param {unknown} entries
 * @returns {{drivers: Array<{name: string, class: string|null,
 *   manufacturer: string|null, version: string|null, date: string|null,
 *   signer: string|null, inf: string|null, deviceId: string|null,
 *   kind: 'kext'|'driverkit'|'pnp', problem: string|null}>,
 *   truncated: boolean}}
 */
function parseDarwinDrivers(entries) {
  /** @type {Array<{thirdParty: boolean, loaded: boolean, driver: any}>} */
  const records = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const bundleId = str(entry.spext_bundleid);
    const name = str(entry._name) ?? bundleId;
    if (name === null) continue;
    const extensionPath = str(entry.spext_path) ?? '';
    const signedBy = str(entry.spext_signed_by);
    const manufacturer = darwinDriverVendor(bundleId, extensionPath, signedBy);
    records.push({
      thirdParty: manufacturer !== 'Apple',
      loaded: str(entry.spext_loaded) === 'spext_yes',
      driver: {
        name,
        class: null,
        manufacturer,
        version: str(entry.spext_version) ?? str(entry.version),
        date: isoDateOnly(entry.spext_lastModified),
        signer: signedBy,
        inf: null,
        // macOS has no PnP instance id; the extension's bundle identifier is
        // the stable identity we can report honestly.
        deviceId: bundleId,
        kind: /\.dext\/?$|DriverExtensions|SystemExtensions/i.test(extensionPath) ? 'driverkit' : 'kext',
        problem: null,
      },
    });
  }
  records.sort((left, right) => {
    if (left.thirdParty !== right.thirdParty) return left.thirdParty ? -1 : 1;
    if (left.loaded !== right.loaded) return left.loaded ? -1 : 1;
    const versionDiff = compareDriverVersions(left.driver.version, right.driver.version);
    if (versionDiff !== 0) return versionDiff;
    return (left.driver.name ?? '').localeCompare(right.driver.name ?? '');
  });
  const truncated = records.length > MAX_DRIVERS;
  return { drivers: records.slice(0, MAX_DRIVERS).map((record) => record.driver), truncated };
}

/**
 * Derive the driver summary from the returned (capped) arrays.
 * @param {Array<{manufacturer: string|null}>} drivers
 * @param {Array<object>} problems
 * @param {boolean} [truncated]
 * @returns {{total: number, thirdParty: number, problems: number, truncated: boolean}}
 */
function driverSummaryOf(drivers, problems, truncated = false) {
  return {
    total: drivers.length,
    thirdParty: drivers.filter((driver) => driver.manufacturer !== 'Apple').length,
    problems: problems.length,
    truncated,
  };
}

/**
 * @returns {Promise<object>} the frozen hardware section shape.
 */
async function buildHardware() {
  const errors = [];
  const [profiler, sysctlRes, ioregBattery] = await Promise.all([
    runJson(SYSTEM_PROFILER, ['-json', ...HARDWARE_PROFILER_TYPES], { timeout: 30_000, maxBuffer: 24 * 1024 * 1024 }),
    run(SYSCTL, ['-n', 'hw.physicalcpu', 'hw.logicalcpu', 'hw.memsize']),
    run(IOREG, ['-rn', 'AppleSmartBattery'], { timeout: 5_000 }),
  ]);
  const sp = profiler.ok && profiler.data && typeof profiler.data === 'object' ? profiler.data : {};
  if (!profiler.ok) errors.push(`system_profiler hardware: ${shortErr(profiler.error)}`);

  const sysctlValues = lines(sysctlRes.stdout).map((line) => Number(line));
  const cpus = os.cpus();
  const physicalCores = num(sysctlValues[0]) ?? cpus.length;
  const logicalCores = num(sysctlValues[1]) ?? cpus.length;
  const totalMemoryBytes = num(sysctlValues[2]) ?? os.totalmem();
  const hw = sp.SPHardwareDataType?.[0] ?? {};
  const memoryInfo = sp.SPMemoryDataType?.[0] ?? {};

  const cpu = {
    model: str(hw.chip_type) ?? str(cpus.length ? cpus[0].model : null),
    vendor: 'Apple',
    physicalCores,
    logicalCores,
    speedGHz: cpus.length && cpus[0].speed ? round(cpus[0].speed / 1000, 1) : null,
    architecture: process.arch,
    features: [],
  };

  const modules = [];
  const memoryType = str(memoryInfo.dimm_type);
  modules.push({
    slot: memoryType ? 'Unified Memory' : 'Memory',
    sizeBytes: totalMemoryBytes,
    type: memoryType,
    speedMHz: num(memoryInfo.dimm_speed) ? Number(memoryInfo.dimm_speed) : null,
    manufacturer: str(memoryInfo.dimm_manufacturer),
    partNumber: str(memoryInfo.dimm_part_number),
  });
  const memory = {
    totalBytes: totalMemoryBytes,
    type: memoryType,
    speedMHz: modules[0].speedMHz,
    modules,
  };

  /** @type {Array<{name: string|null, cores: number|null, vramBytes: number|null, vendor: string|null, metal: string|null}>} */
  const gpu = [];
  /** @type {Array<{name: string|null, resolution: string|null, refreshHz: number|null, main: boolean, connection: string|null}>} */
  const displays = [];
  for (const card of Array.isArray(sp.SPDisplaysDataType) ? sp.SPDisplaysDataType : []) {
    if (!card || typeof card !== 'object') continue;
    gpu.push({
      name: firstStr(card, ['sppci_model', '_name']),
      cores: num(card.sppci_cores),
      vramBytes: bytesFromText(card.sppci_vram) ?? bytesFromText(card.spdisplays_vram),
      vendor: humaniseGpuVendor(firstStr(card, ['spdisplays_vendor', 'sppci_vendor'])),
      metal: str(card.spdisplays_mtlgpufamilysupport),
    });
    const screens = Array.isArray(card.spdisplays_ndrvs) ? card.spdisplays_ndrvs : [];
    for (const screen of screens) {
      if (!screen || typeof screen !== 'object') continue;
      const resolutionRaw = firstStr(screen, ['_spdisplays_pixels', 'spdisplays_resolution']);
      const resolution = resolutionRaw ? resolutionRaw.replace(/\s*@.*$/, '').replace(/\s*[x×]\s*/i, 'x') : null;
      const refresh = /@\s*([\d.]+)\s*Hz/i.exec(firstStr(screen, ['spdisplays_resolution']) ?? '');
      const connectionType = str(screen.spdisplays_connection_type);
      displays.push({
        name: str(screen._name),
        resolution,
        refreshHz: refresh ? Number(refresh[1]) : null,
        main: screen.spdisplays_main === 'spdisplays_yes',
        connection: displayConnection(connectionType, str(screen.spdisplays_display_type), screen),
      });
    }
  }

  /** @type {Map<string, {name: string|null, model: string|null, sizeBytes: number|null, mediaType: string|null, smartStatus: string|null}>} */
  const physicalDrives = new Map();
  /** @type {Array<{name: string|null, mount: string|null, fs: string|null, totalBytes: number|null, usedBytes: number|null, freeBytes: number|null, removable: boolean|null, internal: boolean|null}>} */
  const volumes = [];
  for (const volume of Array.isArray(sp.SPStorageDataType) ? sp.SPStorageDataType : []) {
    if (!volume || typeof volume !== 'object') continue;
    const drive = volume.physical_drive ?? {};
    const deviceName = str(drive.device_name);
    const sizeBytes = num(volume.size_in_bytes);
    const freeBytes = num(volume.free_space_in_bytes);
    const isInternal = drive.is_internal_disk === 'yes' ? true : drive.is_internal_disk === 'no' ? false : null;
    volumes.push({
      name: str(volume._name),
      mount: str(volume.mount_point),
      fs: str(volume.file_system),
      totalBytes: sizeBytes,
      usedBytes: sizeBytes !== null && freeBytes !== null ? Math.max(0, sizeBytes - freeBytes) : null,
      freeBytes,
      removable: isInternal === null ? null : !isInternal,
      internal: isInternal,
    });
    if (deviceName) {
      const existing = physicalDrives.get(deviceName);
      const candidate = {
        name: str(drive.device_name),
        model: str(drive.media_name) ?? deviceName,
        sizeBytes,
        mediaType: str(drive.medium_type),
        smartStatus: str(drive.smart_status),
      };
      if (!existing || (sizeBytes ?? 0) > (existing.sizeBytes ?? 0)) physicalDrives.set(deviceName, candidate);
    }
  }

  let battery = null;
  const powerInfo = Array.isArray(sp.SPPowerDataType)
    ? sp.SPPowerDataType.find((entry) => entry && entry._name === 'spbattery_information')
    : null;
  const ioreg = parseIoregBattery(ioregBattery.stdout);
  if (powerInfo || hasBattery(ioreg)) {
    const charge = powerInfo?.sppower_battery_charge_info ?? {};
    const health = powerInfo?.sppower_battery_health_info ?? {};
    const percent = num(charge.sppower_battery_state_of_charge) ?? ioreg.currentCapacity;
    battery = {
      percent,
      condition: str(health.sppower_battery_health),
      cycleCount: num(health.sppower_battery_cycle_count) ?? ioreg.cycleCount,
      designCapacityMah: ioreg.designCapacity,
      maxCapacityMah: ioreg.rawMaxCapacity,
      temperatureC: ioreg.temperatureC,
      healthPercent: batteryHealth(ioreg),
    };
  }

  /** @type {Array<{name: string|null, vendor: string|null, productId: string|null, serial: string|null, speed: string|null, bus: string|null}>} */
  const usb = [];
  /** @type {Array<{name: string|null, address: string|null, connected: boolean, batteryPercent: number|null, type: string|null}>} */
  const bluetoothDevices = [];
  let bluetoothController = null;
  for (const root of Array.isArray(sp.SPUSBDataType) ? sp.SPUSBDataType : []) {
    if (!root || typeof root !== 'object') continue;
    const busName = str(root.host_controller) ? str(root._name) : null;
    flattenUsb([root], busName, usb);
  }
  const btEntry = Array.isArray(sp.SPBluetoothDataType) ? sp.SPBluetoothDataType[0] : null;
  if (btEntry && typeof btEntry === 'object') {
    const controller = btEntry.controller_properties ?? {};
    bluetoothController = {
      address: str(controller.controller_address),
      chipset: str(controller.controller_chipset),
      firmware: str(controller.controller_firmwareVersion),
      state: mapBluetoothState(str(controller.controller_state)),
    };
    bluetoothDevices.push(...parseBluetoothGroup(btEntry.device_connected, true));
    bluetoothDevices.push(...parseBluetoothGroup(btEntry.device_not_connected, false));
  }

  /** @type {Array<{name: string|null, kind: 'output'|'input', manufacturer: string|null, default: boolean}>} */
  const audio = [];
  const audioItems = Array.isArray(sp.SPAudioDataType) ? sp.SPAudioDataType[0]?._items ?? [] : [];
  for (const item of Array.isArray(audioItems) ? audioItems : []) {
    if (!item || typeof item !== 'object') continue;
    const isOutput = item.coreaudio_device_output !== undefined || item.coreaudio_output_source !== undefined;
    const isInput = item.coreaudio_device_input !== undefined || item.coreaudio_input_source !== undefined;
    const isDefault =
      item.coreaudio_default_audio_output_device === 'spaudio_yes' ||
      item.coreaudio_default_audio_system_device === 'spaudio_yes' ||
      item.coreaudio_default_audio_input_device === 'spaudio_yes';
    audio.push({
      name: str(item._name),
      kind: isOutput ? 'output' : 'input',
      manufacturer: str(item.coreaudio_device_manufacturer),
      default: isDefault && (isOutput || isInput),
    });
  }

  /** @type {Array<{name: string|null, modelId: string|null, uniqueId: string|null}>} */
  const cameras = [];
  for (const camera of Array.isArray(sp.SPCameraDataType) ? sp.SPCameraDataType : []) {
    if (!camera || typeof camera !== 'object') continue;
    cameras.push({
      name: str(camera._name),
      modelId: str(camera['spcamera_model-id']),
      uniqueId: str(camera['spcamera_unique-id']),
    });
  }

  // Installed kernel- and DriverKit extensions (SPExtensionsDataType). macOS
  // does not expose per-device ConfigManagerErrorCode, so `problem` stays null
  // and `driverProblems` is empty; matching Windows keeps the section shape.
  const parsedDrivers = parseDarwinDrivers(sp.SPExtensionsDataType);
  const drivers = parsedDrivers.drivers;
  /** @type {Array<{name: string, code: string, class: string|null}>} */
  const driverProblems = [];

  return {
    cpu,
    memory,
    gpu,
    displays,
    storage: { physical: [...physicalDrives.values()], volumes },
    battery,
    usb,
    bluetooth: { controller: bluetoothController, devices: bluetoothDevices },
    audio,
    cameras,
    drivers,
    driverSummary: driverSummaryOf(drivers, driverProblems, parsedDrivers.truncated),
    driverProblems,
    errors,
  };
}

/**
 * True when a battery is physically present.
 * @param {ReturnType<typeof parseIoregBattery>} battery
 * @returns {boolean}
 */
function hasBattery(battery) {
  return battery.present === true;
}

/**
 * Flatten the nested `SPUSBDataType` tree.
 * @param {any[]} nodes
 * @param {string|null} bus
 * @param {any[]} out
 * @returns {void}
 */
function flattenUsb(nodes, bus, out) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    const children = node._items;
    const childBus = bus ?? (typeof node._name === 'string' ? node._name : null);
    const hasIdentity = Boolean(node.product_id ?? node.vendor_id ?? node.serial_num);
    if (hasIdentity) {
      out.push({
        name: str(node._name),
        vendor: str(node.manufacturer) ?? str(node.vendor_id),
        productId: str(node.product_id),
        serial: str(node.serial_num),
        speed: mapUsbSpeed(str(node.device_speed)),
        bus,
      });
    }
    if (Array.isArray(children)) flattenUsb(children, childBus, out);
  }
}

/**
 * @param {string|null} speed
 * @returns {string|null}
 */
function mapUsbSpeed(speed) {
  switch (speed) {
    case 'low_speed':
      return '1.5 Mbps';
    case 'full_speed':
      return '12 Mbps';
    case 'high_speed':
      return '480 Mbps';
    case 'super_speed':
      return '5 Gbps';
    case 'super_speed_plus':
      return '10 Gbps';
    default:
      return speed;
  }
}

/**
 * @param {string|null} state
 * @returns {string|null}
 */
function mapBluetoothState(state) {
  if (!state) return null;
  if (/attrib_on|on$/i.test(state)) return 'on';
  if (/attrib_off|off$/i.test(state)) return 'off';
  return state;
}

/**
 * @param {any} group
 * @param {boolean} connected
 * @returns {Array<{name: string|null, address: string|null, connected: boolean,
 *   batteryPercent: number|null, type: string|null}>}
 */
function parseBluetoothGroup(group, connected) {
  /** @type {Array<{name: string|null, address: string|null, connected: boolean, batteryPercent: number|null, type: string|null}>} */
  const out = [];
  for (const entry of Array.isArray(group) ? group : []) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [name, info] of Object.entries(entry)) {
      if (!info || typeof info !== 'object') continue;
      out.push({
        name: str(name),
        address: str(info.device_address),
        connected,
        batteryPercent: firstNum(info, [
          'device_batteryLevel',
          'device_batteryPercent',
          'device_batteryLevelCase',
          'device_batteryLevelLeft',
          'device_batteryLevelRight',
        ]),
        type: firstStr(info, ['device_minorType', 'device_type', 'device_majorType']),
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Section: system                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<object>} the frozen system section shape.
 */
async function buildSystem() {
  const errors = [];
  const [facts, users, launchAgents, loginItems, localeInfo, envInfo, bootRes] = await Promise.all([
    staticFacts(),
    userFacts(),
    collectLaunchAgents(errors),
    collectLoginItems(errors),
    collectLocale(errors),
    Promise.resolve(collectEnvironment()),
    run(SYSCTL, ['-n', 'kern.boottime'], { timeout: 5_000 }),
  ]);

  const [computerRes, localHostRes, hostRes] = await Promise.all([
    run(SCUTIL, ['--get', 'ComputerName'], { timeout: 5_000 }),
    run(SCUTIL, ['--get', 'LocalHostName'], { timeout: 5_000 }),
    run(SCUTIL, ['--get', 'HostName'], { timeout: 5_000 }),
  ]);

  const bootMatch = /sec = (\d+)/.exec(bootRes.stdout);
  const bootTime = bootMatch ? Number(bootMatch[1]) * 1000 : null;
  const currentUser = users.users.find((user) => user.isCurrent) ?? null;

  return {
    os: {
      name: facts.os.name,
      version: facts.os.version,
      build: facts.os.build,
      kernel: facts.os.kernel,
      arch: facts.os.arch,
      release: facts.os.release,
    },
    device: {
      hostname: facts.hostname,
      computerName: str(computerRes.stdout) ?? facts.model,
      localHostname: str(localHostRes.stdout),
      model: facts.model,
      modelId: facts.modelId,
      chip: facts.chip,
      serial: facts.serial,
      hardwareUuid: facts.hardwareUuid,
    },
    boot: {
      bootTime,
      uptimeSec: Math.floor(os.uptime()),
    },
    user: currentUser
      ? {
          name: currentUser.name,
          fullName: currentUser.fullName,
          uid: currentUser.uid,
          gid: currentUser.gid,
          home: currentUser.home,
          shell: currentUser.shell,
          admin: currentUser.admin,
        }
      : null,
    users: users.users,
    launchAgents,
    loginItems,
    environment: envInfo,
    locale: localeInfo,
    errors,
  };
}

/**
 * Enumerate launch agents/daemons from the user and system domains.
 * @param {string[]} errors
 * @returns {Promise<Array<{label: string|null, path: string, scope: 'user'|'system',
 *   loaded: boolean, pid: number|null, lastExitStatus: number|null,
 *   program: string}>>}
 */
async function collectLaunchAgents(errors) {
  const home = os.homedir();
  const directories = [
    { dir: path.join(home, 'Library', 'LaunchAgents'), scope: 'user' },
    { dir: '/Library/LaunchAgents', scope: 'system' },
    { dir: '/Library/LaunchDaemons', scope: 'system' },
  ];

  /** @type {string[]} */
  const plistPaths = [];
  for (const { dir } of directories) {
    try {
      const entries = await fsp.readdir(dir);
      for (const entry of entries) {
        if (entry.endsWith('.plist')) plistPaths.push(path.join(dir, entry));
      }
    } catch {
      /* missing directory is normal */
    }
  }

  const [listRes] = await Promise.all([run(LAUNCHCTL, ['list'], { timeout: 10_000 })]);
  const loadedMap = listRes.ok ? parseLaunchctlList(listRes.stdout) : new Map();
  if (!listRes.ok) errors.push(`launchctl list: ${shortErr(listRes.error)}`);

  const agents = await Promise.all(
    plistPaths.map(async (plistPath) => {
      const scope = plistPath.startsWith(home) ? 'user' : 'system';
      let parsed = null;
      try {
        parsed = await parsePlistFile(plistPath);
      } catch (err) {
        errors.push(`launch agent ${path.basename(plistPath)}: ${shortErr(err instanceof Error ? err.message : err)}`);
      }
      const label = parsed?.Label ?? null;
      const program =
        parsed?.Program ?? (parsed?.ProgramArguments?.length ? String(parsed.ProgramArguments[0]) : null);
      const entry = label ? loadedMap.get(label) : undefined;
      let loaded = Boolean(entry);
      let pid = entry?.pid ?? null;
      let lastExitStatus = entry?.status ?? null;

      if (scope === 'system' && label && plistPath.startsWith('/Library/LaunchDaemons')) {
        const printed = await run(LAUNCHCTL, ['print', `system/${label}`], { timeout: 5_000 });
        if (printed.ok) {
          loaded = true;
          const pidMatch = /^\s*pid = (\d+)/m.exec(printed.stdout);
          if (pidMatch) pid = Number(pidMatch[1]);
          const exitMatch = /last exit code = (\d+)/.exec(printed.stdout);
          if (exitMatch) lastExitStatus = Number(exitMatch[1]);
        } else if (!entry) {
          loaded = false;
        }
      }

      return {
        label,
        path: plistPath,
        scope,
        loaded,
        pid,
        lastExitStatus,
        program: program ?? '',
      };
    }),
  );

  agents.sort((left, right) => {
    if (left.scope !== right.scope) return left.scope === 'user' ? -1 : 1;
    return (left.label ?? left.path).localeCompare(right.label ?? right.path);
  });
  return agents;
}

/**
 * Login items through System Events (best effort; needs automation permission).
 * @param {string[]} errors
 * @returns {Promise<Array<{name: string}>>}
 */
async function collectLoginItems(errors) {
  const result = await run(
    OSASCRIPT,
    ['-e', 'tell application "System Events" to get the name of every login item'],
    { timeout: 5_000 },
  );
  if (!result.ok) {
    errors.push(`login items: ${shortErr(result.stderr || result.error)}`);
    return [];
  }
  const text = result.stdout.trim();
  if (!text) return [];
  return text
    .split(/,\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

/**
 * Locale/timezone facts.
 * @param {string[]} errors
 * @returns {Promise<{timezone: string|null, locale: string|null, language: string|null}>}
 */
async function collectLocale(errors) {
  const [localeRes, languagesRes] = await Promise.all([
    run(DEFAULTS, ['read', '-g', 'AppleLocale'], { timeout: 5_000 }),
    run(DEFAULTS, ['read', '-g', 'AppleLanguages'], { timeout: 5_000 }),
  ]);
  const locale = str(localeRes.stdout);
  if (!localeRes.ok) errors.push(`AppleLocale: ${shortErr(localeRes.error)}`);
  let language = null;
  const quoted = /"([^"]+)"/.exec(languagesRes.stdout);
  if (quoted) language = quoted[1];
  if (!language) {
    const envLang = str(process.env.LANG);
    if (envLang) language = envLang.split('.')[0];
  }
  let timezone = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timezone = null;
  }
  return { timezone, locale, language };
}

/**
 * The whitelisted environment table (only these keys leave the process).
 * @returns {{PATH: string|null, SHELL: string|null, HOME: string|null,
 *   USER: string|null, LANG: string|null, TERM: string|null}}
 */
function collectEnvironment() {
  return {
    PATH: str(process.env.PATH),
    SHELL: str(process.env.SHELL),
    HOME: str(process.env.HOME),
    USER: str(process.env.USER),
    LANG: str(process.env.LANG),
    TERM: str(process.env.TERM),
  };
}

/* -------------------------------------------------------------------------- */
/* Section: software                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Parse one `mdls` batch output and attach facts to the matching paths.
 * @param {string} stdout
 * @param {string[]} paths
 * @param {Map<string, {bundleId: string|null, sizeBytes: number|null, lastUsed: number|null}>} target
 * @returns {void}
 */
function mergeMdlsBatch(stdout, paths, target) {
  /** @type {Array<{bundleId: string|null, sizeBytes: number|null, lastUsed: number|null}>} */
  const records = [];
  let current = null;
  for (const rawLine of String(stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^kMDItem([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const attribute = match[1];
    const rawValue = match[2].trim();
    const quoted = /^"(.*)"$/.exec(rawValue);
    const value = quoted ? quoted[1] : rawValue;
    const isNull = value === '(null)' || value === 'null' || value === '';
    if (attribute === 'CFBundleIdentifier') {
      current = { bundleId: isNull ? null : value, sizeBytes: null, lastUsed: null };
      records.push(current);
      continue;
    }
    if (!current) continue;
    if (attribute === 'FSSize') {
      const size = num(value);
      current.sizeBytes = size !== null ? size : null;
      continue;
    }
    if (attribute === 'LastUsedDate') {
      current.lastUsed = isNull ? null : parseMdlsDate(value);
    }
  }
  for (let index = 0; index < paths.length; index += 1) {
    const record = records[index];
    if (record) target.set(paths[index], record);
  }
}

/**
 * Parse the Spotlight date format ("2026-10-16 10:17:05 +0000").
 * @param {string} value
 * @returns {number|null}
 */
function parseMdlsDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const iso = `${match[1]}T${match[2]}${match[3]}${match[4]}:${match[5]}`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map a Spotlight/`system_profiler` architecture kind to a readable string.
 * @param {unknown} kind
 * @returns {string|null}
 */
function mapArchitecture(kind) {
  switch (kind) {
    case 'arch_arm_i64':
      return 'universal';
    case 'arch_arm':
      return 'arm64';
    case 'arch_i64':
      return 'x86_64';
    case 'arch_ios':
      return 'ios';
    case 'arch_other':
      return 'other';
    default:
      return str(kind);
  }
}

/**
 * Classify an app install location.
 * @param {string|null} appPath
 * @returns {'system'|'user'|'other'}
 */
function appSource(appPath) {
  if (!appPath) return 'other';
  const home = os.homedir();
  if (appPath.startsWith('/System/') || appPath.startsWith('/Library/Apple/')) return 'system';
  if (appPath.startsWith('/Applications/') || appPath.startsWith(`${home}/Applications/`)) return 'user';
  return 'other';
}

/**
 * @returns {Promise<object>} the frozen software section shape.
 */
async function buildSoftware() {
  const errors = [];
  const homebrewPromise = collectHomebrew(errors);
  const profiler = await runJson(SYSTEM_PROFILER, ['-json', 'SPApplicationsDataType'], {
    timeout: 60_000,
    maxBuffer: 24 * 1024 * 1024,
  });
  /** @type {Array<{name: string|null, path: string|null, version: string|null, bundleId: string|null, source: 'system'|'user'|'other', arch: string|null, lastUsed: number|null, sizeBytes: number|null}>} */
  const applications = [];
  /** @type {Array<any>} */
  const rawApps = profiler.ok && Array.isArray(profiler.data?.SPApplicationsDataType) ? profiler.data.SPApplicationsDataType : [];
  if (!profiler.ok) errors.push(`system_profiler applications: ${shortErr(profiler.error)}`);

  /** @type {Map<string, {bundleId: string|null, sizeBytes: number|null, lastUsed: number|null}>} */
  const metadata = new Map();
  const appPaths = rawApps.map((app) => str(app?.path)).filter((value) => typeof value === 'string');
  const chunks = [];
  for (let index = 0; index < appPaths.length; index += 60) chunks.push(appPaths.slice(index, index + 60));
  const mdlsResults = await Promise.all(
    chunks.map((chunk) =>
      run(
        MDLS,
        ['-name', 'kMDItemCFBundleIdentifier', '-name', 'kMDItemFSSize', '-name', 'kMDItemLastUsedDate', ...chunk],
        { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      ),
    ),
  );
  mdlsResults.forEach((result, index) => {
    if (!result.ok) {
      errors.push(`mdls applications (batch ${index + 1}): ${shortErr(result.error)}`);
      return;
    }
    mergeMdlsBatch(result.stdout, chunks[index], metadata);
  });

  for (const app of rawApps) {
    if (!app || typeof app !== 'object') continue;
    const appPath = str(app.path);
    const lookup = appPath ? metadata.get(appPath) : undefined;
    applications.push({
      name: str(app._name),
      path: appPath,
      version: str(app.version),
      bundleId: lookup?.bundleId ?? null,
      source: appSource(appPath),
      arch: mapArchitecture(app.arch_kind),
      lastUsed: lookup?.lastUsed ?? null,
      sizeBytes: lookup?.sizeBytes ?? null,
    });
  }
  applications.sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));

  const homebrew = await homebrewPromise;

  return {
    applications,
    totalApplications: applications.length,
    homebrew,
    errors,
  };
}

/**
 * Homebrew installed / outdated facts (cached by the software section TTL).
 * @param {string[]} errors
 * @returns {Promise<{available: boolean, prefix: string|null,
 *   installed: Array<{name: string, version: string|null}>, outdated: string[]}>}
 */
async function collectHomebrew(errors) {
  let brewPath = null;
  for (const candidate of BREW_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        brewPath = candidate;
        break;
      }
    } catch {
      /* keep looking */
    }
  }
  if (!brewPath) {
    return { available: false, prefix: null, installed: [], outdated: [] };
  }
  const prefix = path.dirname(path.dirname(brewPath));
  const [listRes, outdatedRes] = await Promise.all([
    run(brewPath, ['list', '--versions'], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }),
    runJson(brewPath, ['outdated', '--json=v2'], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }),
  ]);
  /** @type {Array<{name: string, version: string|null}>} */
  const installed = [];
  if (!listRes.ok) {
    errors.push(`brew list: ${shortErr(listRes.error)}`);
  } else {
    for (const line of lines(listRes.stdout)) {
      const parts = line.trim().split(/\s+/);
      if (!parts.length) continue;
      const name = parts[0];
      const version = parts.length > 1 ? parts.slice(1).join(', ') : null;
      installed.push({ name, version });
    }
    installed.sort((left, right) => left.name.localeCompare(right.name));
  }
  /** @type {string[]} */
  const outdated = [];
  if (!outdatedRes.ok) {
    errors.push(`brew outdated: ${shortErr(outdatedRes.error)}`);
  } else if (outdatedRes.data && Array.isArray(outdatedRes.data.formulae)) {
    for (const formula of outdatedRes.data.formulae) {
      const name = str(formula?.name);
      if (name) outdated.push(name);
    }
    outdated.sort((left, right) => left.localeCompare(right));
  }
  return { available: true, prefix, installed, outdated };
}

/* -------------------------------------------------------------------------- */
/* Section: network                                                           */
/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<object>} the frozen network section shape.
 */
async function buildNetwork() {
  const errors = [];
  const [ifaceListRaw, portsRes, routeValue, dnsRes, proxyRes, lsofRes, netstatRes, airportRes] = await Promise.all([
    interfaces(),
    run(NETWORKSETUP, ['-listallhardwareports'], { timeout: 10_000 }),
    defaultRoute(),
    run(SCUTIL, ['--dns'], { timeout: 10_000 }),
    run(SCUTIL, ['--proxy'], { timeout: 10_000 }),
    run(LSOF, ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }),
    run(NETSTAT, ['-an', '-p', 'tcp'], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }),
    runJson(SYSTEM_PROFILER, ['-json', 'SPAirPortDataType'], { timeout: 20_000 }),
  ]);
  if (!portsRes.ok) errors.push(`networksetup hardware ports: ${shortErr(portsRes.error)}`);
  const hardwarePorts = parseHardwarePorts(portsRes.stdout);
  const ifaceList = Array.isArray(ifaceListRaw) ? ifaceListRaw : [];

  const defaultInterface = routeValue?.interface ?? null;
  const selected = ifaceList.filter((iface) => {
    if (iface.name === 'lo0') return true;
    if (iface.name === defaultInterface) return true;
    if (!iface.up) return false;
    if (iface.ipv4.length) return true;
    if (iface.ipv6.some((address) => !/^fe80:/i.test(address))) return true;
    if (iface.status === 'active') return true;
    // Keep the Wi-Fi port when it is turned off: "Wi-Fi off" is a state, not
    // a missing interface. Other dead Thunderbolt stubs are dropped.
    const port = hardwarePorts.get(iface.name);
    return Boolean(port) && /wi-?fi|airport/i.test(port);
  });

  const interfacesSection = selected.map((iface) => ({
    name: iface.name,
    type: interfaceType(iface, hardwarePorts),
    up: iface.up,
    ipv4: iface.ipv4,
    ipv6: iface.ipv6,
    mac: iface.mac,
    mtu: iface.mtu,
    primary: iface.name === defaultInterface,
  }));

  if (!airportRes.ok) errors.push(`system_profiler airport: ${shortErr(airportRes.error)}`);
  const wifi = airportRes.ok ? parseAirportWifi(airportRes.data) : null;

  let dns = { servers: [], searchDomains: [] };
  if (dnsRes.ok) {
    dns = parseDns(dnsRes.stdout);
  } else {
    errors.push(`scutil --dns: ${shortErr(dnsRes.error)}`);
  }

  let proxy = { http: null, https: null, socks: null };
  if (proxyRes.ok) {
    proxy = parseProxy(parseScutilDictionary(proxyRes.stdout));
  } else {
    errors.push(`scutil --proxy: ${shortErr(proxyRes.error)}`);
  }

  /** @type {Array<{proto: string, address: string, port: number, pid: number|null, process: string}>} */
  let listeningPorts = [];
  if (lsofRes.ok) {
    listeningPorts = parseLsofListeners(lsofRes.stdout);
    const uniquePids = [...new Set(listeningPorts.map((entry) => entry.pid).filter((pid) => pid !== null))];
    if (uniquePids.length) {
      const nameRes = await run(PS, ['-p', uniquePids.join(','), '-o', 'pid=,command='], {
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
        env: utf8Env(),
      });
      if (nameRes.ok) {
        /** @type {Map<number, string>} */
        const names = new Map();
        for (const line of lines(nameRes.stdout)) {
          const match = /^\s*(\d+)\s+(.*)$/.exec(line);
          if (match) names.set(Number(match[1]), commandName(match[2].trim()));
        }
        listeningPorts = listeningPorts.map((entry) => ({
          ...entry,
          process: entry.pid !== null ? names.get(entry.pid) ?? entry.process : entry.process,
        }));
      }
    }
    listeningPorts.sort((left, right) => left.port - right.port);
  } else {
    errors.push(`lsof listening ports: ${shortErr(lsofRes.error)}`);
  }

  let establishedCount = 0;
  if (netstatRes.ok) {
    establishedCount = String(netstatRes.stdout)
      .split(/\r?\n/)
      .filter((line) => /\bESTABLISHED\b/.test(line)).length;
  } else {
    errors.push(`netstat connections: ${shortErr(netstatRes.error)}`);
  }

  return {
    interfaces: interfacesSection,
    wifi,
    defaultRoute: routeValue,
    dns,
    proxy,
    listeningPorts,
    establishedCount,
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Section: security                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<object>} the frozen security section shape.
 */
async function buildSecurity() {
  const errors = [];
  const [vaultRes, sipRes, gatekeeperRes, firewallRes, stealthRes, remoteRes, autoLoginRes, users] = await Promise.all([
    run(FD_SETUP, ['status'], { timeout: 10_000 }),
    run(CSRUTIL, ['status'], { timeout: 10_000 }),
    run(SPCTL, ['--status'], { timeout: 10_000 }),
    run(SOCKETFILTERFW, ['--getglobalstate'], { timeout: 10_000 }),
    run(SOCKETFILTERFW, ['--getstealthmode'], { timeout: 10_000 }),
    run(SYSTEMSETUP, ['-getremotelogin'], { timeout: 10_000 }),
    run(DEFAULTS, ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser'], { timeout: 5_000 }),
    userFacts(),
  ]);

  const fileVault = parseStatusFlag(vaultRes, errors, 'FileVault', /FileVault is (On|Off)\./i);
  const sip = parseStatusFlag(sipRes, errors, 'SIP', /System Integrity Protection status:\s*(enabled|disabled)/i);
  const gatekeeper = parseStatusFlag(gatekeeperRes, errors, 'Gatekeeper', /assessments (enabled|disabled)/i);
  const firewall = parseStatusFlag(firewallRes, errors, 'Firewall', /Firewall is (enabled|disabled)/i);
  let stealthMode = null;
  if (stealthRes.ok) {
    const match = /stealth mode is (on|off)/i.exec(stealthRes.stdout);
    if (match) stealthMode = match[1].toLowerCase() === 'on';
  } else {
    errors.push(`firewall stealth: ${shortErr(stealthRes.error)}`);
  }

  let remoteLogin = null;
  if (remoteRes.ok) {
    const match = /Remote Login:\s*(On|Off)/i.exec(remoteRes.stdout);
    if (match) remoteLogin = match[1].toLowerCase() === 'on';
  } else {
    errors.push(`remote login: ${shortErr(remoteRes.stderr || remoteRes.error)}`);
  }

  const autoLogin = autoLoginRes.ok ? str(autoLoginRes.stdout) : null;

  const tcc = await readTccGrants(errors);

  const currentName = os.userInfo().username;
  const realUserNames = new Set(users.users.map((user) => user.name));
  const admins = users.adminNames.filter((name) => realUserNames.has(name));

  return {
    fileVault,
    sip,
    gatekeeper,
    firewall: { ...firewall, stealthMode },
    tcc,
    users: { current: currentName, admins, total: users.users.length },
    remoteLogin,
    autoLogin,
    errors,
  };
}

/**
 * Parse one "feature is on/off" command result.
 * @param {Awaited<ReturnType<typeof run>>} result
 * @param {string[]} errors
 * @param {string} label
 * @param {RegExp} pattern
 * @returns {{enabled: boolean|null, raw: string|null}}
 */
function parseStatusFlag(result, errors, label, pattern) {
  const raw = str(result.stdout);
  if (!result.ok) {
    errors.push(`${label}: ${shortErr(result.stderr || result.error)}`);
    return { enabled: null, raw };
  }
  const match = pattern.exec(result.stdout);
  if (!match) return { enabled: null, raw };
  return { enabled: match[1].toLowerCase() === 'enabled' || match[1].toLowerCase() === 'on', raw };
}

/**
 * Read TCC grants when the user's TCC database happens to be readable.
 * @param {string[]} errors
 * @returns {Promise<{readable: boolean, reason: string|null,
 *   grants: Array<{service: string, client: string}>}>}
 */
async function readTccGrants(errors) {
  const database = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');
  let readable = false;
  try {
    await fsp.access(database, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }
  if (!readable) {
    return {
      readable: false,
      reason:
        'macOS protects the TCC privacy database; reading it requires Full Disk Access for the Host process.',
      grants: [],
    };
  }
  const query = await run(SQLITE3, ['-readonly', database, 'SELECT service, client FROM access WHERE auth_value = 2 LIMIT 500'], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!query.ok) {
    errors.push(`TCC query: ${shortErr(query.stderr || query.error)}`);
    return { readable: true, reason: null, grants: [] };
  }
  /** @type {Array<{service: string, client: string}>} */
  const grants = [];
  for (const line of lines(query.stdout)) {
    const separator = line.indexOf('|');
    if (separator === -1) continue;
    grants.push({
      service: line.slice(0, separator),
      client: line.slice(separator + 1),
    });
  }
  return { readable: true, reason: null, grants };
}

/* -------------------------------------------------------------------------- */
/* Section: processes                                                         */
/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<object>} the frozen processes section shape.
 */
async function buildProcesses() {
  const errors = [];
  let table = [];
  try {
    const rows = await processTable();
    table = Array.isArray(rows) ? rows : [];
  } catch (err) {
    errors.push(`ps: ${shortErr(err instanceof Error ? err.message : err)}`);
  }
  const sorted = [...table].sort((left, right) => {
    if (right.cpu !== left.cpu) return right.cpu - left.cpu;
    return right.memPercent - left.memPercent;
  });
  const list = sorted.slice(0, 200);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of table) {
    const user = entry.user ?? 'unknown';
    counts.set(user, (counts.get(user) ?? 0) + 1);
  }
  const byUser = [...counts.entries()]
    .map(([user, count]) => ({ user, count }))
    .sort((left, right) => right.count - left.count);
  return { total: table.length, list, byUser, errors };
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
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
/* Metrics: thermal sensors                                                   */
/* -------------------------------------------------------------------------- */

/**
 * TTL for the whole thermal probe. The UI polls metrics every 2500 ms; the
 * pressure probe spawns `osascript`, so it must not run on every poll. A 5 s
 * cache refreshes roughly every other poll.
 */
const THERMAL_TTL = 5_000;

/**
 * Optional third-party CPU-temperature helpers, in preference order. They are
 * invoked argv-only with a short timeout; when none is installed the CPU value
 * stays null and the note explains why (`cpu-needs-admin`).
 */
const SMC_HELPERS = [
  { name: 'osx-cpu-temp', args: [] },
  { name: 'smctemp', args: ['-c'] },
  { name: 'istats', args: ['cpu', 'temp', '--value-only'] },
];

/** Extra install locations searched besides `$PATH`. */
const HELPER_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const POWERMETRICS = '/usr/bin/powermetrics';
/** `NSProcessInfo.thermalState` enum, in order. */
const THERMAL_PRESSURE_STATES = ['nominal', 'fair', 'serious', 'critical'];

/**
 * Resolve an installed helper to an absolute path (execFile argv only).
 * @param {string} name
 * @returns {string|null}
 */
function resolveExecutable(name) {
  const dirs = [...String(process.env.PATH ?? '').split(path.delimiter), ...HELPER_DIRS].filter(Boolean);
  for (const dir of new Set(dirs)) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Accept only a physically plausible temperature (guards a garbage sample).
 * @param {unknown} value
 * @returns {number|null}
 */
function plausibleCelsius(value) {
  const parsed = num(value);
  if (parsed === null || parsed < -20 || parsed > 150) return null;
  return round(parsed, 1);
}

/**
 * The contract's null-filled thermal object (used by fallbackMetrics and when
 * the probe cannot produce anything at all).
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
 * True when the Host process runs as root (needed for `powermetrics`).
 * @returns {boolean}
 */
function isRootUser() {
  try {
    return typeof process.getuid === 'function' && process.getuid() === 0;
  } catch {
    return false;
  }
}

/**
 * Thermal pressure from `NSProcessInfo.thermalState` via JavaScript for
 * Automation (no admin, no helper). Maps 0/1/2/3 → nominal/fair/serious/
 * critical; any failure or out-of-range value is null.
 * @returns {Promise<'nominal'|'fair'|'serious'|'critical'|null>}
 */
async function readThermalPressure() {
  const script = 'ObjC.import("Foundation"); ObjC.unwrap($.NSProcessInfo.processInfo.thermalState)';
  const result = await run(OSASCRIPT, ['-l', 'JavaScript', '-e', script], { timeout: 1_500 });
  if (!result.ok) return null;
  const level = num(lines(result.stdout)[0]);
  if (level === null || !Number.isInteger(level) || level < 0 || level >= THERMAL_PRESSURE_STATES.length) return null;
  return /** @type {'nominal'|'fair'|'serious'|'critical'} */ (THERMAL_PRESSURE_STATES[level]);
}

/**
 * Run one optional temperature helper (bounded) and parse its first number.
 * @param {string} executable absolute path
 * @param {string[]} args
 * @returns {Promise<number|null>}
 */
async function readHelperCelsius(executable, args) {
  const result = await run(executable, args, { timeout: 2_000, maxBuffer: 256 * 1024 });
  if (!result.ok) return null;
  const match = /(-?\d+(?:\.\d+)?)/.exec(result.stdout);
  return match ? plausibleCelsius(match[1]) : null;
}

/**
 * CPU/GPU die temperatures from `powermetrics` — only when the Host is root;
 * `sudo` would need a password and cannot be used from a service. Never throws.
 * @returns {Promise<{cpuCelsius: number|null, gpuCelsius: number|null}|null>}
 */
async function readPowermetricsTemps() {
  if (!isRootUser()) return null;
  const attempts = [
    ['--samplers', 'smc', '-i', '1', '-n', '1'],
    ['--samplers', 'thermal', '-i', '1', '-n', '1'],
  ];
  for (const args of attempts) {
    const result = await run(POWERMETRICS, args, { timeout: 4_000, maxBuffer: 1024 * 1024 });
    if (!result.ok) continue;
    const cpuMatch = /(?:CPU(?:\s+die)?\s+temperature)\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(result.stdout);
    const gpuMatch = /(?:GPU(?:\s+die)?\s+temperature)\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(result.stdout);
    const cpuCelsius = cpuMatch ? plausibleCelsius(cpuMatch[1]) : null;
    const gpuCelsius = gpuMatch ? plausibleCelsius(gpuMatch[1]) : null;
    if (cpuCelsius !== null || gpuCelsius !== null) return { cpuCelsius, gpuCelsius };
  }
  return null;
}

/**
 * The full `metrics.thermal` probe, cached for {@link THERMAL_TTL}.
 *
 * `batteryCelsius` reuses the AppleSmartBattery sample the metrics path already
 * reads (the parser returns the top-level `Temperature` value scaled to °C).
 * `nvmeCelsius` stays null: on macOS the NVMe temperature is not readable
 * without root and `ioreg -c AppleEmbeddedNVMeTemperatureSensor` does not expose
 * a usable temperature, so no source is claimed. `fans` is empty on macOS: the
 * only fan source (`powermetrics`) is root-only and reports RPM unreliably.
 *
 * @param {ReturnType<typeof parseIoregBattery>|null} battery
 * @returns {Promise<object>} frozen thermal shape
 */
async function thermalMetrics(battery) {
  const cached = await memo('thermal', THERMAL_TTL, async () => {
    /** @type {string[]} */
    const sources = [];
    /** @type {Array<{name: string|null, rpm: number|null}>} */
    const fans = [];
    const pressure = await readThermalPressure().catch(() => null);
    if (pressure !== null) sources.push('nsprocessinfo');

    const batteryCelsius =
      battery && typeof battery.temperatureC === 'number' ? plausibleCelsius(battery.temperatureC) : null;
    if (batteryCelsius !== null) sources.push('ioreg-applesmartbattery');

    let cpuCelsius = null;
    let gpuCelsius = null;
    for (const helper of SMC_HELPERS) {
      const executable = resolveExecutable(helper.name);
      if (executable === null) continue;
      const value = await readHelperCelsius(executable, helper.args).catch(() => null);
      if (value !== null) {
        cpuCelsius = value;
        sources.push(helper.name);
        break;
      }
    }

    const rootTemps = await readPowermetricsTemps().catch(() => null);
    if (rootTemps !== null) {
      if (cpuCelsius === null && rootTemps.cpuCelsius !== null) cpuCelsius = rootTemps.cpuCelsius;
      if (rootTemps.gpuCelsius !== null) gpuCelsius = rootTemps.gpuCelsius;
      if (cpuCelsius !== null || gpuCelsius !== null) sources.push('powermetrics');
    }

    const note = cpuCelsius === null && gpuCelsius === null ? (isRootUser() ? 'unavailable' : 'cpu-needs-admin') : null;
    const available = [cpuCelsius, gpuCelsius, batteryCelsius].some(
      (value) => typeof value === 'number' && Number.isFinite(value),
    );
    return {
      available,
      cpuCelsius,
      gpuCelsius,
      batteryCelsius,
      nvmeCelsius: null,
      pressure,
      fans,
      sources,
      note,
    };
  });
  if (cached === null || typeof cached !== 'object') return emptyThermal('unavailable');
  const safe = jsonSafe(cached);
  return safe && typeof safe === 'object' ? safe : emptyThermal('unavailable');
}

/**
 * Build one metrics snapshot. Cheap commands only; slow values come from
 * caches and are refreshed in the background.
 * @returns {Promise<object>}
 */
async function buildMetrics() {
  const [vmRes, swapRes, pressureRes, batteryRes, ioregBatteryRes, netstatRes, ioregDiskRes, usage, facts, processes, disk, routeValue, ifaceList] =
    await Promise.all([
      run(VM_STAT, [], { timeout: 5_000 }),
      run(SYSCTL, ['-n', 'vm.swapusage'], { timeout: 5_000 }),
      run(SYSCTL, ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 5_000 }),
      run(PMSET, ['-g', 'batt'], { timeout: 5_000 }),
      run(IOREG, ['-rn', 'AppleSmartBattery'], { timeout: 5_000 }),
      run(NETSTAT, ['-inb'], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }),
      run(IOREG, ['-c', 'IOBlockStorageDriver', '-r', '-w0'], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }),
      cpuUsage(),
      staticFacts(),
      processTable().then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => []),
      diskUsage(),
      defaultRoute(),
      interfaces().then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => []),
    ]);

  const ts = Date.now();
  const vm = parseVmStat(vmRes.stdout);
  const pageSize = vm.pageSize;
  const memoryTotal = facts.totalMemoryBytes ?? os.totalmem();
  const freeBytes = vm.free * pageSize;
  const wiredBytes = vm.wired * pageSize;
  const compressedBytes = vm.compressed * pageSize;
  const purgeableBytes = vm.purgeable * pageSize;
  const cachedBytes = Math.min(memoryTotal, vm.fileBacked * pageSize + purgeableBytes);
  const appBytes = Math.max(0, vm.anonymous * pageSize - purgeableBytes);
  const usedBytes = clamp(memoryTotal - freeBytes - cachedBytes, 0, memoryTotal);
  const swap = parseSwap(swapRes.stdout);
  const pressureLevel = num(lines(pressureRes.stdout)[0]);
  const memoryPressure =
    pressureLevel === null ? null : pressureLevel >= 4 ? 'critical' : pressureLevel >= 2 ? 'warning' : 'normal';

  const batteryPmset = parsePmsetBattery(batteryRes.stdout);
  const batteryIoreg = parseIoregBattery(ioregBatteryRes.stdout);
  let battery = null;
  if (batteryPmset.present || hasBattery(batteryIoreg)) {
    const timeRemaining = batteryIoreg.timeRemaining;
    battery = {
      present: true,
      percent: batteryPmset.percent ?? batteryIoreg.currentCapacity,
      charging: batteryIoreg.charging ?? batteryPmset.charging,
      plugged: batteryIoreg.external ?? batteryPmset.plugged,
      powerSource: batteryPmset.powerSource,
      timeRemainingMin: timeRemaining === null || timeRemaining <= 0 || timeRemaining > 6000 ? null : Math.round(timeRemaining),
      temperatureC: batteryIoreg.temperatureC,
      cycleCount: batteryIoreg.cycleCount,
      healthPercent: batteryHealth(batteryIoreg),
    };
  }

  const thermal = await thermalMetrics(batteryIoreg);

  const netBytes = parseNetstatBytes(netstatRes.stdout);
  const netRates = rateOf('network', netBytes, ts);
  const diskBytes = parseIoregDisk(ioregDiskRes.stdout);
  const diskRates = rateOf('disk', diskBytes, ts);

  const defaultInterface = routeValue?.interface ?? null;
  const primaryIface = defaultInterface ? ifaceList.find((iface) => iface.name === defaultInterface) : null;
  const wifi = wifiMetricSample();

  const topProcesses = [...processes]
    .sort((left, right) => {
      if (right.cpu !== left.cpu) return right.cpu - left.cpu;
      return right.memPercent - left.memPercent;
    })
    .slice(0, 5)
    .map((entry) => ({
      pid: entry.pid,
      name: commandName(entry.command),
      cpu: entry.cpu,
      memPercent: entry.memPercent,
      user: entry.user,
    }));

  return {
    ts,
    hostname: facts.hostname,
    osVersion: facts.os.version
      ? `${facts.os.name} ${facts.os.version}${facts.os.build ? ` (${facts.os.build})` : ''}`
      : facts.os.name,
    uptimeSec: Math.floor(os.uptime()),
    cpu: {
      model: facts.cpuModel,
      usagePercent: usage.usagePercent,
      perCore: usage.perCore,
      loadAvg: os.loadavg().map((value) => round(value, 2)),
      logicalCores: facts.logicalCores,
      physicalCores: facts.physicalCores,
    },
    memory: {
      totalBytes: memoryTotal,
      usedBytes,
      appBytes,
      wiredBytes,
      compressedBytes,
      cachedBytes,
      freeBytes,
      swapTotalBytes: swap.total,
      swapUsedBytes: swap.used,
      pressure: memoryPressure,
    },
    disk: {
      totalBytes: disk?.totalBytes ?? null,
      usedBytes: disk?.usedBytes ?? null,
      freeBytes: disk?.freeBytes ?? null,
      readBytesPerSec: diskRates.readBytesPerSec,
      writeBytesPerSec: diskRates.writeBytesPerSec,
    },
    network: {
      rxBytesPerSec: netRates.readBytesPerSec,
      txBytesPerSec: netRates.writeBytesPerSec,
      totalRxBytes: netBytes.read,
      totalTxBytes: netBytes.write,
      wifi,
      primaryIpv4: primaryIface ? [...primaryIface.ipv4] : [],
      defaultInterface,
    },
    battery,
    thermal,
    processes: {
      total: processes.length,
      top: topProcesses,
    },
  };
}

/**
 * Display name for a process command line.
 * @param {string} command
 * @returns {string|null}
 */
function commandName(command) {
  const text = str(command);
  if (!text) return null;
  // App bundles put the real binary after `.../Contents/MacOS/`, and both the
  // bundle name and the binary name may contain spaces.
  const macOsIndex = text.lastIndexOf('/MacOS/');
  if (macOsIndex !== -1) {
    const rest = text.slice(macOsIndex + '/MacOS/'.length);
    const flagIndex = rest.indexOf(' --');
    const binary = flagIndex === -1 ? rest : rest.slice(0, flagIndex);
    return binary.trim() || null;
  }
  const first = text.split(/\s+/)[0];
  return path.basename(first);
}

/**
 * Best-effort zeroed metrics object (the tick path must never throw).
 * @returns {object}
 */
function fallbackMetrics() {
  return {
    ts: Date.now(),
    hostname: safeHostname(),
    osVersion: null,
    uptimeSec: Math.floor(os.uptime()),
    cpu: {
      model: null,
      usagePercent: 0,
      perCore: [],
      loadAvg: os.loadavg().map((value) => round(value, 2)),
      logicalCores: os.cpus().length,
      physicalCores: os.cpus().length,
    },
    memory: {
      totalBytes: os.totalmem(),
      usedBytes: null,
      appBytes: null,
      wiredBytes: null,
      compressedBytes: null,
      cachedBytes: null,
      freeBytes: os.freemem(),
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
 * os.hostname() that cannot throw.
 * @returns {string|null}
 */
function safeHostname() {
  try {
    return os.hostname();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Public collectors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Start slow section collection in the background. Fire-and-forget by design:
 * the Host calls this once at plugin start so the first panel view is warm.
 * @returns {void}
 */
export function warmup() {
  for (const section of SECTIONS) {
    collectSection(section).catch(() => {
      /* cache prime only; failures are returned by collectSection later */
    });
  }
  // Prime the metrics-side Wi-Fi sample and shared facts too.
  Promise.resolve()
    .then(() => wifiMetricSample())
    .catch(() => {});
  Promise.resolve()
    .then(() => staticFacts())
    .catch(() => {});
}

/**
 * One metrics snapshot for the 2500 ms UI poll. Never throws.
 * @returns {Promise<object>}
 */
export async function collectMetrics() {
  try {
    return jsonSafe(await buildMetrics());
  } catch {
    return jsonSafe(fallbackMetrics());
  }
}

/**
 * Build (or serve from cache) one section.
 *
 * Unknown section names reject; every command failure is captured in the
 * returned section's `errors[]` instead of throwing.
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

  const task = (async () => {
    const builders = {
      hardware: buildHardware,
      system: buildSystem,
      software: buildSoftware,
      network: buildNetwork,
      security: buildSecurity,
      processes: buildProcesses,
    };
    const builder = builders[section];
    let value;
    try {
      value = await builder();
    } catch (err) {
      value = { errors: [shortErr(err instanceof Error ? err.message : err)] };
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
 * Full inventory for the panel's initial load / `device_info` overview.
 * @param {{sections?: string[], fresh?: boolean}} [options]
 * @returns {Promise<{generatedAt: number, platform: string,
 *   hostname: string|null, metrics: object, sections: Record<string, object>,
 *   actions: {catalog: any[], history: any[]}, errors: string[]}>}
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

  return jsonSafe({
    generatedAt: Date.now(),
    platform: PLATFORM,
    hostname: safeHostname(),
    metrics,
    sections,
    actions: { catalog: actionCatalog(), history: actionHistory() },
    errors,
  });
}

/**
 * Drop cached section data (one section or all of them).
 * @param {string} [section]
 * @returns {void}
 */
export function clearCache(section) {
  if (section) {
    sectionCache.delete(section);
    return;
  }
  sectionCache.clear();
}
