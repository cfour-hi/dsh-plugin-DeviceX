# Changelog

## 1.6.0 — uninstall footprint (leftover discovery + cleanup)

Uninstalling an application can now find the data it left outside its bundle and
let the user choose what to remove with it. The action catalogue stays at **19**
entries: scanning is a read-only route, and cleanup travels as optional
parameters on the existing `app.uninstall`.

- **New read-only route** `GET /devicex/api/footprint?path=<app>&fresh=1` returns a
  `FootprintReport` with an opaque `scanId`. Paths stay on the host; the browser
  only ever receives scan-local item ids.
- **Four confidence tiers**, all shown in the dialog: `high` (bundle id / MSIX /
  Homebrew `zap`) preselected, `medium` (name similarity only) and `conflict`
  (name similarity with two or more possible owners) opt-in, `shared`
  (vendor-level) and admin-only rows have no checkbox at all.
- **Deletion still never accepts a path.** `app.uninstall` accepts `scanId` +
  `itemIds` only; the host resolves them through a single-use, 10-minute token
  and re-validates each path against the roots the scan was allowed to use.
  Symbolic links and root directories are refused.
- **Everything goes to the Trash** (macOS `~/.Trash`, Windows Recycle Bin is not
  implemented yet — see the limitation below). The result message says that the
  Trash frees no space until emptied.
- **The uninstaller gates the cleanup.** If the vendor uninstaller fails, or the
  app is still installed afterwards, the run aborts and *nothing* is deleted. An
  app with no uninstaller is not a failure.
- **macOS never executes a bundle-shipped uninstaller.** The two that exist on a
  real host are an opaque Go binary and an AppleScript with no verifiable
  argument contract, and a guessed flag risks a half-finished uninstall. The
  bundle is moved to the Trash instead — which is how macOS apps are uninstalled
  anyway. The uninstaller path stays wired for Windows, where MSI/winget/registry
  all have a defined command line.
- **Windows can list but not clean.** Discovery works (MSIX `Packages`
  containers, name-matched product directories under `%APPDATA%`,
  `%LOCALAPPDATA%`, `%PROGRAMDATA%`); a request that asks to remove leftovers is
  refused with `UNSUPPORTED_PLATFORM` rather than silently uninstalling and
  ignoring the selection. Moving to the Recycle Bin needs the shell and has not
  been validated on a real Windows host.
- **Two pre-existing defects fixed in `moveToTrash`**, both of which could
  destroy data: `rename` silently overwrote any file already sitting at the
  destination (now an atomic `mkdir`/`open('wx')` reservation is made first), and
  the `.app` suffix was hard-coded, so a data directory was trashed under an
  application name.
- **No REA dependency.** Measured on a real host, REA could not contribute here:
  the native Hopper route is blocked without an Apple Events grant,
  `analyze-javascript-application` failed after 698 s on a 650 MB Electron app and
  retained zero filesystem-path literals even for a 10-line control program, and
  most native binaries contain no `Library/...` literals at all. See
  `docs/uninstall-footprint-design.md` §2.1.
- **Verified**: 109 unit tests, 237 client render assertions, and a new
  `scripts/verify-footprint.mjs` (69 checks) covering tier classification, token
  lifecycle, the pipeline's zero-side-effect failure path and `moveToTrash`
  collision safety.

## 1.5.0 — repository + package rename

The GitHub repository was renamed to `cfour-hi/dsh-plugin-devicex` (all lowercase); the npm
package name follows it.

- Package/bundle name: `@cfour-hi/dsh-devicex` → **`@cfour-hi/dsh-plugin-devicex`**
  (both manifests, `cordis.patch.yml`, browser module id, host module JSDoc).
- Install/remove commands and docs now use the new package name and the new GitHub URL
  `https://github.com/cfour-hi/dsh-plugin-devicex`; the `repository` fields in both
  manifests follow the lowercase spelling too.
