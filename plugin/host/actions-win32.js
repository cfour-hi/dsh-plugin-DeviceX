/**
 * Device X action engine - Windows implementation.
 *
 * Same frozen surface as `actions-darwin.js`: `GROUPS`, `actionCatalog()`,
 * `actionHistory()`, `runAction()`. Every action validates in JavaScript and
 * then runs one constant PowerShell script through `./win.js`; parameters reach
 * PowerShell only as `DEVICEX_ARG_*` environment variables and are never
 * interpolated into script text (no shell, no `Invoke-Expression`).
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/actions-win32
 */
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { cleanupItems, deleteCleanup } from './cleanup-win32.js';
import { runPS, runPSJson, psString } from './win.js';

/** @typedef {import('../../types/contracts.js').Win32ActionParamsById} Win32Params */
/** @typedef {import('../../types/contracts.js').Win32Signal} Win32Signal */
/** @typedef {import('../../types/contracts.js').ActionResult} ActionResult */

/** Action groups, in UI order. */
export const GROUPS = ['process', 'app', 'system', 'network', 'software', 'power'];

/** Maximum retained history entries. */
const HISTORY_LIMIT = 50;

/** Shared PowerShell preamble for every action script. */
const PS_HEAD = "$ErrorActionPreference='Stop';";

/** Panes accepted by `system.openSettings` (Windows `ms-settings:` URIs). */
const SETTINGS_PANES = [
  'display',
  'sound',
  'bluetooth',
  'apps',
  'privacy',
  'network',
  'wifi',
  'windowsupdate',
  'windowsdefender',
  'storage',
  'battery',
  'power',
  'users',
  'datetime',
  'language',
  'defaultapps',
  'startup',
];

/** Frozen pane name -> Windows `ms-settings:` page slug for `system.openSettings`. */
const PANE_URIS = {
  display: 'display',
  sound: 'sound',
  bluetooth: 'bluetooth',
  apps: 'appsfeatures',
  privacy: 'privacy',
  network: 'network',
  wifi: 'network-wifi',
  windowsupdate: 'windowsupdate',
  windowsdefender: 'windowsdefender',
  storage: 'storagesense',
  battery: 'batterysaver',
  power: 'powersleep',
  users: 'otherusers',
  datetime: 'dateandtime',
  language: 'regionlanguage',
  defaultapps: 'defaultapps',
  startup: 'startupapps',
};

/** `process.signal` signal names; TERM maps to Stop-Process without -Force. */
const SIGNALS = ['TERM', 'KILL', 'INT'];

const GUID_PATTERN = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
const MSI_ID_PATTERN = new RegExp(`^msi:\\{${GUID_PATTERN}\\}$`);
const WINGET_TOKEN_PATTERN = /^[A-Za-z0-9._+-]{1,200}$/;
const REGISTRY_SEGMENT_PATTERN = /^[^\\/:*?"<>|]{1,128}$/;
const STARTUP_PATH_PATTERN = /^startup:(HKCU|HKLM32|HKLM):([^\\/:*?"<>|]{1,128})$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9-]{1,63}$/;
const PROCESS_NAME_PATTERN = /^[A-Za-z0-9._ -]{1,128}$/;

/* -------------------------------------------------------------------------- */
/* Result / JSON helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} message
 * @param {string} [code]
 * @returns {{ok: false, message: string, code?: string}}
 */
function failure(message, code) {
  return code ? { ok: false, message, code } : { ok: false, message };
}

/**
 * @param {string} message
 * @param {object} [data]
 * @returns {{ok: true, message: string, data?: object}}
 */
function success(message, data) {
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    return { ok: true, message, data: jsonSafe(data) };
  }
  return { ok: true, message };
}

/**
 * Deep-copy through JSON; never throws, never leaves `undefined` in the graph.
 * @param {unknown} value
 * @returns {unknown}
 */
function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

/** Keep only a plain params object (the API may send an array or garbage). */
function paramsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Serialize validated values into `DEVICEX_ARG_*` strings.
 * @param {Record<string, unknown>} values
 * @returns {Record<string, string>}
 */
function envOf(values) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(values)) {
    env[`DEVICEX_ARG_${key}`] = value === undefined || value === null ? '' : String(value);
  }
  return env;
}

/**
 * Turn a failed PowerShell result into an ActionResult with its diagnostic.
 * @param {string} label
 * @param {{error?: string, stderr?: string, raw?: string}} result
 * @returns {{ok: false, message: string, code?: string}}
 */
function commandFailure(label, result) {
  const detail = String(result.error || result.stderr || result.raw || 'the command failed').trim();
  return failure(`${label} failed: ${detail}`, 'COMMAND_FAILED');
}

/* -------------------------------------------------------------------------- */
/* Pure validators (no process spawn, no side effects)                        */
/* -------------------------------------------------------------------------- */

/** Read an integer/number param with range checks. * @returns {{ok: true, value: number|null} | {ok: false, message: string, code?: string}}
 */
function readNumber(params, name, options = {}) {
  const raw = params[name];
  if (raw === undefined || raw === null || raw === '') {
    if (options.defaultValue !== undefined) return { ok: true, value: options.defaultValue };
    if (options.required !== false) return failure(`Parameter "${name}" is required.`, 'BAD_PARAMS');
    return { ok: true, value: null };
  }
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return failure(`Parameter "${name}" must be a number.`, 'BAD_PARAMS');
  if (options.integer === true && !Number.isInteger(value)) {
    return failure(`Parameter "${name}" must be an integer.`, 'BAD_PARAMS');
  }
  const below = typeof options.min === 'number' && value < options.min;
  const above = typeof options.max === 'number' && value > options.max;
  if (below || above) {
    return failure(`Parameter "${name}" must be between ${options.min} and ${options.max}.`, 'BAD_PARAMS');
  }
  return { ok: true, value };
}

/** Read a trimmed string param, rejecting controls and enforcing a pattern. * @returns {{ok: true, value: string} | {ok: false, message: string, code?: string}}
 */
