# Changelog

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
