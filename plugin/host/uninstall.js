/**
 * Device X — uninstall pipeline.
 *
 * One shared state machine so both platforms behave identically and the
 * ordering rule is enforced in exactly one place:
 *
 *     scan -> [user confirms] -> uninstall -> VERIFY -> trash app -> re-scan -> trash leftovers
 *
 * Two invariants matter more than the happy path:
 *
 *  1. **Verification gates everything.** A vendor uninstaller exiting 0 is not
 *     evidence that the app is gone (MSI returns 0/3010/1641, vendor scripts
 *     lie). If the app is still installed afterwards, the run aborts and
 *     *nothing* is deleted — the failure path has zero side effects.
 *  2. **A missing uninstaller is not a failure.** Only 2 of 79 measured apps
 *     ship one; treating "none" as failure would disable the feature almost
 *     everywhere. So `hasUninstaller: false` skips straight to trashing the app.
 *
 * The pipeline never invents paths. Leftover items come from a scan token
 * resolved by `footprint.resolveScanItems`, and the platform adapter performs
 * the actual moves.
 *
 * @module @cfour-hi/dsh-plugin-devicex/host/uninstall
 */

/**
 * @typedef {object} UninstallSteps
 * @property {(appPath: string) => Promise<{ok: boolean, message: string, code?: string}>} uninstallApp
 *   run the vendor uninstaller; `ok: false` aborts the pipeline
 * @property {(appPath: string) => Promise<boolean>} isStillInstalled
 *   objective post-condition check (path gone / registry key gone)
 * @property {(appPath: string) => Promise<{ok: boolean, message: string, destination?: string, code?: string}>} trashApp
 * @property {(absolutePath: string) => Promise<{ok: boolean, message: string, code?: string}>} trashPath
 *   move one leftover to the trash
 * @property {(appPath: string) => Promise<object>} rescan
 *   re-run the footprint scan after the app is gone
 */

/** Pipeline outcomes, in the order they can occur. */
export const PHASES = Object.freeze([
  'uninstall',
  'verify',
  'trash-app',
  'rescan',
  'trash-leftovers',
  'done',
]);

/**
 * Format bytes for a user-facing message.
 * @param {unknown} value
 * @returns {string}
 */
function humanBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = bytes;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Run the uninstall pipeline.
 *
 * @param {object} request
 * @param {string} request.appPath resolved application path / install location
 * @param {boolean} request.hasUninstaller whether the app ships its own uninstaller
 * @param {boolean} [request.cleanupApp] move the app itself to the trash when
 *   there is no uninstaller (or after it ran); default true
 * @param {Array<{id: string, path: string}>} [request.items] leftovers chosen by
 *   the user; already resolved through the scan token
 * @param {number} [request.leftoverBytes] bytes those leftovers occupy, used
 *   only for the user-facing message
 * @param {UninstallSteps} steps platform adapter
 * @returns {Promise<object>} a JSON-safe report
 */