function readString(params, name, options = {}) {
  const raw = params[name];
  if (raw === undefined || raw === null) {
    if (options.defaultValue !== undefined) return { ok: true, value: options.defaultValue };
    return failure(`Parameter "${name}" is required.`, 'BAD_PARAMS');
  }
  if (typeof raw !== 'string') return failure(`Parameter "${name}" must be a string.`, 'BAD_PARAMS');
  const value = raw.trim();
  if (value === '') return failure(`Parameter "${name}" must not be empty.`, 'BAD_PARAMS');
  if (options.maxLength && value.length > options.maxLength) {
    return failure(`Parameter "${name}" must be at most ${options.maxLength} characters.`, 'BAD_PARAMS');
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return failure(`Parameter "${name}" must not contain control characters.`, 'BAD_PARAMS');
  }
  if (options.pattern && !options.pattern.test(value)) {
    return failure(options.patternMessage ?? `Parameter "${name}" has an invalid format.`, 'BAD_PARAMS');
  }
  return { ok: true, value };
}

/** Read a boolean param, tolerating the JSON/string/0-1 forms clients send. * @returns {{ok: true, value: boolean} | {ok: false, message: string, code?: string}}
 */
function readBoolean(params, name, options = {}) {
  const raw = params[name];
  if (raw === undefined && options.defaultValue !== undefined) return { ok: true, value: options.defaultValue };
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return { ok: true, value: true };
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return { ok: true, value: false };
  return failure(`Parameter "${name}" must be a boolean.`, 'BAD_PARAMS');
}

/** Read a select param restricted to a fixed option list. * @returns {{ok: true, value: string} | {ok: false, message: string, code?: string}}
 */
function readSelect(params, name, options) {
  const raw = params[name];
  if ((raw === undefined || raw === null || raw === '') && options.defaultValue !== undefined) {
    return { ok: true, value: options.defaultValue };
  }
  if (typeof raw !== 'string') {
    return failure(`Parameter "${name}" must be one of: ${options.options.join(', ')}.`, 'BAD_PARAMS');
  }
  const value = raw.trim();
  if (!options.options.includes(value)) {
    return failure(`Parameter "${name}" must be one of: ${options.options.join(', ')}.`, 'BAD_PARAMS');
  }
  return { ok: true, value };
}

/**
 * Resolve a path that must already exist on disk (absolute, `~` or CWD-relative).
 * @param {object} params
 * @param {string} name
 * @param {{allowDirectory?: boolean}} [options]
 * @returns {{ok: true, value: string} | {ok: false, message: string, code?: string}}
 */
function readExistingPath(params, name, options = {}) {
  const raw = readString(params, name, { required: true, maxLength: 4096 });
  if (!raw.ok) return raw;
  let candidate = raw.value;
  if (candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    candidate = `${homedir()}/${candidate.slice(1).replace(/^[\\/]+/, '')}`;
  }
  let absolute;
  try {
    absolute = resolve(candidate);
  } catch {
    return failure(`Parameter "${name}" is not a usable path.`, 'BAD_PARAMS');
  }
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return failure(`Path does not exist: ${absolute}`, 'BAD_PARAMS');
  }
  if (options.allowDirectory !== true && !stat.isFile()) {
    return failure(`Path is not a file: ${absolute}`, 'BAD_PARAMS');
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    return failure(`Path is not a regular file or directory: ${absolute}`, 'BAD_PARAMS');
  }
  return { ok: true, value: absolute };
}

/**
 * Normalize a registry uninstall key (`HKLM:\...\Uninstall\Name` or `HKLM:Name`).
 * @param {unknown} raw
 * @returns {{ok: true, value: string} | {ok: false, message: string, code?: string}}
 */
function parseRegistryKey(raw) {
  if (typeof raw !== 'string') {
    return failure('Registry uninstall ids must be a string.', 'BAD_PARAMS');
  }
  const text = raw.trim();
  if (text.length === 0 || text.length > 512) {
    return failure('Registry uninstall ids must be 1-512 characters.', 'BAD_PARAMS');
  }
  const match = /^(HKLM|HKCU)(?:[:\/\\])(.*)$/i.exec(text);
  if (!match) {
    return failure(
      'Registry uninstall ids must start with "HKLM:" or "HKCU:".',
      'BAD_PARAMS',
    );
  }
  const hive = match[1].toUpperCase();
  const rest = match[2].replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  if (rest === '') return failure('Registry uninstall ids must include a key path.', 'BAD_PARAMS');
  const segments = rest.split(/[\\/]+/);
  if (segments.length === 0 || segments.length > 24) {
    return failure('Registry uninstall ids have too many path segments.', 'BAD_PARAMS');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !REGISTRY_SEGMENT_PATTERN.test(segment)) {
      return failure(`Registry uninstall id contains an invalid key segment: "${segment}".`, 'BAD_PARAMS');
    }
  }
  const lower = segments.map((segment) => segment.toLowerCase());
  const standardRoot64 = ['software', 'microsoft', 'windows', 'currentversion', 'uninstall'];
  const standardRoot32 = ['software', 'wow6432node', 'microsoft', 'windows', 'currentversion', 'uninstall'];
  const underRoot = (root) => lower.length > root.length && root.every((part, index) => lower[index] === part);
  if (!underRoot(standardRoot64) && !underRoot(standardRoot32)) {
    return failure(
      'Registry uninstall ids must live under Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall (or its WOW6432Node variant).',
      'BAD_PARAMS',
    );
  }
  return { ok: true, value: `${hive}:\\${segments.join('\\')}` };
}

/**
 * Classify `id` for `app.uninstall`: `msi:{GUID}`, `winget:<token>` or a registry key.
 * @param {object} params
 * @returns {{ok: true, value: any} | {ok: false, message: string, code?: string}}
 */
function parseUninstallId(params) {
  const raw = readString(params, 'id', { required: true, maxLength: 1024 });
  if (!raw.ok) return raw;
  const id = raw.value;
  const lower = id.toLowerCase();
  if (lower.startsWith('msi:')) {
    if (!MSI_ID_PATTERN.test(id)) {
      return failure(
        'MSI uninstall ids must look like "msi:{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}".',
        'BAD_PARAMS',
      );
    }
    return { ok: true, value: { kind: 'msi', id, guid: id.slice(4).toUpperCase() } };
  }
  if (lower.startsWith('winget:')) {
    const token = id.slice('winget:'.length);
    if (!WINGET_TOKEN_PATTERN.test(token)) {
      return failure('winget uninstall ids may only contain letters, digits and . _ + -.', 'BAD_PARAMS');
    }
    return { ok: true, value: { kind: 'winget', id, token } };
  }
  const registry = parseRegistryKey(id);
  if (!registry.ok) return registry;
  return { ok: true, value: { kind: 'registry', id, key: registry.value } };
}