- Local checkout renamed `DSHP-DeviceX` → `dsh-plugin-devicex`; re-create the profile
  link against the new path if the old one is still recorded.
- Migration: remove the old bundle before installing this version
  (`plugin_manager action=remove_bundle target=@cfour-hi/dsh-devicex`), then install
  from the new repository URL/path.
- Automated publishing: pushing a `v*.*.*` tag runs the full verify gate, audits the
  `plugin/` tarball, publishes **that exact file** to npm through GitHub OIDC trusted
  publishing (no long-lived token, provenance attached) and attaches the same tarball to
  a GitHub Release (`.github/workflows/release.yml`; manual dry runs supported). Re-runs
  are idempotent: an already-published version skips the publish step and only reconciles
  the Release. `verify.yml` is now a reusable workflow (`workflow_call`), so a release can
  only ship a commit that passed exactly the `main` gate.
- Licensed under **MIT**: `LICENSE` at the repository root, mirrored to `plugin/LICENSE` because npm only
  ships files inside the package directory; both manifests declare `"license": "MIT"`. `release:check` and
  `release:pack` verify the two manifests agree and that the packaged licence matches the repository one.
- Publishing is gated by the GitHub Environment **`npm-release`** (required reviewer): a release run parks on
  *Review deployments* until someone approves it. The npm trusted publisher's Environment must match
  (`npm trust github … --env npm-release`). Manual runs go through the same gate.
- Release guards: target version must not exist on npm, must not move `latest` backwards,
  the tag must sit on `origin/main`, and `repository.url` must match the GitHub repository
  (npm provenance requirement). The first publish of a brand-new package name needs one
  bootstrap (trusted publishing cannot be configured before the package exists) — the
  workflow accepts an optional `NPM_TOKEN` secret for that single run.
- `plugin/package.json` is publishable (`private` removed, `publishConfig.access: public`);
  the root manifest stays `private` because it only serves Git/`install_bundle` installs.
- New release guards: `npm run release:check` (tag / both manifests / CHANGELOG must
  agree, `scripts/check-release-version.mjs`) and `npm run release:pack`
  (`scripts/pack-release.mjs`: `npm pack` plus a tarball audit for required and
  forbidden files and byte-identical `client.js`). Process documented in `docs/RELEASE.md`.

## 1.4.1 — page.tsx: the last core.js chunk migrates to TSX

No visible UI change.

- `src/client/page.tsx` now hosts `DeviceXPage` (header, tab rail, section bodies, modal
  construction, toasts) and `DeviceXIcon`; the whole render tree is JSX.
- `src/client/components/Guard.tsx` hosts the lazy error boundary (the class is created on
  first render, after the loader injects React).
- `src/client/use-device-metrics.js` hosts the reduced-motion and 2500 ms metrics hooks with
  the sample ring buffer.
- `src/client/core.js` shrank to **57 lines**: locale registration, stylesheet injection and
  the two slot registrations only. No `h()` calls remain in the client source.
- Both build engines render identically (215 + 32 assertions each); `plugin/client.js`:
  202,532 → 202,359 bytes; typecheck/tests/build/offline suites green.

## 1.4.0 — complete UI migration to TSX

The browser UI is now fully modular and type-checked; no visible UI change.

- `ActionsTab.tsx` + `action-helpers.tsx`: the 19-action catalogue, generated forms
  (`ParamField`/`ActionCard`), DNS server parsing and the history list.
- `Modal.tsx` (focus trap, Escape handling, confirm/cancel footer) and `Toasts.tsx`
  (auto-dismiss stack) moved out of `core.js`.
- Every tab is now a `.tsx` module: Overview, Hardware (+Thermal/Drivers cards), System,
  Software, Network, Security (+status card), Processes, Cleanup, Benchmark (+delta), Actions.
- `src/client/core.js` shrank from ~6,600 to ~1,000 lines: it now only holds the page
  assembly, polling/state plumbing and the registration entry.
