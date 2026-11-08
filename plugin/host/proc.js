/**
 * Shared child-process helpers for the Device X host half.
 *
 * Everything in the host collectors/actions goes through here so we get one
 * place that guarantees: argv-only spawning (never a shell string), a timeout,
 * a bounded buffer, a deterministic (C) locale for text parsing, and a small
 * concurrency cap so a full inventory page cannot fork-bomb the machine.
 *
 * `run()` never throws and never rejects: every failure is reported in the
 * resolved result object.
 *
 * Plain Node ESM, `node:*` imports only.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/proc
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Default per-command wall-clock timeout. */
const DEFAULT_TIMEOUT = 10_000;
/** Default stdout/stderr buffer (system_profiler JSON is well below this). */
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
/** Maximum concurrently running child processes. */
const MAX_CONCURRENT = 12;

let active = 0;
/** @type {Array<() => void>} */
const waiters = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(() => resolve(undefined)));
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) {
    active += 1;
    next();
  }
}

/**
 * @typedef {object} ExecResult
 * @property {boolean} ok
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} code process exit code, null when killed/spawn failed
 * @property {string|null} signal signal that terminated the child
 * @property {boolean} timedOut
 * @property {string|null} error
 */

/**
 * Run one executable with an argv array.
 *
 * Never throws and never rejects: missing binary, non-zero exit, timeout and
 * buffer overflow are all reported in the resolved object.
 *
 * @param {string} file absolute path or PATH-resolved binary name.
 * @param {string[]} [args]
 * @param {object} [options]
 * @param {number} [options.timeout] milliseconds.
 * @param {number} [options.maxBuffer] bytes.
 * @param {NodeJS.ProcessEnv} [options.env] full environment replacement.
 * @param {string} [options.cwd]
 * @param {string} [options.input] bytes to write to the child's stdin, then close it.
 * @returns {Promise<ExecResult>}
 */
export function run(file, args = [], options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxBuffer = DEFAULT_MAX_BUFFER,
    env,
    cwd,
    input,
  } = options;

  return acquire().then(
    () =>
      new Promise((resolve) => {
        const childEnv = env ?? { ...process.env, LC_ALL: 'C', LANG: 'C' };
        /** @param {ExecResult} result */
        const finish = (result) => {
          release();
          resolve(result);
        };
        /** @param {unknown} err */
        const failure = (err) => {
          const error = /** @type {NodeJS.ErrnoException & {signal?: string|null}} */ (err ?? {});
          finish({
            ok: false,
            stdout: '',
            stderr: '',
            code: typeof error.code === 'number' ? error.code : null,
            signal: /** @type {string|null} */ (error.signal ?? null),
            timedOut: false,
            error: String(error.message ?? error),
          });
        };

        let child;
        try {
          child = execFile(
            file,
            args,
            {
              timeout,
              maxBuffer,
              env: childEnv,
              cwd,
              encoding: 'utf8',
              windowsHide: true,
            },
            (err, stdout, stderr) => {
              if (!err) {
                finish({
                  ok: true,
                  stdout: typeof stdout === 'string' ? stdout : '',
                  stderr: typeof stderr === 'string' ? stderr : '',
                  code: 0,
                  signal: null,
                  timedOut: false,
                  error: null,
                });
                return;
              }
              const error = /** @type {NodeJS.ErrnoException & {killed?: boolean, signal?: string|null}} */ (err);
              finish({
                ok: false,
                stdout: typeof stdout === 'string' ? stdout : '',
                stderr: typeof stderr === 'string' ? stderr : '',
                code: typeof error.code === 'number' ? error.code : null,
                signal: /** @type {string|null} */ (error.signal ?? null),
                timedOut:
                  error.killed === true ||
                  error.signal === 'SIGTERM' ||
                  error.signal === 'SIGKILL' ||
                  error.code === 'ETIMEDOUT',
                error: String(error.message || error),
              });
            },
          );
        } catch (err) {
          failure(err);
          return;
        }
        // Async spawn failures are delivered through the callback; this handler
        // only prevents an unhandled `error` event on the child object.
        child.on('error', () => {});
        // Optional stdin payload: used by the Windows PowerShell bridge, whose
        // scripts routinely exceed the Windows 32,767-character command line
        // (they are streamed to `powershell -Command -` instead of argv).
        if (typeof input === 'string' && child.stdin !== null) {
          child.stdin.on('error', () => {});
          child.stdin.end(input);
        } else if (child.stdin !== null) {
          child.stdin.end();
        }
      }),
  );
}

/**
 * Run a command and parse its stdout as JSON. Never throws or rejects.
 *
 * @param {string} file
 * @param {string[]} [args]
 * @param {object} [options] same as {@link run}.
 * @returns {Promise<{ok: boolean, data: any, error: string|null, raw: ExecResult}>}
 */
export async function runJson(file, args = [], options = {}) {
  const raw = await run(file, args, options);
  if (!raw.ok) {
    return {
      ok: false,
      data: null,
      error: raw.error || `${file} exited with code ${String(raw.code)}`,
      raw,
    };
  }
  try {
    return { ok: true, data: JSON.parse(raw.stdout || 'null'), error: null, raw };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON from ${file}: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    };
  }
}

/**
 * Split command output into trimmed, non-empty lines.
 * @param {string} text
 * @returns {string[]}
 */
export function lines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
}

/**
 * `setTimeout` as a promise (used only for the tiny CPU delta sample).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * First existing path from a candidate list.
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}