/** Parse `startup:<HKCU|HKLM|HKLM32>:<ValueName>` for `system.launchAgent`. * @returns {{ok: true, value: any} | {ok: false, message: string, code?: string}}
 */
function parseLaunchAgentPath(params) {
  const raw = readString(params, 'path', { required: true, maxLength: 160 });
  if (!raw.ok) return raw;
  const match = STARTUP_PATH_PATTERN.exec(raw.value);
  if (!match) {
    return failure(
      'Startup paths must look like "startup:HKCU:<ValueName>", "startup:HKLM:<ValueName>" or "startup:HKLM32:<ValueName>".',
      'BAD_PARAMS',
    );
  }
  return { ok: true, value: { hive: match[1], name: match[2], path: raw.value } };
}

/** Parse `servers` (string or string[]) into 0-4 validated IP addresses. * @returns {{ok: true, value: any} | {ok: false, message: string, code?: string}}
 */
function readDnsServers(params) {
  const raw = params.servers;
  let list;
  if (raw === undefined || raw === null || raw === '') {
    list = [];
  } else if (typeof raw === 'string') {
    list = raw.trim() === '' ? [] : [raw.trim()];
  } else if (Array.isArray(raw)) {
    list = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        return failure('Parameter "servers" must contain only strings.', 'BAD_PARAMS');
      }
      const trimmed = entry.trim();
      if (trimmed !== '') list.push(trimmed);
    }
  } else {
    return failure('Parameter "servers" must be a string or an array of IP addresses.', 'BAD_PARAMS');
  }
  if (list.length > 4) return failure('Parameter "servers" accepts at most 4 addresses.', 'BAD_PARAMS');
  const families = new Set();
  for (const entry of list) {
    const version = isIP(entry);
    if (version === 0) {
      return failure(`"${entry}" is not a valid IP address.`, 'BAD_PARAMS');
    }
    families.add(version);
  }
  if (families.size > 1) {
    return failure('Mixing IPv4 and IPv6 servers is not supported.', 'BAD_PARAMS');
  }
  return { ok: true, value: list };
}

/**
 * Read the `ids` parameter of `cleanup.delete`: an array (or comma separated
 * string) of 1-20 unique ids from the cleanup allowlist. Unknown ids, caller
 * paths, duplicates and oversized batches are refused before any filesystem
 * call.
 * @param {object} params
 * @returns {{ok: true, value: any} | {ok: false, message: string, code?: string}}
 */
function readCleanupIds(params) {
  const raw = params.ids;
  let values;
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    values = raw.split(',');
  } else {
    return failure(
      'Parameter "ids" must be an array of cleanup item ids (or a comma separated string).',
      'BAD_PARAMS',
    );
  }
  const ids = [];
  for (const value of values) {
    if (typeof value !== 'string') return failure('Cleanup item ids must be strings.', 'BAD_PARAMS');
    const id = value.trim();
    if (id !== '') ids.push(id);
  }
  if (ids.length < 1 || ids.length > 20) {
    return failure('Parameter "ids" must contain 1 to 20 cleanup item ids.', 'BAD_PARAMS');
  }
  const known = new Set(cleanupItems().map((item) => item.id));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return failure(`Duplicate cleanup item id: ${id}`, 'BAD_PARAMS');
    seen.add(id);
    if (!known.has(id)) return failure(`Unknown cleanup item id: ${id}`, 'BAD_PARAMS');
  }
  return { ok: true, value: ids };
}

/* -------------------------------------------------------------------------- */
/* Action catalog                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Frozen action metadata plus its pure validator. `validate(params)` returns
 * `{ ok: true, value }` with the normalized value or an ActionResult failure.
 * @type {Array<object>}
 */