- Both build engines render identically (215 + 32 assertions each); `plugin/client.js`:
  202,843 → 202,532 bytes; typecheck/tests/build/offline suites green.

## 1.3.14 — Cleanup + Benchmark tabs to TSX

No visible UI change.

- `CleanupTab.tsx`: allowlisted scan, selection/select-all, confirm banner and deletion flow,
  with hooks from the forwarder layer and the cleanup API/normalizer imported directly.
- `BenchmarkTab.tsx` + `BenchmarkDelta.tsx`: fixed-work run button, three result cards with
  per-metric details and the previous-run delta, environment facts and error/empty states.
- Both build engines render identically (215 + 32 assertions each); `plugin/client.js`:
  202,788 → 202,766 bytes; typecheck/tests/build/offline suites green.

## 1.3.13 — Security + Processes tabs to TSX

No visible UI change.

- `SecurityTab.tsx`: status-card grid (FileVault/SIP/Gatekeeper/firewall or
  BitLocker/Secure Boot/Defender), privacy/TCC table, admins, remote-login facts and the
  settings-pane toolbar; `SecurityStatusCard.tsx` extracted with the enabled/disabled pill.
- `ProcessesTab.tsx`: searchable/sortable process table with per-row kill action and refresh.
- Both build engines render identically (215 + 32 assertions each); `plugin/client.js`:
  202,843 → 202,788 bytes; typecheck/tests/build/offline suites green.

## 1.3.12 — Software + Network tabs to TSX

No visible UI change.

- `SoftwareTab.tsx`: searchable/sortable applications table with source filter, reveal/uninstall
  row actions and the Homebrew/winget card; `SW_SOURCE_KEYS` moved into the module.
- `NetworkTab.tsx`: Wi-Fi/DNS/route/proxy cards, interface table and listening-port table;
  `NET_TYPE_KEYS` moved into the module; `spanIcon` extracted as a shared TSX helper.
- Both tabs keep their confirm/DNS/settings callbacks (`openConfirm`, `openDns`, `openPane`).
- Both build engines render identically (215 + 32 assertions each); `plugin/client.js`:
  202,792 → 202,843 bytes; typecheck/tests/build/offline suites green.

## 1.3.11 — System tab to TSX

No visible UI change.

- `SystemTab.tsx` is the third tab extracted from `core.js`: OS/device/boot/locale fact grids,
  users table, startup/launch-agent table (with the toggle + confirm flow), login items and the
  whitelisted environment table are now JSX.
- `ENV_KEYS` / `AGENT_SCOPE_KEYS` move into the tab module; `core.js` drops the local definition.
- Both build engines still render identically (215 + 32 assertions each); typecheck/tests/
  build/offline suites stay green. `plugin/client.js`: 202,822 → 202,792 bytes.

## 1.3.10 — Hardware tab to TSX

No visible UI change.

- `HardwareTab.tsx` is the second tab extracted from `core.js`; the large card grid
  (CPU/memory/GPU/displays/storage/battery/USB/Bluetooth/audio/cameras) is now JSX.
- `ThermalCard.tsx` and `DriversCard.tsx` moved with it; the thermal translation-key
  maps and the `normalizeThermal` usage live in the thermal component now.
- `core.js` keeps only the remaining tabs + action/modal layer on `h()`.
- concat (C) fallback module order covers the three new files; both build engines render
  identically (215 + 32 assertions each) and all type/test/build/offline suites stay green.
- `plugin/client.js` regenerated: 202,945 → 202,822 bytes.

## 1.3.9 — Tab layer starts moving to TSX

No visible UI change.

- `src/client/hooks.js`: hook forwarders (`useState`/`useEffect`/`useRef`/`useCallback`/
  `useMemo`/`useId`) that delegate to the loader-injected React, so stateful `.tsx`
  components can leave the `createClient()` closure without importing React.
- `DeviceScene` and the whole **OverviewTab** (hero, derived alerts, KPI donut grid,
  sparklines, top processes, memory breakdown) moved from `core.js` into typed `.tsx`;
  `buildAlerts`/`MEMORY_SEGMENTS` live inside the tab module now.
