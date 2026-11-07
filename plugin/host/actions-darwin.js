/**
 * Device X — whitelisted device action engine.
 *
 * Every operation is implemented with argv-only `execFile` / `process.kill` /
 * `fs` calls (never a shell string), validates its parameters strictly, and
 * returns a JSON-safe result. `runAction` never throws for bad input.
 *
 * Plain Node ESM; `node:*` imports only (plus the sibling process helper).
 *
 * @module @cfour-hi/dsh-devicex/host/actions
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { cleanupItems, deleteCleanup } from './cleanup-darwin.js';
import { run } from './proc.js';

/** Action groups, in UI order. */
export const GROUPS = ['process', 'app', 'system', 'network', 'software', 'power'];

/** Maximum retained history entries. */
const HISTORY_LIMIT = 50;

/* -------------------------------------------------------------------------- */
/* Command paths                                                              */
/* -------------------------------------------------------------------------- */

const OSASCRIPT = '/usr/bin/osascript';
const OPEN = '/usr/bin/open';
const SCUTIL = '/usr/sbin/scutil';
const LAUNCHCTL = '/bin/launchctl';
const NETWORKSETUP = '/usr/sbin/networksetup';
const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';
const DSCACHEUTIL = '/usr/bin/dscacheutil';
const PMSET = '/usr/bin/pmset';
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];

/** AppleScript-visible System Settings anchors for `system.openSettings`. */
const SETTINGS_PANES = {
  wifi: 'com.apple.wifi-settings-extension',
  network: 'com.apple.network-settings-extension',
  bluetooth: 'com.apple.BluetoothSettings',
  sound: 'com.apple.Sound-Settings.extension',
  display: 'com.apple.Displays-Settings.extension',
  appearance: 'com.apple.Appearance-Settings.extension',
  wallpaper: 'com.apple.Wallpaper-Settings.extension',
  battery: 'com.apple.Battery-Settings.extension',
  general: 'com.apple.General-Settings.extension',
  privacy: 'com.apple.PrivacySecurity.extension',
  users: 'com.apple.Users-Groups-Settings.extension',
  keyboard: 'com.apple.Keyboard-Settings.extension',
  mouse: 'com.apple.Mouse-Settings.extension',
  trackpad: 'com.apple.Trackpad-Settings.extension',
  notifications: 'com.apple.Notifications-Settings.extension',
  softwareupdate: 'com.apple.Software-Update-Settings.extension',
  storage: 'com.apple.Storage-Settings.extension',
  datetime: 'com.apple.Date-Time-Settings.extension',
  language: 'com.apple.Localization-Settings.extension',
  sharing: 'com.apple.Sharing-Settings.extension',
  loginitems: 'com.apple.LoginItems-Settings.extension',
};

/** Supported POSIX signals for `process.signal`. */
const SIGNAL_NAMES = new Map([
  ['TERM', 'SIGTERM'],
  ['KILL', 'SIGKILL'],
  ['INT', 'SIGINT'],
  ['STOP', 'SIGSTOP'],
  ['CONT', 'SIGCONT'],
]);

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9.-]{1,63}$/;
const BREW_TOKEN_PATTERN = /^[A-Za-z0-9@+._/-]+$/;

/* -------------------------------------------------------------------------- */
/* JSON safety                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Deep JSON-safe clone (undefined → null, non-finite → null, cycles → null).
 * @param {unknown} value
 * @param {Set<object>} [seen]
 * @returns {any}
 */
function jsonSafe(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => jsonSafe(item, seen));
  } else if (value instanceof Date) {
    const time = value.getTime();
    result = Number.isFinite(time) ? time : null;
  } else {
    result = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonSafe(item, seen);
  }
  seen.delete(value);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Action catalog (frozen order and ids)                                      */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} ActionParam
 * @property {string} name
 * @property {'number'|'string'|'boolean'|'select'} type
 * @property {boolean} required
 * @property {string[]} [options]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [placeholder]
 * @property {boolean} [multiple] true when the client sends an array of values.
 */

/**
 * Build a parameter descriptor, dropping absent optional fields so the JSON
 * shape stays exactly the contract's.
 * @param {string} name
 * @param {'number'|'string'|'boolean'|'select'} type
 * @param {object} [options]
 * @returns {ActionParam}
 */