const SPECS = [
  {
    id: 'process.signal',
    group: 'process',
    danger: 'medium',
    requiresAdmin: false,
    params: [
      { name: 'pid', type: 'number', required: true, min: 2, max: 4294967295 },
      { name: 'signal', type: 'select', required: false, options: SIGNALS },
    ],
    /**
     * @returns {{ok: true, value: Win32Params['process.signal']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const pid = readNumber(params, 'pid', { required: true, integer: true, min: 2, max: 4294967295 });
      if (!pid.ok) return pid;
      if (pid.value === process.pid || pid.value === process.ppid) {
        return failure('Refusing to signal the Device X host process or its parent.', 'PROTECTED_PID');
      }
      const signal = readSelect(params, 'signal', { options: SIGNALS, defaultValue: 'TERM' });
      if (!signal.ok) return signal;
      return {
        ok: true,
        value: { pid: /** @type {number} */ (pid.value), signal: /** @type {Win32Signal} */ (signal.value) },
      };
    },
  },
  {
    id: 'app.quit',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'name', type: 'string', required: true, placeholder: 'Process name, e.g. Code' }],
    /**
     * @returns {{ok: true, value: Win32Params['app.quit']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const name = readString(params, 'name', {
        required: true,
        maxLength: 128,
        pattern: PROCESS_NAME_PATTERN,
        patternMessage:
          'Process names may only contain letters, digits, spaces and . _ - (1-128 characters).',
      });
      if (!name.ok) return name;
      return { ok: true, value: { name: name.value } };
    },
  },
  {
    id: 'app.launch',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'path', type: 'string', required: true, placeholder: 'C:\\Path\\app.exe' }],
    /**
     * @returns {{ok: true, value: Win32Params['app.launch']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const path = readExistingPath(params, 'path');
      if (!path.ok) return path;
      return { ok: true, value: { path: path.value } };
    },
  },
  {
    id: 'app.reveal',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'path', type: 'string', required: true, placeholder: 'C:\\Path\\item' }],
    /**
     * @returns {{ok: true, value: Win32Params['app.reveal']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const path = readExistingPath(params, 'path', { allowDirectory: true });
      if (!path.ok) return path;
      return { ok: true, value: { path: path.value } };
    },
  },
  {
    id: 'app.uninstall',
    group: 'app',
    danger: 'high',
    requiresAdmin: false,
    params: [{ name: 'id', type: 'string', required: true, placeholder: 'msi:{GUID} | winget:<id> | HKLM:\\...\\Uninstall\\...' }],
    /**
     * @returns {{ok: true, value: Win32Params['app.uninstall']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      return parseUninstallId(params);
    },
  },
  {
    id: 'system.setHostname',
    group: 'system',
    danger: 'high',
    requiresAdmin: true,
    params: [
      { name: 'kind', type: 'select', required: true, options: ['ComputerName'] },
      { name: 'value', type: 'string', required: true, placeholder: 'NEW-HOSTNAME' },
    ],
    /**
     * @returns {{ok: true, value: Win32Params['system.setHostname']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const rawKind = params.kind;
      const kind = readSelect(params, 'kind', { options: ['ComputerName'] });
      if (!kind.ok) {
        if (rawKind !== undefined && rawKind !== null && rawKind !== '') {
          return failure(
            `Unsupported hostname kind "${String(rawKind)}"; Windows only supports "ComputerName".`,
            'UNSUPPORTED_KIND',
          );
        }
        return kind;
      }
      const value = readString(params, 'value', {
        required: true,
        maxLength: 63,
        pattern: HOSTNAME_PATTERN,
        patternMessage: 'Host names may only contain letters, digits and - (1-63 characters).',
      });
      if (!value.ok) return value;
      return { ok: true, value: { kind: 'ComputerName', value: value.value } };
    },
  },
  {
    id: 'system.setVolume',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'percent', type: 'number', required: true, min: 0, max: 100 }],
    /**
     * @returns {{ok: true, value: Win32Params['system.setVolume']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const percent = readNumber(params, 'percent', { required: true, min: 0, max: 100 });
      if (!percent.ok) return percent;
      return { ok: true, value: { percent: /** @type {number} */ (percent.value) } };
    },
  },
  {
    id: 'system.setDarkMode',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'enabled', type: 'boolean', required: true }],
    /**
     * @returns {{ok: true, value: Win32Params['system.setDarkMode']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const enabled = readBoolean(params, 'enabled');
      if (!enabled.ok) return enabled;
      return { ok: true, value: { enabled: enabled.value } };
    },
  },
  {
    id: 'system.launchAgent',
    group: 'system',
    danger: 'medium',
    requiresAdmin: true,
    params: [
      { name: 'path', type: 'string', required: true, placeholder: 'startup:HKCU:ValueName' },
      { name: 'enabled', type: 'boolean', required: true },
    ],
    /**
     * @returns {{ok: true, value: Win32Params['system.launchAgent']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const path = parseLaunchAgentPath(params);
      if (!path.ok) return path;
      const enabled = readBoolean(params, 'enabled');
      if (!enabled.ok) return enabled;
      return { ok: true, value: { ...path.value, enabled: enabled.value } };
    },
  },
  {
    id: 'system.openSettings',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [{ name: 'pane', type: 'select', required: true, options: SETTINGS_PANES }],
    /**
     * @returns {{ok: true, value: Win32Params['system.openSettings']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const pane = readSelect(params, 'pane', { options: SETTINGS_PANES });
      if (!pane.ok) return pane;
      return { ok: true, value: { pane: pane.value } };
    },
  },
  {
    id: 'system.toggleFirewall',
    group: 'system',
    danger: 'high',
    requiresAdmin: true,
    params: [{ name: 'enabled', type: 'boolean', required: true }],
    /**
     * @returns {{ok: true, value: Win32Params['system.toggleFirewall']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const enabled = readBoolean(params, 'enabled');
      if (!enabled.ok) return enabled;
      return { ok: true, value: { enabled: enabled.value } };
    },
  },
  {
    id: 'system.flushDNS',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [],
    /**
     * @returns {{ok: true, value: Win32Params['system.flushDNS']} | {ok: false, message: string, code?: string}}
     */
    validate() {
      return { ok: true, value: {} };
    },
  },
  {
    id: 'system.emptyTrash',
    group: 'system',
    danger: 'medium',
    requiresAdmin: false,
    params: [],
    /**
     * @returns {{ok: true, value: Win32Params['system.emptyTrash']} | {ok: false, message: string, code?: string}}
     */
    validate() {
      return { ok: true, value: {} };
    },
  },
  {
    id: 'cleanup.delete',
    group: 'system',
    danger: 'high',
    requiresAdmin: false,
    params: [
      { name: 'ids', type: 'string', required: true, multiple: true, placeholder: 'user-temp, crash-dumps' },
    ],
    /**
     * @returns {{ok: true, value: Win32Params['cleanup.delete']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const ids = readCleanupIds(params);
      if (ids.ok !== true) return ids;
      return { ok: true, value: { ids: ids.value } };
    },
  },
  {
    id: 'network.setWifiPower',
    group: 'network',
    danger: 'medium',
    requiresAdmin: true,
    params: [{ name: 'enabled', type: 'boolean', required: true }],
    /**
     * @returns {{ok: true, value: Win32Params['network.setWifiPower']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const enabled = readBoolean(params, 'enabled');
      if (!enabled.ok) return enabled;
      return { ok: true, value: { enabled: enabled.value } };
    },
  },
  {
    id: 'network.setDns',
    group: 'network',
    danger: 'high',
    requiresAdmin: true,
    params: [
      { name: 'service', type: 'string', required: true, placeholder: 'Interface alias, e.g. Ethernet' },
      { name: 'servers', type: 'string', required: false, placeholder: '1.1.1.1, 8.8.8.8' },
    ],
    /**
     * @returns {{ok: true, value: Win32Params['network.setDns']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const service = readString(params, 'service', { required: true, maxLength: 256 });
      if (!service.ok) return service;
      const servers = readDnsServers(params);
      if (!servers.ok) return servers;
      return { ok: true, value: { service: service.value, servers: servers.value } };
    },
  },
  {
    id: 'power.sleep',
    group: 'power',
    danger: 'low',
    requiresAdmin: false,
    params: [],
    /**
     * @returns {{ok: true, value: Win32Params['power.sleep']} | {ok: false, message: string, code?: string}}
     */
    validate() {
      return { ok: true, value: {} };
    },
  },
  {
    id: 'power.lock',
    group: 'power',
    danger: 'low',
    requiresAdmin: false,
    params: [],
    /**
     * @returns {{ok: true, value: Win32Params['power.lock']} | {ok: false, message: string, code?: string}}
     */
    validate() {
      return { ok: true, value: {} };
    },
  },
  {
    id: 'software.wingetUninstall',
    group: 'software',
    danger: 'medium',
    requiresAdmin: false,
    params: [{ name: 'id', type: 'string', required: true, placeholder: 'Publisher.Package' }],
    /**
     * @returns {{ok: true, value: Win32Params['software.wingetUninstall']} | {ok: false, message: string, code?: string}}
     */
    validate(params) {
      const id = readString(params, 'id', {
        required: true,
        maxLength: 200,
        pattern: WINGET_TOKEN_PATTERN,
        patternMessage: 'winget package ids may only contain letters, digits and . _ + - (1-200 characters).',
      });
      if (!id.ok) return id;
      return { ok: true, value: { id: id.value } };
    },
  },
];