- Shared **TabShell** (loading/error/non-fatal errors) and **SectionErrors** moved to `.tsx`
  as the base for the remaining tabs.
- `plugin/client.js` regenerated (202,703 → 202,945 bytes); render suites still pass
  (215 + 32 assertions, both build engines), typecheck/tests/offline suites green.
- Remaining `h()` code is the other nine tabs + modal/actions layer; they migrate next.

## 1.3.8 — TSX migration of form/chart primitives

No visible UI change.

- Ten more components moved from `core.js` into typed `.tsx` modules: `Switch`, `Donut`,
  `Sparkline`, `Bar`, `SectionHead`, `SubCard`, `SearchField`, `SegmentedControl`,
  `ErrorState`, `KpiCard` (19 `.tsx` components in total, alongside the 9 from 1.3.6/1.3.7).
- `helpers.js` `isFiniteNumber` is now a type predicate (`value is number`), so the
  sparkline/donut/bar math narrows correctly under `checkJs`.
- concat (C) fallback module order covers the new component files; both build engines keep
  producing equivalent artifacts (`verify:build` 37 checks).
- `plugin/client.js` regenerated (202,667 → 202,703 bytes); render suites still pass for
  both engines (215 + 32 assertions each) and all type/test/offline suites stay green.

## 1.3.7 — TSX migration of the presentation primitives

No visible UI change.

- Seven more components moved from the `core.js` closure to typed `.tsx` modules:
  `Icon`, `Card`, `Skeleton`, `EmptyState`, `Fact`, `FactGrid`, `DataTable` (plus the
  existing `Pill`/`SignalBars`, nine `.tsx` components in total). They are imported by
  `core.js` and keep identical markup/classes.
- `src/client/jsx.js` `Fragment` is typed as the classic-fragment marker for `<></>`
  support in TSX; the esbuild build and the concat fallback both handle the new files
  (concat transpiles TSX with the TypeScript compiler, still no bundler).
- `tsconfig.client.json` now type-checks all nine components; `plugin/client.js` shrank
  slightly (202,719 → 202,667 bytes) because JSX output differs from the old `h()` calls.
- Both render suites still pass for both engines (215 + 32 assertions each) and the
  type/test/build/offline pipelines stay green.

## 1.3.6 — JSX pilot (P2-b)

No visible UI change; the first `.tsx` components are wired into the bundle.

- New `src/client/jsx.js`: classic JSX runtime that binds `h` to the loader-injected
  React lazily and maps a fragment marker to `React.Fragment`. The esbuild build uses
  `jsx: 'transform'`, `jsxFactory: 'h'`, `jsxFragment: 'Fragment'`, so the bundle still
  requests only the single `react` seed and never imports `react/jsx-runtime`
  (the build script refuses to write otherwise).
- First pilot components migrated to TSX: `Pill` (status pill, used across all tabs) and
  `SignalBars` (Wi-Fi/signal).
- `@types/react` / `@types/react-dom` added as devDependencies; `tsconfig.client.json`
  now type-checks `.tsx` (`jsx: react`, `jsxFactory: h`) alongside the pure-logic modules.
- The C fallback (`build-client-concat.mjs`) now transpiles `.ts`/`.tsx` with the TypeScript
  compiler (still **no bundler**) so it keeps producing an equivalent artifact; the
  build-conformance seed check now ignores comments when counting the `react` seed request.
- `plugin/client.js` regenerated (202,552 → 202,717 bytes); all 215 render assertions and
  the 32 Windows-data assertions still pass for both build engines, and the
  offline/build/type/test pipelines stay green.

## 1.3.5 — client pure-logic type checking (P2-a)

No runtime or UI change.

- `src/client/{constants,helpers,runtime,normalizers,api}.js` now start with
  `// @ts-check` and are checked by a dedicated `tsconfig.client.json`
  (`allowJs`/`checkJs`, `strictNullChecks`, DOM lib, no node types).