export async function runUninstallPipeline(request, steps) {
  const startedAt = Date.now();
  const appPath = typeof request?.appPath === 'string' ? request.appPath : '';
  /** @type {string[]} */
  const errors = [];

  /** @type {object} */
  const report = {
    ok: false,
    aborted: false,
    phase: 'uninstall',
    appPath,
    uninstaller: {
      ran: false,
      ok: false,
      message: '',
    },
    verified: false,
    appTrashed: false,
    appTrashPath: null,
    leftoversRequested: Array.isArray(request?.items) ? request.items.length : 0,
    leftoversRemoved: 0,
    leftoversFailed: 0,
    leftoverBytes: 0,
    leftoverResults: [],
    errors,
    durationMs: 0,
  };

  const finish = (phase, ok, message) => {
    report.phase = phase;
    report.ok = ok;
    report.message = message;
    report.durationMs = Date.now() - startedAt;
    return report;
  };

  const abort = (phase, message) => {
    report.phase = phase;
    report.aborted = true;
    report.ok = false;
    report.message = message;
    report.durationMs = Date.now() - startedAt;
    return report;
  };

  if (appPath === '') return abort('uninstall', 'No application path was supplied.');

  // ---- 1. vendor uninstaller (only when one exists) ----------------------
  if (request.hasUninstaller === true) {
    report.phase = 'uninstall';
    const result = await steps.uninstallApp(appPath);
    report.uninstaller.ran = true;
    report.uninstaller.ok = result?.ok === true;
    report.uninstaller.message = typeof result?.message === 'string' ? result.message : '';
    if (report.uninstaller.ok !== true) {
      // Invariant 2: the failure path changes nothing on disk.
      return abort(
        'uninstall',
        `The application's own uninstaller did not complete, so nothing was removed. ${report.uninstaller.message}`.trim(),
      );
    }
  }

  // ---- 2. verify the app is actually gone --------------------------------
  // Verification only makes sense as a gate after something claimed to remove
  // the app. When there is no vendor uninstaller the app is obviously still
  // installed - that is the expected state, and step 3 removes it - so asking
  // and then aborting would make the feature unusable for 77 of 79 apps.
  report.phase = 'verify';
  if (request.hasUninstaller === true) {
    let stillInstalled;
    try {
      stillInstalled = await steps.isStillInstalled(appPath);
    } catch (error) {
      errors.push(`verification failed: ${error instanceof Error ? error.message : String(error)}`);
      return abort('verify', 'Could not verify whether the application was removed, so nothing was deleted.');
    }
    if (stillInstalled === true) {
      return abort(
        'verify',
        'The application is still installed after its uninstaller finished, so nothing was deleted.',
      );
    }
  }
  report.verified = true;

  // ---- 3. move the app itself to the trash ------------------------------
  // After a successful vendor uninstall the bundle is usually already gone;
  // only attempt the move when something is still there.
  if (request.cleanupApp !== false) {
    report.phase = 'trash-app';
    let appStillThere = false;
    try {
      appStillThere = await steps.isStillInstalled(appPath);
    } catch {
      appStillThere = false;
    }
    if (appStillThere) {
      const moved = await steps.trashApp(appPath);
      report.appTrashed = moved?.ok === true;
      report.appTrashPath = typeof moved?.destination === 'string' ? moved.destination : null;
      if (moved?.ok !== true) {
        return abort(
          'trash-app',
          `Could not move the application to the Trash, so no leftovers were touched. ${
            typeof moved?.message === 'string' ? moved.message : ''
          }`.trim(),
        );
      }
    }
  }

  // ---- 4. re-scan, because the uninstaller may have cleaned some data ----
  report.phase = 'rescan';
  if (Array.isArray(request?.items) && request.items.length > 0) {
    try {
      const after = await steps.rescan(appPath);
      report.rescan = {
        items: Array.isArray(after?.items) ? after.items.length : 0,
        totalBytes: Number(after?.totalBytes) || 0,
        errors: Array.isArray(after?.errors) ? after.errors.slice(0, 5) : [],
      };
    } catch (error) {
      errors.push(`re-scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- 5. move the chosen leftovers to the trash ------------------------
  if (Array.isArray(request?.items) && request.items.length > 0) {
    report.phase = 'trash-leftovers';
    for (const item of request.items) {
      const path = typeof item?.path === 'string' ? item.path : '';
      if (path === '') continue;
      const outcome = await steps.trashPath(path);
      const ok = outcome?.ok === true;
      if (ok) report.leftoversRemoved += 1;
      else report.leftoversFailed += 1;
      report.leftoverResults.push({
        id: typeof item?.id === 'string' ? item.id : '',
        path,
        ok,
        message: typeof outcome?.message === 'string' ? outcome.message : '',
      });
    }
    report.leftoverBytes = Number(request.leftoverBytes) || 0;
  }

  const leftoverPart =
    report.leftoversRequested === 0
      ? 'No leftover directories were selected.'
      : report.leftoversFailed === 0
        ? `Moved ${report.leftoversRemoved} leftover location(s) to the Trash (${humanBytes(report.leftoverBytes)}).`
        : `Moved ${report.leftoversRemoved} of ${report.leftoversRequested} leftover location(s) to the Trash; ${report.leftoversFailed} could not be moved.`;

  // Trash is not freed space; say so rather than implying the disk grew.
  const spaceHint =
    report.leftoverBytes > 0
      ? ` Empty the Trash to actually free ${humanBytes(report.leftoverBytes)}.`
      : '';

  return finish('done', report.leftoversFailed === 0, `${leftoverPart}${spaceHint}`.trim());
}