/** @type {Map<string, object>} */
const SPEC_BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

/* -------------------------------------------------------------------------- */
/* Runners: one constant PowerShell script per action                        */
/* -------------------------------------------------------------------------- */

/** Counter feeding unique inline CoreAudio type names (one per process call). */
let volumeSerial = 0;

/**
 * `system.setVolume`: inline C# CoreAudio interop. Each call compiles a
 * uniquely named type because `Add-Type` cannot re-add the same type name.
 * @returns {string} PowerShell script.
 */
function setVolumeScript() {
  volumeSerial += 1;
  const typeName = `DeviceXVolumeAction${volumeSerial}`;
  const source = [
    'using System;',
    'using System.Runtime.InteropServices;',
    '',
    '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
    'internal class MMDeviceEnumeratorComObject { }',
    '',
    'internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }',
    'internal enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }',
    '',
    '[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]',
    'internal interface IMMDeviceEnumerator',
    '{',
    '    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);',
    '    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);',
    '}',
    '',
    '[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]',
    'internal interface IMMDevice',
    '{',
    '    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);',
    '}',
    '',
    '[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]',
    'internal interface IAudioEndpointVolume',
    '{',
    '    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);',
    '    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);',
    '    [PreserveSig] int GetChannelCount(out uint channelCount);',
    '    [PreserveSig] int SetMasterVolumeLevel(float level, Guid eventContext);',
    '    [PreserveSig] int SetMasterVolumeLevelScalar(float level, Guid eventContext);',
    '}',
    '',
    `public static class ${typeName}`,
    '{',
    '    public static int SetVolume(float scalar)',
    '    {',
    '        if (scalar < 0f) { scalar = 0f; }',
    '        if (scalar > 1f) { scalar = 1f; }',
    '        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());',
    '        IMMDevice device;',
    '        int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out device);',
    '        if (hr != 0) { return hr; }',
    '        Guid iid = typeof(IAudioEndpointVolume).GUID;',
    '        object raw;',
    '        hr = device.Activate(ref iid, 23, IntPtr.Zero, out raw);',
    '        if (hr != 0) { return hr; }',
    '        IAudioEndpointVolume volume = (IAudioEndpointVolume)raw;',
    '        return volume.SetMasterVolumeLevelScalar(scalar, Guid.Empty);',
    '    }',
    '}',
  ].join('\n');
  return `${PS_HEAD}
$source = @'
${source}
'@;
Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop;
$scalar = [float]([double]$env:DEVICEX_ARG_PERCENT / 100.0);
$hr = [${typeName}]::SetVolume($scalar);
if ($hr -ne 0) { throw ("CoreAudio SetMasterVolumeLevelScalar failed with HRESULT 0x{0:X8}." -f $hr) }
@{ok=$true; percent=[int]$env:DEVICEX_ARG_PERCENT} | ConvertTo-Json -Compress`;
}

/** `msi:{GUID}` uninstall via msiexec (3010/1641 = success, reboot required). */
async function uninstallMsi({ id, guid }) {
  const script = `${PS_HEAD}
$proc = Start-Process -FilePath ${psString('msiexec.exe')} -ArgumentList @('/x', $env:DEVICEX_ARG_GUID, '/qn') -Wait -PassThru -ErrorAction Stop;
if ($proc.ExitCode -notin 0,3010,1641) { throw "msiexec exited with code $($proc.ExitCode)." }
@{ok=$true; exitCode=$proc.ExitCode} | ConvertTo-Json -Compress`;
  const result = await runPSJson(script, { env: envOf({ GUID: guid }), timeout: 180_000 });
  if (!result.ok) return commandFailure('MSI uninstall', result);
  const exitCode = Number(result.data?.exitCode ?? 0);
  const restartRequired = exitCode === 3010 || exitCode === 1641;
  return success(
    restartRequired
      ? `Uninstalled MSI package ${guid}; a restart is required to finish the uninstall.`
      : `Uninstalled MSI package ${guid}.`,
    { id, guid, exitCode, restartRequired },
  );
}

/** `winget:<id>` / software.wingetUninstall through winget.exe. */
async function uninstallWinget({ token, id }, packageAgreements) {
  const flags = packageAgreements ? ' --accept-package-agreements' : '';
  const script = `${PS_HEAD}
$output = (& ${psString('winget.exe')} uninstall --id $env:DEVICEX_ARG_ID --silent --accept-source-agreements${flags} 2>&1 | Out-String).Trim();
if ($LASTEXITCODE -ne 0) { throw ("winget uninstall failed with exit code {0}: {1}" -f $LASTEXITCODE, $output.Substring(0, [Math]::Min(400, $output.Length))) }
@{ok=$true} | ConvertTo-Json -Compress`;
  const result = await runPSJson(script, { env: envOf({ ID: token }), timeout: 180_000 });
  if (!result.ok) return commandFailure('winget uninstall', result);
  return success(`Uninstalled "${token}" with winget.`, { id, token });
}