- `npm run typecheck` runs both projects: the host `tsconfig.json` and the client
  `tsconfig.client.json`; `npm run typecheck:client` is available for the client
  half alone. CI inherits the combined command.
- One real type mismatch fixed: `api.js` attached `status` to a plain `Error`
  (now typed as `Error & {status?: number}`); no behaviour change.
- Scope is deliberate: `core.js` (components/page, `h()` style) is covered by the
  React render suites instead of `checkJs`; `dicts.js`/`styles.js` are data and
  stylesheets.
- esbuild output is byte-identical (`build --check` passes) because the check
  directives and JSDoc casts are comments.

## 1.3.4 — per-action parameter contracts (P1)

Type-only continuation of 1.3.2/1.3.3; no runtime or UI change.

- `types/contracts.ts` now carries the normalized per-action parameter table:
  `DarwinActionParamsById` / `Win32ActionParamsById` (19 actions each), including
  discriminated unions for `app.uninstall` (msi | winget | registry) and
  `system.launchAgent` (HKCU | HKLM | HKLM32), plus platform signal unions.
- All 19 Windows `validate(params)` functions are annotated with
  `@returns {Win32ActionParamsById['<id>']}`; `tsc --noEmit` now fails if a validator
  produces a value that drifts from the contract. The Windows read helpers
  (number/string/boolean/select/existing-path/parse-*) gained explicit literal-union
  returns so the narrowing is real.
- macOS runners stay intentionally untyped at the trust boundary (they validate raw
  input inline); the contract types document what each normalized value would be and
  are available to future client/tool typing.
- CI/typecheck unchanged in shape: `build --check → typecheck → npm test →
  verify:build → five offline suites`; all checks stay green.

## 1.3.3 — parser unit tests (P1) and two real macOS parser fixes

Continues the P0 contract work. No UI change; two genuine Host data bugs fixed.

- **`test/` + `npm test` (node:test, 57 tests)**: direct unit coverage for the pure
  high-risk functions, with no command spawning and no cache mutation:
  - macOS parsers: `vm_stat`, `sysctl vm.swapusage`, `pmset -g batt`, `ioreg`
    battery/disk, `netstat`, `df`, `ifconfig`, `network setup` ports, `route`, `scutil`
    dns/proxy, `lsof`, `ps`/ELAPSED, `launchctl list`, XML plist, `mdls`, `system_profiler`
    airport, driver inventory;
  - Windows CIM mappers (metrics/hardware/system/software/network/security/processes),
    cleanup normalization, action catalogue + validators/guards;
  - benchmark pure helpers (determinism, scoring, disk temp-file cleanup, worker fallback).
- **Two bugs found by the new tests and fixed**:
  - `pmset -g batt` lines are indented by one space, so `parsePmsetBattery` always reported
    `present: false` (battery presence now comes from the real line);
  - the battery state `discharging` contains the substring `charging`, so the parser reported
    `charging: true` while unplugged (state matching is now whole-word).
- `collector-darwin.js` exposes a pure `__test` seam (parsers/helpers) and the CI pipeline now
  runs `npm test` between typecheck and the build-engine conformance step.
- `types/contracts.ts` remains the type source of truth; per-action discriminated unions,
  client `checkJs`/`.tsx` stay deferred.

## 1.3.2 — type-only contract layer (P0)

Implements the first step of the "contracts, not full TS" plan. No runtime or UI change.

- **`types/contracts.ts`**: a types-only file (never imported at runtime, never bundled, not
  shipped in the tarball) documenting the frozen boundary shapes: `Platform`, `SectionName`,
  `Metrics` (+ CPU/memory/disk/network/battery/thermal/processes), the six section payloads,
  `Inventory`, the 19-id `ActionId` union + `Action`/`ActionParam`/`ActionResult`, cleanup and
  benchmark payloads, `ExecResult`, and the minimal DSH plugin contracts
  (`PluginContext`, `PluginOperations`, `WebRoute`, `ToolDefinition`).