function param(name, type, options = {}) {
  /** @type {ActionParam} */
  const descriptor = { name, type, required: options.required !== false };
  if (Array.isArray(options.options)) descriptor.options = [...options.options];
  if (typeof options.min === 'number') descriptor.min = options.min;
  if (typeof options.max === 'number') descriptor.max = options.max;
  if (typeof options.placeholder === 'string') descriptor.placeholder = options.placeholder;
  if (options.multiple === true) descriptor.multiple = true;
  return descriptor;
}

/** The frozen action table, in contract order. */
const SPECS = [
  {
    id: 'process.signal',
    group: 'process',
    danger: 'medium',
    requiresAdmin: false,
    params: [
      param('pid', 'number', { min: 2, max: 4_194_304, placeholder: '1234' }),
      param('signal', 'select', {
        required: false,
        options: [...SIGNAL_NAMES.keys()],
        placeholder: 'TERM',
      }),
    ],
  },
  {
    id: 'app.quit',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [param('name', 'string', { placeholder: 'Safari' })],
  },
  {
    id: 'app.launch',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [param('path', 'string', { placeholder: '/Applications/Safari.app' })],
  },
  {
    id: 'app.reveal',
    group: 'app',
    danger: 'low',
    requiresAdmin: false,
    params: [param('path', 'string', { placeholder: '/Applications/Safari.app' })],
  },
  {
    id: 'app.uninstall',
    group: 'app',
    danger: 'high',
    requiresAdmin: false,
    params: [
      param('path', 'string', { placeholder: '/Applications/SomeApp.app' }),
      param('mode', 'select', { required: false, options: ['trash', 'delete'], placeholder: 'trash' }),
    ],
  },
  {
    id: 'system.setHostname',
    group: 'system',
    danger: 'medium',
    requiresAdmin: true,
    params: [
      param('kind', 'select', { options: ['HostName', 'ComputerName', 'LocalHostName'], placeholder: 'ComputerName' }),
      param('value', 'string', { placeholder: 'My-MacBook' }),
    ],
  },
  {
    id: 'system.setVolume',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [param('percent', 'number', { min: 0, max: 100, placeholder: '50' })],
  },
  {
    id: 'system.setDarkMode',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [param('enabled', 'boolean', { placeholder: 'true' })],
  },
  {
    id: 'system.launchAgent',
    group: 'system',
    danger: 'medium',
    requiresAdmin: true,
    params: [
      param('path', 'string', { placeholder: '~/Library/LaunchAgents/com.example.agent.plist' }),
      param('enabled', 'boolean', { placeholder: 'true' }),
    ],
  },
  {
    id: 'system.openSettings',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [param('pane', 'select', { options: Object.keys(SETTINGS_PANES), placeholder: 'wifi' })],
  },
  {
    id: 'system.toggleFirewall',
    group: 'system',
    danger: 'medium',
    requiresAdmin: true,
    params: [param('enabled', 'boolean', { placeholder: 'true' })],
  },
  {
    id: 'system.flushDNS',
    group: 'system',
    danger: 'low',
    requiresAdmin: false,
    params: [],
  },
  {
    id: 'system.emptyTrash',
    group: 'system',
    danger: 'medium',
    requiresAdmin: false,
    params: [],
  },
  {
    id: 'cleanup.delete',
    group: 'system',
    danger: 'high',
    requiresAdmin: false,
    params: [param('ids', 'string', { multiple: true, placeholder: 'user-caches, user-logs' })],
  },
  {
    id: 'network.setWifiPower',
    group: 'network',
    danger: 'medium',
    requiresAdmin: false,
    params: [param('enabled', 'boolean', { placeholder: 'true' })],
  },
  {
    id: 'network.setDns',
    group: 'network',
    danger: 'medium',
    requiresAdmin: true,
    params: [
      param('service', 'string', { placeholder: 'Wi-Fi' }),
      param('servers', 'string', { placeholder: '8.8.8.8, 1.1.1.1' }),
    ],
  },
  {
    id: 'power.sleep',
    group: 'power',
    danger: 'low',
    requiresAdmin: false,
    params: [],
  },
  {
    id: 'power.lock',
    group: 'power',
    danger: 'low',
    requiresAdmin: false,
    params: [],
  },
  {
    id: 'software.brewUninstall',
    group: 'software',
    danger: 'medium',
    requiresAdmin: false,
    params: [param('name', 'string', { placeholder: 'wget' })],
  },
];

const SPEC_BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