/** Registry `Uninstall` key uninstall: read the entry, run it without a shell. */
async function uninstallRegistry({ id, key }) {
  const script = `${PS_HEAD}
$key = $env:DEVICEX_ARG_KEY;
$entry = Get-ItemProperty -LiteralPath $key -ErrorAction Stop;
$displayName = [string]$entry.DisplayName;
if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = Split-Path -Leaf $key }
$uninstall = [string]$entry.UninstallString;
if ([string]::IsNullOrWhiteSpace($uninstall)) { throw "No UninstallString is stored under '$key'." }
$msi = [regex]::Match($uninstall, '(?i)^\\s*"?MsiExec\\.exe"?\\s+(?:/|-)(?:i|x)\\s*(\\{[0-9A-Fa-f-]{36}\\})');
if ($msi.Success) {
  $guid = $msi.Groups[1].Value;
  $proc = Start-Process -FilePath ${psString('msiexec.exe')} -ArgumentList @('/x', $guid, '/qn') -Wait -PassThru -ErrorAction Stop;
  if ($proc.ExitCode -notin 0,3010,1641) { throw "msiexec exited with code $($proc.ExitCode)." }
  $command = "msiexec.exe /x $guid /qn";
  $exitCode = $proc.ExitCode;
} else {
  $quoted = [regex]::Match($uninstall, '^\\s*"([^"]+)"\\s*(.*)$');
  if ($quoted.Success) {
    $exe = $quoted.Groups[1].Value;
    $arguments = $quoted.Groups[2].Value;
  } else {
    $exeMatch = [regex]::Match($uninstall, '(?i)^\\s*(.+?\\.exe)(?:\\s+(.*))?$');
    if ($exeMatch.Success) {
      $exe = $exeMatch.Groups[1].Value;
      $arguments = $exeMatch.Groups[2].Value;
    } else {
      $parts = $uninstall.Trim() -split '\\s+', 2;
      $exe = $parts[0];
      if ($parts.Count -gt 1) { $arguments = $parts[1] }
    }
  }
  if ([string]::IsNullOrWhiteSpace($exe)) { throw 'Could not parse the stored UninstallString.' }
  $startArgs = @{ FilePath = $exe.Trim('"'); Wait = $true; PassThru = $true; ErrorAction = 'Stop' };
  if (-not [string]::IsNullOrWhiteSpace($arguments)) { $startArgs.ArgumentList = $arguments.Trim() }
  $proc = Start-Process @startArgs;
  if ($proc.ExitCode -notin 0,3010,1641) { throw "The uninstaller exited with code $($proc.ExitCode)." }
  $command = $uninstall;
  $exitCode = $proc.ExitCode;
}
@{displayName=$displayName; command=$command; exitCode=$exitCode} | ConvertTo-Json -Compress`;
  const result = await runPSJson(script, { env: envOf({ KEY: key }), timeout: 180_000 });
  if (!result.ok) return commandFailure('Uninstall from registry', result);
  const displayName = String(result.data?.displayName ?? key);
  const exitCode = Number(result.data?.exitCode ?? 0);
  const restartRequired = exitCode === 3010 || exitCode === 1641;
  return success(
    restartRequired
      ? `Uninstalled "${displayName}"; a restart is required to finish the uninstall.`
      : `Uninstalled "${displayName}".`,
    {
      id,
      key,
      displayName,
      command: String(result.data?.command ?? ''),
      exitCode,
      restartRequired,
    },
  );
}