- **Platform adapter interfaces** (`PlatformCollector`, `PlatformActions`) are now applied to the
  `collector.js` / `actions.js` dispatchers, so a missing or drifting platform implementation fails
  in `tsc` instead of at runtime.
- Host JS references the types from JSDoc (`import('../types/contracts.js').X`); the browser
  source only carries comment-level typedefs, so the generated bundle is byte-identical.
- `tsconfig.json` includes the new file; `npm run typecheck` remains 0 errors; CI unchanged.
- This is deliberately P0 only: per-action discriminated unions for the 38 runners, client `.tsx`,
  and parser unit tests stay on the P1/P2 roadmap.

## 1.3.1 — B/C/D build engines verified side by side

Continues 1.3.0's lightweight engineering. No runtime or UI change.

- **C engine added**: `scripts/build-client-concat.mjs` builds the same loader bundle
  from `src/client/` with **no bundler and no devDependencies** (ordered concatenation,
  import/export stripping, duplicate-declaration guard). `npm run build:concat`.
- **D preserved explicitly**: the committed `plugin/client.js` remains a self-contained
  artifact — installs and runtime never build, and devDependencies are not required to
  install or load the plugin.
- **`scripts/verify-build.mjs` (37 checks)**: both engines are deterministic, keep the
  single-file loader contract (only the `react` seed, no sibling imports), expose the same
  registration surface (inject, main key, sidebar id/order, 615 zh + 615 en dictionary keys),
  and each engine is rendered through the real 10-tab suite (215 assertions) and the mapped
  Windows scenario (32 assertions).
- **CI** now runs the B/C/D conformance step between typecheck and the five offline suites.
- Implements the review's "B + C + D (supplements ×2)" outcome: esbuild primary, no-bundler
  fallback, zero-build artifact, plus JSDoc/tsc and GitHub Actions CI.

## 1.3.0 — light-weight engineering: module split, bundle build, type check, CI

No user-facing behaviour change; the delivery pipeline was made maintainable.

- **Client source split**: `plugin/client.js` is now a generated esbuild bundle. The editable
  source lives in `src/client/` (`entry`, `runtime`, `core`, `dicts`, `styles`, `helpers`,
  `constants`, `normalizers`, `api`); the module-loader contract is unchanged (single file served,
  `require("react")` still comes from the loader, no extra runtime dependency).
- **`npm run build` / `build:check`**: esbuild (IIFE, minify, es2020) emits the single-file
  `plugin/client.js` (287 KB → 203 KB) and `--check` fails when the committed artifact is stale.
- **JSDoc + TypeScript**: `tsconfig.json` enables `allowJs`/`checkJs` (with `strictNullChecks`)
  over `plugin/index.js` and `plugin/host/**/*.js`; `npm run typecheck` is 0-error and enforced in
  CI. Comment-only fixes plus a few `@type` annotations; no runtime behaviour changed.
- **Client render tests are now in the repo**: `scripts/render-check.mjs` (10 tabs, 215
  assertions) and `scripts/render-windows-check.mjs` (mapped Windows data, 32 assertions), driven
  by React 18 + jsdom devDependencies.
- **CI**: `.github/workflows/verify.yml` runs build freshness, typecheck, both render suites and
  the five offline verification scripts on every push/PR.
- `package-lock.json` committed for reproducible `npm ci`.

## 1.2.0 — sensors, drivers, cleanup and a repeatable benchmark

New capabilities on top of the 1.1.x Windows/i18n work, all reachable from the panel and the
Host API/tools:

- **Thermals**: `metrics.thermal` with CPU / GPU / battery / SSD temperatures, fan readings and
  macOS thermal pressure. macOS reads the battery sensor + `NSProcessInfo` pressure and unlocks
  CPU/GPU through an optional `smctemp` / `osx-cpu-temp` helper or a root Host (`powermetrics`);
  Windows reads ACPI thermal zones via WMI plus optional `nvidia-smi`. Unsupported sources degrade
  to `null` with an explicit `note`, never a fabricated number.
