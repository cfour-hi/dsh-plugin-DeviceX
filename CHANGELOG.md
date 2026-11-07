# Changelog

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