/* -------------------------------------------------------------------------- */
/* History                                                                    */
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

/* -------------------------------------------------------------------------- */
/* Result / validation helpers                                                */
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
  return data && typeof data === 'object' && Object.keys(data).length
    ? { ok: true, message, data: jsonSafe(data) }
    : { ok: true, message };
}

/**
 * Turn a failed command result into an ActionResult carrying stderr.
 * @param {string} action
 * @param {Awaited<ReturnType<typeof run>>} result
 * @param {string} [code]
 * @returns {{ok: false, message: string, code?: string}}
 */
function commandFailure(action, result, code) {
  const detail = (result.stderr || result.error || `exit code ${String(result.code)}`).trim();
  const suffix = result.timedOut ? ' (timed out)' : '';
  return failure(`${action} failed: ${detail || 'unknown error'}${suffix}`, code ?? 'COMMAND_FAILED');
}

/**
 * Read a required integer parameter.
 * @param {Record<string, unknown>} params
 * @param {string} name
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {{ok: true, value: number} | {ok: false, message: string}}
 */
function readInteger(params, name, bounds = {}) {
  const raw = params[name];
  let value = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
  else if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) value = Number(raw.trim());
  if (value === null || !Number.isInteger(value)) {
    return { ok: false, message: `Parameter "${name}" must be an integer.` };
  }
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = bounds;
  if (value < min || value > max) {
    return { ok: false, message: `Parameter "${name}" must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

/**
 * Read a required number parameter.
 * @param {Record<string, unknown>} params
 * @param {string} name
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {{ok: true, value: number} | {ok: false, message: string}}
 */
function readNumber(params, name, bounds = {}) {
  const raw = params[name];
  let value = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
  else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) value = Number(raw);
  if (value === null) return { ok: false, message: `Parameter "${name}" must be a number.` };
  const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = bounds;
  if (value < min || value > max) {
    return { ok: false, message: `Parameter "${name}" must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

/**
 * Read a required string parameter.
 * @param {Record<string, unknown>} params
 * @param {string} name
 * @param {{maxLength?: number, allowControlChars?: boolean}} [options]
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function readString(params, name, options = {}) {
  const raw = params[name];
  const { maxLength = 1_024, allowControlChars = false } = options;
  if (typeof raw !== 'string') return { ok: false, message: `Parameter "${name}" must be a string.` };
  const value = raw.trim();
  if (value === '') return { ok: false, message: `Parameter "${name}" must not be empty.` };
  if (value.length > maxLength) {
    return { ok: false, message: `Parameter "${name}" must be at most ${maxLength} characters.` };
  }
  if (!allowControlChars && CONTROL_CHARS.test(value)) {
    return { ok: false, message: `Parameter "${name}" must not contain control characters.` };
  }
  return { ok: true, value };
}

/**
 * Read a required boolean parameter (accepts `true`/`false` and their string
 * spellings from an HTML form).
 * @param {Record<string, unknown>} params
 * @param {string} name
 * @returns {{ok: true, value: boolean} | {ok: false, message: string}}
 */
function readBoolean(params, name) {
  const raw = params[name];
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw === 'true' || raw === '1' || raw === 1) return { ok: true, value: true };
  if (raw === 'false' || raw === '0' || raw === 0) return { ok: true, value: false };
  return { ok: false, message: `Parameter "${name}" must be a boolean.` };
}

/**
 * Read a required select parameter.
 * @param {Record<string, unknown>} params
 * @param {string} name
 * @param {readonly string[]} options
 * @param {string} [fallback] default when absent.
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function readSelect(params, name, options, fallback) {
  const raw = params[name];
  if ((raw === undefined || raw === null || raw === '') && fallback !== undefined) {
    return { ok: true, value: fallback };
  }
  if (typeof raw !== 'string' || !options.includes(raw)) {
    return { ok: false, message: `Parameter "${name}" must be one of: ${options.join(', ')}.` };
  }
  return { ok: true, value: raw };
}

/**
 * Normalise the request's params object.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function paramsObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

/**
 * Read the `ids` parameter of `cleanup.delete`: an array (or comma separated
 * string) of 1-20 unique ids from the cleanup allowlist. Unknown ids, caller
 * paths, duplicates and oversized batches are refused before any filesystem
 * call.
 * @param {Record<string, unknown>} params
 * @returns {{ok: true, value: string[]} | {ok: false, message: string}}
 */
function readCleanupIds(params) {
  const raw = params.ids;
  /** @type {unknown[]} */
  let values;
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    values = raw.split(',');
  } else {
    return {
      ok: false,
      message: 'Parameter "ids" must be an array of cleanup item ids (or a comma separated string).',
    };
  }
  /** @type {string[]} */
  const ids = [];
  for (const value of values) {
    if (typeof value !== 'string') return { ok: false, message: 'Cleanup item ids must be strings.' };
    const id = value.trim();
    if (id !== '') ids.push(id);
  }
  if (ids.length < 1 || ids.length > 20) {
    return { ok: false, message: 'Parameter "ids" must contain 1 to 20 cleanup item ids.' };
  }
  const known = new Set(cleanupItems().map((item) => item.id));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return { ok: false, message: `Duplicate cleanup item id: ${id}` };
    seen.add(id);
    if (!known.has(id)) return { ok: false, message: `Unknown cleanup item id: ${id}` };
  }
  return { ok: true, value: ids };
}