- **Read-only driver inventory**: `hardware.drivers` / `driverSummary` / `driverProblems` —
  macOS kernel extensions and DriverKit extensions via `system_profiler` (third-party first,
  capped at 250), Windows signed PnP drivers + devices with a `ConfigManagerErrorCode`.
  Searchable card inside the Hardware tab; no update or rollback is attempted.
- **Cleanup**: new allowlist-only scanner (user caches, logs, trash, developer caches,
  crash reports) with bounded walking, a 60 s cache, and a `cleanup.delete` action that can only
  delete fixed allowlisted paths after an explicit confirmation. New **Cleanup** tab shows sizes,
  categories, admin requirements and per-item errors.
- **Repeatable benchmark**: fixed-work CPU (single + multi-thread), memory-bandwidth and disk tests
  behind `POST /devicex/api/benchmark` and a `device_benchmark` agent tool. New **Benchmark** tab
  shows scores, units, durations, the machine environment and a delta against the previous run.
  Scores are explicitly local-comparison only.
- New tabs (10 total), zh/en copy for every new surface, and two new docs
  (`cleanup-contract.md`, `benchmark-contract.md`) plus thermal/driver sections in the Windows
  contract.
- Verification grown from 66 + 155 checks to **91 + 167 + 57 + 130 + 46** offline checks, plus
  **215** jsdom render assertions over all ten tabs.


## 1.1.5 — cheaper 3D motion

- The overview 3D scene's core pulse animated `box-shadow` on every frame. Inside the
  `preserve-3d` scene that forced a continuous repaint and was the dominant cost of the scene
  (measured in headless Chrome: the scene alone sustained ~58% of one CPU core, and removing just
  the pulse dropped it to ~36%). The pulse now animates the **opacity of a dedicated halo**
  (`.dx-chipGlow`), which the compositor can run without repainting; the transform-animated layers
  (orbits, chip float, particles) get `will-change: transform` to stay on the compositor.
- The scene pauses itself through `IntersectionObserver` + `visibilitychange` when the card is
  scrolled out of view or the window is hidden, in addition to the existing reduce-motion and 3D
  toggle.
- Same benchmark scene after the change: ~58% → ~37% of one core (software raster) and ~34% → ~14%
  (GPU path). A fixed-phase before/after render is visually equivalent (only the glow halo is
  slightly softer).
- `scripts/verify.mjs` guards the no-`box-shadow`-animation rule and the visibility pause
  (73 checks).

## 1.1.4 — visible switch thumb in both themes

- The switch thumb used `--dsw-alias-label-primary`, which equals `--dsw-alias-brand-primary` in
  both shipped themes, so an enabled switch rendered as a featureless solid pill (no knob) and the
  disabled thumb was the brightest element. It now mirrors the harness's own switch:
  `--dsw-alias-label-primary-foreground` for the enabled thumb and `--dsw-alias-switch-thumb` for the
  disabled one (track off state uses `--dsw-alias-border-l3`). Affected the Launch agents "Loaded"
  column and every boolean parameter switch in action forms.
- `scripts/verify.mjs` guards the two theme tokens (71 checks).

## 1.1.3 — publish under the @cfour-hi scope; dist/ untracked

- Rename the plugin package from `@local/dsh-devicex` to `@cfour-hi/dsh-devicex` in both manifests,
  the bundle patch row, the browser module id and the docs. GitHub installs now record the dependency
  under the real scope; a profile that still holds the old name must remove it before reinstalling
  (`dsh plugin --profile <profile> remove @local/dsh-devicex`).
- Stop tracking `dist/`: the tarball is a build artifact
  (`cd plugin && npm pack --pack-destination ../dist`) that can be attached to a GitHub Release;
  GitHub installs read the source directly and no longer need a committed tarball. `.gitignore` now
  covers `dist/`.
