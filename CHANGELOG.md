# Changelog

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