/** Validators already ran; each runner receives the normalized value object. */
const RUNNERS = {
  'process.signal': async ({ pid, signal }) => {
    const script = `${PS_HEAD}
$force = $env:DEVICEX_ARG_SIGNAL -ne 'TERM';
Stop-Process -Id ([int]$env:DEVICEX_ARG_PID) -Force:$force -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ PID: pid, SIGNAL: signal }) });
    if (!result.ok) return commandFailure(`Signal process ${pid}`, result);
    return success(`Sent ${signal} to process ${pid}.`, { pid, signal });
  },
  'app.quit': async ({ name }) => {
    const script = `${PS_HEAD}
$name = $env:DEVICEX_ARG_NAME;
$processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue);
if ($processes.Count -eq 0) { throw "No running process named '$name' was found." }
$processes | Stop-Process -ErrorAction Stop;
@{count=$processes.Count} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ NAME: name }) });
    if (!result.ok) return commandFailure(`Quit application "${name}"`, result);
    const matched = Number(result.data?.count ?? 0);
    return success(`Closed "${name}".`, { name, matched });
  },
  'app.launch': async ({ path }) => {
    const script = `${PS_HEAD}
Start-Process -FilePath $env:DEVICEX_ARG_PATH -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ PATH: path }) });
    if (!result.ok) return commandFailure(`Launch "${path}"`, result);
    return success(`Launched "${path}".`, { path });
  },
  'app.reveal': async ({ path }) => {
    const script = `${PS_HEAD}
$target = $env:DEVICEX_ARG_PATH;
Start-Process -FilePath ${psString('explorer.exe')} -ArgumentList ('/select,"' + $target + '"') -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ PATH: path }) });
    if (!result.ok) return commandFailure(`Reveal "${path}"`, result);
    return success(`Revealed "${path}" in File Explorer.`, { path });
  },
  'app.uninstall': async (value) => {
    if (value.kind === 'msi') return uninstallMsi(value);
    if (value.kind === 'winget') return uninstallWinget(value, true);
    return uninstallRegistry(value);
  },
  'system.setHostname': async ({ value }) => {
    const script = `${PS_HEAD}
Rename-Computer -NewName $env:DEVICEX_ARG_VALUE -Force -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ VALUE: value }) });
    if (!result.ok) return commandFailure('Rename computer', result);
    return success(
      `Renamed this computer to "${value}". A restart is required for the change to take effect.`,
      { kind: 'ComputerName', value, restartRequired: true },
    );
  },
  'system.setVolume': async ({ percent }) => {
    const result = await runPSJson(setVolumeScript(), { env: envOf({ PERCENT: percent }) });
    if (!result.ok) return commandFailure('Set system volume', result);
    return success(`Set the system volume to ${percent}%.`, { percent });
  },
  'system.setDarkMode': async ({ enabled }) => {
    const script = `${PS_HEAD}
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
$value = if ($env:DEVICEX_ARG_ENABLED -eq 'true') { 0 } else { 1 };
New-ItemProperty -LiteralPath $key -Name 'AppsUseLightTheme' -Value $value -PropertyType DWord -Force | Out-Null;
New-ItemProperty -LiteralPath $key -Name 'SystemUsesLightTheme' -Value $value -PropertyType DWord -Force | Out-Null;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ ENABLED: enabled }) });
    if (!result.ok) return commandFailure('Toggle dark mode', result);
    return success(`Dark mode ${enabled ? 'enabled' : 'disabled'}.`, { enabled });
  },
  'system.launchAgent': async ({ hive, name, path, enabled }) => {
    const script = `${PS_HEAD}
$hive = $env:DEVICEX_ARG_HIVE;
$name = $env:DEVICEX_ARG_NAME;
$escapedName = [WildcardPattern]::Escape($name);
$enable = $env:DEVICEX_ARG_ENABLED -eq 'true';
$runKey = switch ($hive) {
  'HKLM' { 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' }
  'HKLM32' { 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run' }
  default { 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' }
};
$disabledRoot = 'HKCU:\\Software\\DeviceX\\DisabledStartup';
$disabledKey = Join-Path $disabledRoot $hive;
if ($enable) {
  if (-not (Test-Path -LiteralPath $disabledKey)) { throw "No disabled startup entry named '$name' is stored for $hive." }
  $stored = Get-ItemProperty -LiteralPath $disabledKey -ErrorAction Stop;
  $prop = $stored.PSObject.Properties[$name];
  if ($null -eq $prop) { throw "No disabled startup entry named '$name' is stored for $hive." }
  if (-not (Test-Path -LiteralPath $runKey)) { New-Item -Path $runKey -Force | Out-Null }
  New-ItemProperty -LiteralPath $runKey -Name $name -Value ([string]$prop.Value) -PropertyType String -Force | Out-Null;
  Remove-ItemProperty -LiteralPath $disabledKey -Name $escapedName -ErrorAction Stop;
} else {
  $current = Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue;
  $prop = if ($null -eq $current) { $null } else { $current.PSObject.Properties[$name] };
  if ($null -eq $prop -or [string]::IsNullOrWhiteSpace([string]$prop.Value)) { throw "No startup entry named '$name' exists for $hive." }
  if (-not (Test-Path -LiteralPath $disabledKey)) { New-Item -Path $disabledKey -Force | Out-Null }
  New-ItemProperty -LiteralPath $disabledKey -Name $name -Value ([string]$prop.Value) -PropertyType String -Force | Out-Null;
  Remove-ItemProperty -LiteralPath $runKey -Name $escapedName -ErrorAction Stop;
}
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, {
      env: envOf({ HIVE: hive, NAME: name, PATH: path, ENABLED: enabled }),
    });
    if (!result.ok) return commandFailure(`Toggle startup entry "${name}"`, result);
    return success(
      `Startup entry "${name}" ${enabled ? 'enabled' : 'disabled'} for ${hive}. It takes effect at the next sign-in.`,
      { path, hive, name, enabled },
    );
  },
  'system.openSettings': async ({ pane }) => {
    const uri = `ms-settings:${PANE_URIS[pane] ?? pane}`;
    const script = `${PS_HEAD}
Start-Process -FilePath $env:DEVICEX_ARG_URI -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ URI: uri }) });
    if (!result.ok) return commandFailure(`Open settings pane "${pane}"`, result);
    return success(`Opened Windows Settings: ${pane}.`, { pane, uri });
  },
  'system.toggleFirewall': async ({ enabled }) => {
    const script = `${PS_HEAD}
$enabled = $env:DEVICEX_ARG_ENABLED -eq 'true';
Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled $enabled -ErrorAction Stop | Out-Null;
@{ok=$true; enabled=$enabled} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ ENABLED: enabled }) });
    if (!result.ok) return commandFailure('Toggle Windows Firewall', result);
    return success(
      `Windows Firewall ${enabled ? 'enabled' : 'disabled'} for the Domain, Private and Public profiles.`,
      { enabled },
    );
  },
  'system.flushDNS': async () => {
    const script = `${PS_HEAD}
try {
  Clear-DnsClientCache -ErrorAction Stop;
  $method = 'Clear-DnsClientCache';
} catch {
  & ${psString('ipconfig.exe')} /flushdns | Out-Null;
  if ($LASTEXITCODE -ne 0) { throw "ipconfig /flushdns failed with exit code $LASTEXITCODE." }
  $method = 'ipconfig /flushdns';
}
@{method=$method} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script);
    if (!result.ok) return commandFailure('Flush DNS cache', result);
    return success('Flushed the DNS resolver cache.', { method: String(result.data?.method ?? 'Clear-DnsClientCache') });
  },
  'system.emptyTrash': async () => {
    // Locale-independent emptiness probe first (the localized Clear-RecycleBin
    // error text differs per language); the English message match stays only as
    // a last-resort fallback inside catch.
    const script = `${PS_HEAD}
$alreadyEmpty = $false;
$shell = New-Object -ComObject Shell.Application;
try {
  $bin = $shell.Namespace(0xA);
  if ($null -ne $bin -and @($bin.Items()).Count -eq 0) { $alreadyEmpty = $true }
  if (-not $alreadyEmpty) {
    try {
      Clear-RecycleBin -Force -ErrorAction Stop;
    } catch {
      if ($null -ne $shell.Namespace(0xA) -and @($shell.Namespace(0xA).Items()).Count -eq 0) { $alreadyEmpty = $true }
      elseif ([string]$_.Exception.Message -match '(?i)empty') { $alreadyEmpty = $true }
      else { throw }
    }
  }
} finally {
  if ($null -ne $shell) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
@{alreadyEmpty=$alreadyEmpty} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script);
    if (!result.ok) return commandFailure('Empty the Recycle Bin', result);
    if (result.data?.alreadyEmpty === true) {
      return success('Recycle Bin is already empty.', { alreadyEmpty: true });
    }
    return success('Emptied the Recycle Bin.');
  },
  'cleanup.delete': async ({ ids }) => {
    // The cleanup module owns the allowlist and the fixed absolute paths: the
    // action passes ids only, never a path, and reports per-item outcomes.
    return deleteCleanup(ids);
  },
  'network.setWifiPower': async ({ enabled }) => {
    const script = `${PS_HEAD}
$enabled = $env:DEVICEX_ARG_ENABLED -eq 'true';
$adapter = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN' -or $_.NdisPhysicalMedium -in 1,8,9,12 } | Select-Object -First 1;
if ($null -eq $adapter) { throw 'No physical wireless adapter was found.' }
if ($enabled) { Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null } else { Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null }
@{adapter=$adapter.Name; enabled=$enabled} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ ENABLED: enabled }) });
    if (!result.ok) return commandFailure(`Turn Wi-Fi ${enabled ? 'on' : 'off'}`, result);
    const adapter = String(result.data?.adapter ?? 'wireless adapter');
    return success(`Wi-Fi adapter "${adapter}" ${enabled ? 'enabled' : 'disabled'}.`, { adapter, enabled });
  },
  'network.setDns': async ({ service, servers }) => {
    const script = `${PS_HEAD}
$service = $env:DEVICEX_ARG_SERVICE;
$adapters = @(Get-NetAdapter -Name $service -ErrorAction Stop | Where-Object { $_.Name -eq $service });
if ($adapters.Count -eq 0) { throw "Network adapter '$service' was not found." }
if ($adapters.Count -gt 1) { throw "More than one network adapter is named '$service'." }
$index = $adapters[0].ifIndex;
$addresses = @($env:DEVICEX_ARG_SERVERS -split '\\|' | Where-Object { $_ -ne '' });
if ($addresses.Count -eq 0) {
  Set-DnsClientServerAddress -InterfaceIndex $index -ResetServerAddresses -ErrorAction Stop;
} else {
  Set-DnsClientServerAddress -InterfaceIndex $index -ServerAddresses $addresses -ErrorAction Stop;
}
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script, { env: envOf({ SERVICE: service, SERVERS: servers.join('|') }) });
    if (!result.ok) return commandFailure(`Set DNS servers for "${service}"`, result);
    if (servers.length === 0) {
      return success(`Cleared custom DNS servers for "${service}".`, { service, servers: [] });
    }
    return success(`Set DNS servers for "${service}" to ${servers.join(', ')}.`, { service, servers });
  },
  'power.sleep': async () => {
    // Success is signalled by the parsed JSON document, not the process exit
    // code: with `-Command -` a terminating error can reach stderr while the
    // host still exits 0.
    const script = `${PS_HEAD}
Start-Process -FilePath ${psString('rundll32.exe')} -ArgumentList 'powrprof.dll,SetSuspendState','0,1,0' -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script);
    if (!result.ok) return commandFailure('Sleep', result);
    return success(
      'Requested system sleep. (SetSuspendState follows the system power policy, so this may hibernate instead of sleep.)',
    );
  },
  'power.lock': async () => {
    const script = `${PS_HEAD}
Start-Process -FilePath ${psString('rundll32.exe')} -ArgumentList 'user32.dll,LockWorkStation' -ErrorAction Stop;
@{ok=$true} | ConvertTo-Json -Compress`;
    const result = await runPSJson(script);
    if (!result.ok) return commandFailure('Lock the workstation', result);
    return success('Locked the workstation.');
  },
  'software.wingetUninstall': async ({ id }) => uninstallWinget({ token: id, id }, false),
};