/* -------------------------------------------------------------------------- */
/* Filesystem guards                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve an existing path through symlinks.
 * @param {string} raw
 * @returns {Promise<{ok: true, path: string, stat: fs.Stats} | {ok: false, message: string, code: string}>}
 */
async function resolveExisting(raw) {
  const resolved = path.resolve(raw);
  try {
    const real = await fsp.realpath(resolved);
    const stat = await fsp.stat(real);
    return { ok: true, path: real, stat };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'ENOENT';
    return failure(`Path does not exist: ${resolved}`, code);
  }
}

/**
 * True when `candidate` is `root` or lives beneath it (both already resolved).
 * @param {string} candidate
 * @param {string} root
 * @returns {boolean}
 */
function isInside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * The three directories allowed as uninstall roots.
 * @returns {string[]}
 */
function uninstallRoots() {
  return ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications'];
}

/**
 * Resolve and guard an `.app` bundle for uninstall.
 * @param {string} raw
 * @param {string} mode
 * @returns {Promise<{ok: true, path: string} | {ok: false, message: string, code?: string}>}
 */
async function guardedAppBundle(raw, mode) {
  const resolved = await resolveExisting(raw);
  if (!resolved.ok) return resolved;
  if (!resolved.stat.isDirectory()) {
    return failure(`Not an application bundle: ${resolved.path}`, 'NOT_A_BUNDLE');
  }
  if (!/\.app$/i.test(resolved.path)) {
    return failure(`Path must end in ".app" after resolution: ${resolved.path}`, 'NOT_A_BUNDLE');
  }
  const roots = uninstallRoots();
  const insideRoot = roots.some((root) => isInside(resolved.path, root) && resolved.path !== root);
  if (!insideRoot) {
    return failure(
      `Refusing to uninstall outside ${roots.join(', ')}: ${resolved.path}`,
      'PATH_NOT_ALLOWED',
    );
  }
  if (resolved.path.startsWith('/System/')) {
    return failure(`Refusing to uninstall a system application: ${resolved.path}`, 'SYSTEM_APP');
  }
  if (mode === 'delete' && resolved.path === '/Applications') {
    return failure('Refusing to delete the /Applications directory itself.', 'PATH_NOT_ALLOWED');
  }
  return { ok: true, path: resolved.path };
}

/**
 * Move a bundle into the user's Trash with a unique name.
 * @param {string} source resolved bundle path
 * @returns {Promise<string>} the destination path
 */