- `scripts/verify.mjs` derives the package name from the manifest instead of hardcoding it, so a
  future rename cannot silently desynchronize the patch row and the browser module id.

## 1.1.2 — install from a GitHub repository URL

- Installing the plugin straight from its GitHub link failed: the plugin package lives in `plugin/`
  and the repository root had no `package.json`, so pnpm installed the repository as a `0.0.0`
  placeholder package. DSH then rejected it (`not-bundle` in the Plugins page / "declares no
  dsh.bundle — installed as a plain dependency" from the CLI), because a bundle must be declared by
  the package at the installed (repository-root) path.
- Add a thin root `package.json` as the Git-install manifest: it declares `dsh.bundle` / `dsh.client`
  like the plugin manifest and maps `exports` (`.`, `./client`, `./locale/*.json`, `./icon`,
  `./package.json`) into `plugin/`. `plugin/package.json` remains the local-link and tarball
  manifest; local installs, the tarball layout and the Windows/macOS code are unchanged.
- `scripts/verify.mjs` now checks that both manifests stay in sync and that every exported resource
  actually resolves through the root manifest (70 checks, up from 66).
- Docs: README / `docs/INSTALL.md` add GitHub-link installation (CLI, in-app `install_bundle`, the
  Plugins page) and describe the root-manifest requirement; `docs/build-contract.md` records it.
- Refresh `dist/local-dsh-devicex-1.1.2.tgz`.

## 1.1.1 - first-open fixes (Windows)

- Client kept the platform returned by `/devicex/api/actions` out of its catalogue state, so
  Windows-only UI branches (winget card, BitLocker/Secure Boot/Defender labels, "Startup items",
  Windows Security pane button) silently rendered the macOS variants. The platform is now persisted.
- First open of a tab could sit on the loading state for a long time on Windows (each cold section
  costs a PowerShell start). The panel now prefetches every section after mount (staggered, the Host
  deduplicates against its own warmup), prefetches on tab hover/focus, retries a failed cold section
  once automatically, and shows a localized loading hint under the skeleton.
- Real-Chrome screenshots with mapped Windows data confirm the Windows Security/Software/system
  branches render correctly; the Windows-data jsdom pass covers all eight tabs (32/32) with no
  console errors or error-boundary fallbacks.

## 1.1.0 — Windows adaptation

- Host halves become platform implementations behind dispatchers: `collector.js` / `actions.js`
  select `darwin` or `win32` by `process.platform`.
- New Windows implementation: PowerShell/CIM collectors for all six sections, 18 whitelisted actions
  (Stop-Process / Start-Process / Rename-Computer / registry dark mode / startup entries / ms-settings /
  firewall / DNS / Wi-Fi / winget uninstall / sleep / lock), bundled `.ps1` scripts, and a `win.js`
  bridge (`pwsh.exe` → Windows PowerShell 5.1, encoded commands, UTF-8, timeout, JSON tolerance).
- Browser UI becomes Windows-aware: winget card, Windows uninstall ids, kill signals derived from the
  live action catalogue, `platform` passed to tabs.
- `dsh.bundle.platforms` now `["darwin","win32"]` (Linux is rejected at install/activation).
- Verification: `scripts/verify.mjs` (66 checks) + new `scripts/verify-windows.mjs` (155 checks:
  bridge, `.ps1` static checks, fixture-driven mappers, action guards, client metadata, plus an
  end-to-end simulated `win32` Host with fixture-backed PowerShell). Windows runtime is fixture/
  static verified only — real Windows 10/11 hardware still needs a manual pass.

## 1.0.0 — initial release

- macOS device dashboard: eight tabs, SVG charts, CSS-3D overview, zh/en, theme tokens only.
- 18 whitelisted device actions, secured same-origin HTTP API (Connection trust fence), agent tools
  `device_info` / `device_control`.