/* -------------------------------------------------------------------------- */
/* History and public API                                                     */
/* -------------------------------------------------------------------------- */

/** @type {Array<{ts: number, id: string, params: object, ok: boolean, message: string}>} */
const history = [];

/**
 * @param {{ts: number, id: string, params: object, ok: boolean, message: string}} entry
 * @returns {void}
 */
function recordHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

/**
 * The frozen action catalog, in stable order.
 * @returns {Array<{id: string, group: string, danger: string,
 *   requiresAdmin: boolean, params: object[]}>}
 */
export function actionCatalog() {
  return SPECS.map((spec) => ({
    id: spec.id,
    group: spec.group,
    danger: spec.danger,
    requiresAdmin: spec.requiresAdmin,
    params: spec.params.map((descriptor) => ({
      ...descriptor,
      ...(descriptor.options ? { options: [...descriptor.options] } : {}),
    })),
  }));
}

/**
 * Attempted actions, newest first, at most 50 entries.
 * @returns {Array<{ts: number, id: string, params: object, ok: boolean, message: string}>}
 */
export function actionHistory() {
  return history.map((entry) => ({
    ts: entry.ts,
    id: entry.id,
    params: jsonSafe(entry.params),
    ok: entry.ok,
    message: entry.message,
  }));
}

/**
 * Validate and execute one action. Never throws for bad input; every attempt
 * (success or failure) is appended to the history.
 *
 * @param {string} id action id from {@link actionCatalog}
 * @param {object} [params]
 * @returns {Promise<{ok: boolean, message: string, data?: object, code?: string}>}
 */
export async function runAction(id, params) {
  const ts = Date.now();
  const actionId = typeof id === 'string' ? id : String(id);
  const requestParams = paramsObject(jsonSafe(params));
  let result;
  try {
    const spec = SPEC_BY_ID.get(actionId);
    const runner = RUNNERS[actionId];
    if (!spec || !runner) {
      result = failure(`Unknown action: ${actionId}`, 'UNKNOWN_ACTION');
    } else {
      const checked = spec.validate(requestParams);
      if (checked.ok !== true) {
        result = checked;
      } else {
        const candidate = await runner(checked.value);
        result =
          candidate && typeof candidate === 'object' && typeof candidate.ok === 'boolean'
            ? {
                ok: candidate.ok === true,
                message: String(candidate.message ?? ''),
                ...(candidate.data ? { data: jsonSafe(candidate.data) } : {}),
                ...(candidate.code ? { code: String(candidate.code) } : {}),
              }
            : failure('Action returned an invalid result.', 'INTERNAL');
      }
    }
  } catch (error) {
    result = failure(
      `Action failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      'INTERNAL',
    );
  }
  recordHistory({ ts, id: actionId, params: requestParams, ok: result.ok === true, message: result.message });
  return /** @type {any} */ (jsonSafe(result));
}

/**
 * Test seam for the offline Windows verification script: pure validators and
 * catalog ids, no PowerShell involved.
 *
 * `validators[id](params)` returns `null` when valid or the error string when
 * not (pure, synchronous, never spawns a process). `validate[id](params)` is
 * the underlying normalized-result form.
 */
export const __test = {
  actionIds: SPECS.map((spec) => spec.id),
  validators: Object.fromEntries(
    SPECS.map((spec) => [
      spec.id,
      (params) => {
        const checked = spec.validate(paramsObject(params));
        return checked.ok === true ? null : String(checked.message);
      },
    ]),
  ),
  validate: Object.fromEntries(
    SPECS.map((spec) => [spec.id, (params) => spec.validate(paramsObject(params))]),
  ),
  guards: { parseRegistryKey, parseUninstallId, parseLaunchAgentPath, readDnsServers, readExistingPath, readCleanupIds },
};