async function moveToTrash(source) {
  const trash = path.join(os.homedir(), '.Trash');
  await fsp.mkdir(trash, { recursive: true });
  const base = path.basename(source);
  const stem = base.replace(/\.app$/i, '');
  let destination = path.join(trash, `${stem}-${Date.now()}.app`);
  let suffix = 1;
  while (true) {
    try {
      await fsp.access(destination);
      destination = path.join(trash, `${stem}-${Date.now()}-${suffix}.app`);
      suffix += 1;
    } catch {
      break;
    }
  }
  try {
    await fsp.rename(source, destination);
    return destination;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EXDEV') {
      await fsp.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
      await fsp.rm(source, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
      return destination;
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Action runners                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {(params: Record<string, unknown>) => Promise<{ok: boolean, message: string, data?: object, code?: string}>} Runner
 */

/** @type {Record<string, Runner>} */
const RUNNERS = {
  async 'process.signal'(params) {
    const pidRead = readInteger(params, 'pid', { min: 2, max: 4_194_304 });
    if (!pidRead.ok) return failure(pidRead.message, 'BAD_PARAMS');
    const signalRead = readSelect(params, 'signal', [...SIGNAL_NAMES.keys()], 'TERM');
    if (!signalRead.ok) return failure(signalRead.message, 'BAD_PARAMS');
    const pid = pidRead.value;
    if (pid === process.pid || pid === process.ppid) {
      return failure(`Refusing to signal the Device X host process (pid ${pid}).`, 'PROTECTED_PID');
    }
    if (pid === 1) return failure('Refusing to signal launchd (pid 1).', 'PROTECTED_PID');
    const signal = SIGNAL_NAMES.get(signalRead.value);
    try {
      process.kill(pid, signal);
      return success(`Sent SIG${signalRead.value} to pid ${pid}.`, { pid, signal: signalRead.value });
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'ESRCH';
      const reason = err instanceof Error ? err.message : String(err);
      return failure(`Could not signal pid ${pid} (${code}): ${reason}`, code);
    }
  },

  async 'app.quit'(params) {
    const nameRead = readString(params, 'name', { maxLength: 200 });
    if (!nameRead.ok) return failure(nameRead.message, 'BAD_PARAMS');
    const escaped = nameRead.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const result = await run(OSASCRIPT, ['-e', `tell application "${escaped}" to quit`], { timeout: 20_000 });
    if (!result.ok) return commandFailure(`Quit "${nameRead.value}"`, result);
    return success(`Asked "${nameRead.value}" to quit.`, { name: nameRead.value });
  },

  async 'app.launch'(params) {
    const pathRead = readString(params, 'path', { maxLength: 1_024 });
    if (!pathRead.ok) return failure(pathRead.message, 'BAD_PARAMS');
    const resolved = await resolveExisting(pathRead.value);
    if (!resolved.ok) return resolved;
    const result = await run(OPEN, ['-a', resolved.path], { timeout: 15_000 });
    if (!result.ok) return commandFailure(`Launch ${resolved.path}`, result);
    return success(`Launched ${path.basename(resolved.path)}.`, { path: resolved.path });
  },

  async 'app.reveal'(params) {
    const pathRead = readString(params, 'path', { maxLength: 1_024 });
    if (!pathRead.ok) return failure(pathRead.message, 'BAD_PARAMS');
    const resolved = await resolveExisting(pathRead.value);
    if (!resolved.ok) return resolved;
    const result = await run(OPEN, ['-R', resolved.path], { timeout: 15_000 });
    if (!result.ok) return commandFailure(`Reveal ${resolved.path}`, result);
    return success(`Revealed ${path.basename(resolved.path)} in Finder.`, { path: resolved.path });
  },

  async 'app.uninstall'(params) {
    const pathRead = readString(params, 'path', { maxLength: 1_024 });
    if (!pathRead.ok) return failure(pathRead.message, 'BAD_PARAMS');
    const modeRead = readSelect(params, 'mode', ['trash', 'delete'], 'trash');
    if (!modeRead.ok) return failure(modeRead.message, 'BAD_PARAMS');
    const guarded = await guardedAppBundle(pathRead.value, modeRead.value);
    if (!guarded.ok) return guarded;
    const name = path.basename(guarded.path);
    if (modeRead.value === 'trash') {
      try {
        const destination = await moveToTrash(guarded.path);
        return success(`Moved ${name} to Trash as ${path.basename(destination)}.`, {
          trashedPath: destination,
          mode: 'trash',
        });
      } catch (err) {
        return failure(
          `Could not move ${name} to Trash: ${err instanceof Error ? err.message : String(err)}`,
          'TRASH_FAILED',
        );
      }
    }
    try {
      await fsp.rm(guarded.path, { recursive: true, force: false, maxRetries: 3, retryDelay: 150 });
      return success(`Deleted ${name}.`, { path: guarded.path, mode: 'delete' });
    } catch (err) {
      return failure(
        `Could not delete ${name}: ${err instanceof Error ? err.message : String(err)}`,
        'DELETE_FAILED',
      );
    }
  },

  async 'system.setHostname'(params) {
    const kindRead = readSelect(params, 'kind', ['HostName', 'ComputerName', 'LocalHostName']);
    if (!kindRead.ok) return failure(kindRead.message, 'BAD_PARAMS');
    const valueRead = readString(params, 'value', { maxLength: 63 });
    if (!valueRead.ok) return failure(valueRead.message, 'BAD_PARAMS');
    if (!HOSTNAME_PATTERN.test(valueRead.value)) {
      return failure(
        'Hostname value must be 1-63 letters, digits, dots or dashes (no spaces or underscores).',
        'BAD_PARAMS',
      );
    }
    const result = await run(SCUTIL, ['--set', kindRead.value, valueRead.value], { timeout: 10_000 });
    if (!result.ok) return commandFailure(`Set ${kindRead.value}`, result);
    return success(`Set ${kindRead.value} to "${valueRead.value}".`, {
      kind: kindRead.value,
      value: valueRead.value,
    });
  },

  async 'system.setVolume'(params) {
    const percentRead = readNumber(params, 'percent', { min: 0, max: 100 });
    if (!percentRead.ok) return failure(percentRead.message, 'BAD_PARAMS');
    const percent = Math.round(percentRead.value);
    const result = await run(OSASCRIPT, ['-e', `set volume output volume ${percent}`], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Set volume', result);
    return success(`Set output volume to ${percent}%.`, { percent });
  },

  async 'system.setDarkMode'(params) {
    const enabledRead = readBoolean(params, 'enabled');
    if (!enabledRead.ok) return failure(enabledRead.message, 'BAD_PARAMS');
    const script =
      'tell application "System Events" to tell appearance preferences to set dark mode to ' +
      (enabledRead.value ? 'true' : 'false');
    const result = await run(OSASCRIPT, ['-e', script], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Set dark mode', result);
    return success(`Dark mode ${enabledRead.value ? 'enabled' : 'disabled'}.`, { enabled: enabledRead.value });
  },

  async 'system.launchAgent'(params) {
    const pathRead = readString(params, 'path', { maxLength: 1_024 });
    if (!pathRead.ok) return failure(pathRead.message, 'BAD_PARAMS');
    const enabledRead = readBoolean(params, 'enabled');
    if (!enabledRead.ok) return failure(enabledRead.message, 'BAD_PARAMS');
    const resolved = await resolveExisting(pathRead.value);
    if (!resolved.ok) return resolved;
    if (!/\.plist$/i.test(resolved.path)) {
      return failure(`Launch agent path must end in ".plist": ${resolved.path}`, 'NOT_A_PLIST');
    }
    const home = os.homedir();
    const allowed = [
      path.join(home, 'Library', 'LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ];
    if (!allowed.some((root) => isInside(resolved.path, root) && resolved.path !== root)) {
      return failure(
        `Refusing to manage a launch agent outside ${allowed.join(', ')}: ${resolved.path}`,
        'PATH_NOT_ALLOWED',
      );
    }
    const daemon = resolved.path.startsWith('/Library/LaunchDaemons');
    const domain = daemon ? 'system' : `gui/${typeof process.getuid === 'function' ? process.getuid() : 501}`;
    const verb = enabledRead.value ? 'bootstrap' : 'bootout';
    const result = await run(LAUNCHCTL, [verb, domain, resolved.path], { timeout: 20_000 });
    if (!result.ok) return commandFailure(`${enabledRead.value ? 'Load' : 'Unload'} launch agent`, result);
    return success(
      `${enabledRead.value ? 'Loaded' : 'Unloaded'} launch agent ${path.basename(resolved.path)}.`,
      { path: resolved.path, domain, enabled: enabledRead.value },
    );
  },

  async 'system.openSettings'(params) {
    const paneRead = readSelect(params, 'pane', Object.keys(SETTINGS_PANES));
    if (!paneRead.ok) return failure(paneRead.message, 'BAD_PARAMS');
    const anchor = SETTINGS_PANES[paneRead.value];
    const url = `x-apple.systempreferences:${anchor}`;
    const result = await run(OPEN, [url], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Open System Settings', result);
    return success(`Opened System Settings (${paneRead.value}).`, { pane: paneRead.value, url });
  },

  async 'system.toggleFirewall'(params) {
    const enabledRead = readBoolean(params, 'enabled');
    if (!enabledRead.ok) return failure(enabledRead.message, 'BAD_PARAMS');
    const state = enabledRead.value ? 'on' : 'off';
    const result = await run(SOCKETFILTERFW, ['--setglobalstate', state], { timeout: 15_000 });
    if (!result.ok) return commandFailure(`Turn firewall ${state}`, result);
    return success(`Requested firewall ${state}.`, { enabled: enabledRead.value });
  },

  async 'system.flushDNS'(_params) {
    const result = await run(DSCACHEUTIL, ['-flushcache'], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Flush DNS cache', result);
    return success(
      'Flushed the DNS cache. If lookups still fail, restart mDNSResponder with: sudo killall -HUP mDNSResponder',
      { mDNSResponderRestarted: false },
    );
  },

  async 'system.emptyTrash'(_params) {
    const trash = path.join(os.homedir(), '.Trash');
    let entries;
    try {
      entries = await fsp.readdir(trash);
    } catch (err) {
      return failure(
        `Could not read Trash: ${err instanceof Error ? err.message : String(err)}`,
        'TRASH_READ_FAILED',
      );
    }
    let removed = 0;
    /** @type {string[]} */
    const failed = [];
    for (const entry of entries) {
      const target = path.join(trash, entry);
      if (!isInside(target, trash)) continue;
      try {
        await fsp.rm(target, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
        removed += 1;
      } catch (err) {
        failed.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length) {
      return failure(
        `Removed ${removed} of ${entries.length} item(s) from Trash. Failures: ${failed.slice(0, 3).join('; ')}`,
        'TRASH_PARTIAL',
      );
    }
    return success(`Removed ${removed} item(s) from Trash.`, { removed });
  },

  async 'cleanup.delete'(params) {
    const idsRead = readCleanupIds(params);
    if (!idsRead.ok) return failure(idsRead.message, 'BAD_PARAMS');
    // The cleanup module owns the allowlist and the fixed absolute paths: the
    // action passes ids only, never a path, and reports per-item outcomes.
    return deleteCleanup(idsRead.value);
  },

  async 'network.setWifiPower'(params) {
    const enabledRead = readBoolean(params, 'enabled');
    if (!enabledRead.ok) return failure(enabledRead.message, 'BAD_PARAMS');
    const ports = await run(NETWORKSETUP, ['-listallhardwareports'], { timeout: 10_000 });
    let device = 'en0';
    if (ports.ok) {
      const blocks = ports.stdout.split(/\n\s*\n/);
      for (const block of blocks) {
        if (!/Hardware Port:\s*Wi-?Fi/i.test(block)) continue;
        const match = /Device:\s*(\S+)/.exec(block);
        if (match) {
          device = match[1];
          break;
        }
      }
    }
    const state = enabledRead.value ? 'on' : 'off';
    const result = await run(NETWORKSETUP, ['-setairportpower', device, state], { timeout: 15_000 });
    if (!result.ok) return commandFailure(`Turn Wi-Fi ${state} (${device})`, result);
    return success(`Requested Wi-Fi ${state} on ${device}.`, { device, enabled: enabledRead.value });
  },

  async 'network.setDns'(params) {
    const serviceRead = readString(params, 'service', { maxLength: 64 });
    if (!serviceRead.ok) return failure(serviceRead.message, 'BAD_PARAMS');
    if (CONTROL_CHARS.test(serviceRead.value) || serviceRead.value.startsWith('-')) {
      return failure('Parameter "service" is not a valid network service name.', 'BAD_PARAMS');
    }
    const rawServers = params.servers;
    /** @type {string[]} */
    let servers;
    if (Array.isArray(rawServers)) {
      servers = rawServers.map((item) => String(item).trim()).filter((item) => item !== '');
    } else if (typeof rawServers === 'string') {
      servers = rawServers
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
    } else {
      return failure('Parameter "servers" must be an array of IP addresses (or a comma separated string).', 'BAD_PARAMS');
    }
    if (servers.length > 4) return failure('At most 4 DNS servers are allowed.', 'BAD_PARAMS');
    for (const server of servers) {
      if (!net.isIP(server)) return failure(`Invalid IP address: ${server}`, 'BAD_PARAMS');
    }

    // The page may name either the networksetup service ("Wi-Fi", a hardware
    // port name) or the BSD interface device ("en0"); resolve to the service
    // networksetup accepts before touching anything.
    let serviceName = serviceRead.value;
    const servicesRes = await run(NETWORKSETUP, ['-listallnetworkservices'], { timeout: 10_000 });
    if (servicesRes.ok) {
      const known = servicesRes.stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^\*/, '').trim())
        .filter((line) => line && !line.startsWith('An asterisk'));
      const exact =
        known.find((name) => name === serviceName) ??
        known.find((name) => name.toLowerCase() === serviceName.toLowerCase());
      if (exact !== undefined) {
        serviceName = exact;
      } else {
        let mapped;
        const portsRes = await run(NETWORKSETUP, ['-listallhardwareports'], { timeout: 10_000 });
        if (portsRes.ok) {
          for (const block of portsRes.stdout.split(/\n\s*\n/)) {
            const port = /Hardware Port:\s*(.+)/.exec(block);
            const device = /Device:\s*(\S+)/.exec(block);
            if (port === null || device === null) continue;
            const portName = port[1].trim();
            if (device[1] !== serviceName && portName.toLowerCase() !== serviceName.toLowerCase()) continue;
            mapped = known.find((name) => name.toLowerCase() === portName.toLowerCase());
            if (mapped !== undefined) break;
          }
        }
        if (mapped === undefined) {
          return failure(
            `Unknown network service: ${serviceName}. Known services: ${known.join(', ') || '(none)'}`,
            'UNKNOWN_SERVICE',
          );
        }
        serviceName = mapped;
      }
    }
    const args = ['-setdnsservers', serviceName, ...(servers.length ? servers : ['Empty'])];
    const result = await run(NETWORKSETUP, args, { timeout: 20_000 });
    if (!result.ok) return commandFailure('Set DNS servers', result);
    return success(
      servers.length
        ? `Set DNS servers for ${serviceName} to ${servers.join(', ')}.`
        : `Cleared DNS servers for ${serviceName}.`,
      { service: serviceName, servers },
    );
  },

  async 'power.sleep'(_params) {
    const result = await run(PMSET, ['sleepnow'], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Sleep', result);
    return success('Requested system sleep.');
  },

  async 'power.lock'(_params) {
    const script =
      'tell application "System Events" to keystroke "q" using {control down, command down}';
    const result = await run(OSASCRIPT, ['-e', script], { timeout: 10_000 });
    if (!result.ok) return commandFailure('Lock screen', result);
    return success('Requested screen lock.');
  },

  async 'software.brewUninstall'(params) {
    const nameRead = readString(params, 'name', { maxLength: 128 });
    if (!nameRead.ok) return failure(nameRead.message, 'BAD_PARAMS');
    const name = nameRead.value;
    if (!BREW_TOKEN_PATTERN.test(name) || name.startsWith('-') || name.includes('..')) {
      return failure(
        'Brew formula name may only contain letters, digits and @ + . _ / - (no spaces or leading dash).',
        'BAD_PARAMS',
      );
    }
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
    if (!brewPath) return failure('Homebrew is not installed on this machine.', 'NO_BREW');
    const result = await run(brewPath, ['uninstall', name], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    if (!result.ok) return commandFailure(`brew uninstall ${name}`, result);
    return success(`Uninstalled Homebrew formula "${name}".`, { name });
  },
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The frozen action catalog, in stable order.
 * @returns {Array<{id: string, group: string, danger: string,
 *   requiresAdmin: boolean, params: ActionParam[]}>}
 */
export function actionCatalog() {
  return SPECS.map((spec) => ({
    id: spec.id,
    group: spec.group,
    danger: spec.danger,
    requiresAdmin: spec.requiresAdmin,
    params: spec.params.map((descriptor) => ({ ...descriptor, ...(descriptor.options ? { options: [...descriptor.options] } : {}) })),
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
      const candidate = await runner(requestParams);
      result =
        candidate && typeof candidate === 'object' && typeof candidate.ok === 'boolean'
          ? { ok: candidate.ok === true, message: String(candidate.message ?? ''), ...(candidate.data ? { data: jsonSafe(candidate.data) } : {}), ...(candidate.code ? { code: String(candidate.code) } : {}) }
          : failure('Action returned an invalid result.', 'INTERNAL');
    }
  } catch (err) {
    result = failure(`Action failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`, 'INTERNAL');
  }

  recordHistory({ ts, id: actionId, params: requestParams, ok: result.ok === true, message: result.message });
  return jsonSafe(result);
}

/**
 * Test seam for `scripts/verify-cleanup.mjs`: the pure cleanup-id validator
 * (no filesystem access, never deletes anything).
 */
export const __test = { readCleanupIds };
