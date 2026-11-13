/**
 * Device X — PowerShell bridge for the Windows host half.
 *
 * Every Windows collection and action goes through this module so one place
 * guarantees: a resolved interpreter (Windows PowerShell 5.1 preferred, then
 * pwsh 7), a private temp script run with `-File` (no shell, no quoting
 * injection, no argv length limit, and no line-by-line REPL parsing), UTF-8
 * console output, a wall-clock timeout, a bounded buffer, and JSON parsing that
 * never throws.
 *
 * Parameters reach scripts through environment variables (`DEVICEX_ARG_*`)
 * rather than string interpolation; callers use {@link psString} only for
 * constant option values.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/win
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './proc.js';

/** Default wall-clock timeout for one PowerShell call. */
export const DEFAULT_TIMEOUT = 20_000;
/** Default stdout/stderr buffer (CIM JSON is well below this). */
export const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/** Prefix every script with UTF-8 console settings and a quiet progress bar. */
const OUTPUT_PREFIX =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
  "$OutputEncoding=[System.Text.Encoding]::UTF8;" +
  "$ProgressPreference='SilentlyContinue';";

/** Interpreter candidates, in preference order.
 *
 * Windows PowerShell 5.1 comes first: the collectors/actions use inbox Windows
 * modules (`Get-LocalUser`, `Get-BitLockerVolume`, `Get-MpComputerStatus`,
 * `Get-PnpDevice`, `Get-PhysicalDisk`) that are not guaranteed under pwsh 7.
 * Set DEVICEX_PWSH to override (useful on hosts where only pwsh 7 exists).
 */
/** @type {string[]} */
export const PS_CANDIDATES = /** @type {string[]} */ ([
  process.env.DEVICEX_PWSH,
  'powershell.exe',
  'pwsh.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0));

/** One resolved interpreter per Host process lifetime. */
let resolution;

/**
 * Resolve the first working PowerShell interpreter.
 * @returns {Promise<{command: string, major: number|null}|null>}
 */
export function resolveInterpreter() {
  resolution ??= (async () => {
    for (const candidate of PS_CANDIDATES) {
      const probe = await run(
        candidate,
        ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
        { timeout: 8_000, maxBuffer: 64 * 1024 },
      );
      if (probe.ok) {
        const major = Number.parseInt(probe.stdout.trim(), 10);
        return { command: candidate, major: Number.isFinite(major) ? major : null };
      }
    }
    return null;
  })();
  return resolution;
}

/**
 * Build the interpreter argv for one script file.
 *
 * The script is written to a private temp file and run with `-File`, not piped
 * into `-Command -`. That is not cosmetic: `-Command -` parses stdin as an
 * interactive REPL, one statement per line, and a multi-line block that is not
 * terminated by a blank line is silently dropped (exit code 0, no output). Any
 * inline action script with `if (...) {` on its own line would therefore fail
 * with the opaque "PowerShell returned no output". `-File` parses the whole
 * document as one script, which is what every bundled `.ps1` assumes.
 *
 * A file path also sidesteps the 32,767-character command-line limit that
 * encoding the script into argv would hit.
 *
 * @param {string} [scriptPath] absolute path to the temp script
 * @returns {string[]}
 */
export function commandArguments(scriptPath = '') {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
}

/**
 * Quote one value as a PowerShell single-quoted literal.
 * @param {string} value
 * @returns {string}
 */
export function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Run a PowerShell script with no implicit shell.
 * @param {string} script PowerShell source.
 * @param {object} [options]
 * @param {number} [options.timeout] milliseconds.
 * @param {number} [options.maxBuffer] bytes.
 * @param {Record<string,string>} [options.env] extra environment variables.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, code: number|null,
 *   signal: string|null, timedOut: boolean, error: string|null}>}
 */
export async function runPS(script, options = {}) {
  const interpreter = await resolveInterpreter();
  if (interpreter === null) {
    return {
      ok: false,
      stdout: '',
      stderr: 'no PowerShell interpreter found (pwsh.exe / powershell.exe)',
      code: null,
      signal: null,
      timedOut: false,
      error: 'PowerShell is not available on this host',
    };
  }
  // UTF-8 with BOM: Windows PowerShell 5.1 decodes a BOM-less file as ANSI,
  // which would mangle any non-ASCII literal. The output prefix runs first so
  // every script gets the same console encoding and quiet progress bar.
  const directory = mkdtempSync(join(tmpdir(), 'devicex-ps-'));
  const scriptPath = join(directory, 'script.ps1');
  writeFileSync(scriptPath, `\uFEFF${OUTPUT_PREFIX}\n${script}`, 'utf8');
  try {
    return await run(interpreter.command, commandArguments(scriptPath), {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      env: options.env === undefined ? undefined : { ...process.env, ...options.env },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Strip a UTF-8 BOM and surrounding whitespace. */
function trimOutput(text) {
  return String(text ?? '').replace(/^\uFEFF/, '').trim();
}

/**
 * Run a script that ends by writing one JSON document, and parse it.
 * A failed run, empty output, or malformed JSON becomes `{ ok: false }` with
 * a short diagnostic supplied by the script (or from stderr); it never throws.
 * Failure results also carry `timedOut` and `code` so callers can distinguish a
 * killed/timed-out child (which has no stdout and no stderr) from a script that
 * failed on its own.
 * @param {string} script
 * @param {object} [options] same as {@link runPS}.
 * @returns {Promise<{ok: true, data: any, raw: string} | {ok: false, error: string, raw: string, stderr: string,
 *   timedOut: boolean, code: number|null}>}
 */
export async function runPSJson(script, options = {}) {
  const result = await runPS(script, options);
  const raw = trimOutput(result.stdout);
  if (raw === '') {
    const detail = trimOutput(result.stderr) || result.error || 'PowerShell returned no output';
    return {
      ok: false,
      error: short(detail),
      raw,
      stderr: trimOutput(result.stderr),
      timedOut: result.timedOut,
      code: result.code,
    };
  }
  try {
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (error) {
    return {
      ok: false,
      error: `PowerShell JSON was not parseable: ${short(error instanceof Error ? error.message : String(error))}`,
      raw,
      stderr: trimOutput(result.stderr),
      timedOut: result.timedOut,
      code: result.code,
    };
  }
}

/**
 * Read one bundled PowerShell script from `plugin/host/win/`.
 * Scripts are cached after first use.
 * @param {string} name file name inside `host/win/`.
 * @returns {string}
 */
const scriptCache = new Map();
export function readScript(name) {
  if (!scriptCache.has(name)) {
    const url = new URL(`./win/${name}`, import.meta.url);
    scriptCache.set(name, readFileSync(url, 'utf8'));
  }
  return scriptCache.get(name);
}

/** Shorten a diagnostic to a single useful line. */
function short(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    // PowerShell appends a location line ("At C:\...\script.ps1:5 char: 31",
    // localized) plus a source snippet to a terminating error. They name our
    // throwaway temp file and repeat the script text, so they are noise in a
    // user-facing message; the exception text above them is the useful part.
    .filter((entry) => entry !== '' && !/\.ps1:\d+/.test(entry) && !/^\+\s/.test(entry))
    .slice(0, 2)
    .join(' ');
  return line.length > 400 ? `${line.slice(0, 400)}…` : line || 'unknown PowerShell failure';
}

/** Test seam: stable pure helpers used by the offline verification script. */
export const __test = {
  commandArguments,
  psString,
  trimOutput,
  short,
  OUTPUT_PREFIX,
};
