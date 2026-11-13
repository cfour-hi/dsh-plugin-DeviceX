# Device X · dsh-plugin-devicex

[简体中文](README.md) | English

![Device X: the whole machine on one page](docs/promo/banner-en-1280x640.jpg)

One page, in Chinese or English, shows you the whole machine — hardware, system, software, network,
security and processes — and lets you act on everything **that isn't hardware**: end processes,
uninstall apps and clean up their leftovers, change hostname/volume/dark mode, toggle Wi-Fi/firewall,
set DNS, empty the Trash, sleep or lock the screen… It also ships confirmable disk cleanup and a
repeatable local benchmark. The same capabilities are exposed to agent models as three tools:
`device_info` / `device_control` / `device_benchmark`.

**Platforms**: macOS and Windows 10/11. The Host picks an implementation by `process.platform`
(`darwin` uses system commands, `win32` uses PowerShell/CIM); the browser UI, HTTP API and agent tools
are identical on both.
**Entry**: the **Device X** icon at the bottom of the left sidebar → the centre panel. Colours come only
from theme tokens, so it follows light/dark mode and honours `prefers-reduced-motion`. A failed action
reports its error only inside the relevant card or dialog; it never takes down the page.

## Interface

> Screenshots are real renders of the plugin UI (the Chinese locale is shown; the panel also ships a
> full English dictionary and follows the host locale). Hostname, account, serial, MAC and LAN addresses
> are replaced or hidden.

![Overview](docs/images/overview.png)

![Hardware](docs/images/hardware.png)

<p align="center">
  <img src="docs/images/network.png" width="49%" alt="Network tab">
  <img src="docs/images/cleanup.png" width="49%" alt="Cleanup tab">
</p>

| Tab | Contents |
|---|---|
| Overview | CSS 3D device core, five donut KPIs, sparklines, top processes, derived alerts |
| Hardware | CPU and per-core usage, memory, graphics & displays (GPU/displays in one card), disk, battery health, thermals & cooling, drivers, connected devices (USB/Bluetooth switch), audio, cameras |
| System | OS & kernel, model & serial, uptime, user table, login items & LaunchAgents (enable/disable), environment variables |
| Software | App search/filter/sort, reveal, uninstall (with [leftover cleanup](#uninstall-leftover-cleanup)); Homebrew / winget list (switch beside the title, outdated tag with hover tooltip) |
| Network | Interfaces, Wi-Fi signal, DNS, default route, proxy, TCP listeners & connection counts; toggle Wi-Fi, set DNS |
| Security | FileVault/SIP/Gatekeeper/TCC or BitLocker/Defender/UAC, firewall, administrators, privacy settings panes, flush DNS |
| Processes | Searchable, sortable process table; end per row (TERM/KILL/INT/STOP/CONT) with confirmation |
| Cleanup | Scan caches/logs/Trash/developer caches, showing size and file count; select, then confirm before deleting |
| Benchmark | CPU single/multi-core, memory bandwidth, disk read/write; compare with the last run — only meaningful on the same machine over time |
| Actions | 19 allowlisted actions grouped on screen, forms generated from the parameter catalogue, dangerous actions double-confirmed, plus action history |

## Action catalogue (19 items, allowlist + strict parameter validation)

| Action | Description |
|---|---|
| `process.signal` | TERM/KILL/INT/STOP/CONT; refuses PID 1 and the Host process itself |
| `app.quit` / `app.launch` / `app.reveal` | Quit / launch / reveal in the file manager |
| `app.uninstall` | Uninstall an `.app` or an MSI/winget/registry entry; on macOS limited to three app directories and refuses system apps; optional cascading leftover cleanup |
| `system.setHostname` | HostName / ComputerName / LocalHostName (character and length validation) |
| `system.setVolume` / `system.setDarkMode` | Volume 0–100 / dark mode |
| `system.launchAgent` | Load or unload a LaunchAgent or Windows startup item (path allowlist) |
| `system.openSettings` | Open a System Settings pane (23-item allowlist) |
| `system.toggleFirewall` / `system.flushDNS` / `system.emptyTrash` | Firewall toggle / flush DNS / empty the Trash or Recycle Bin |
| `cleanup.delete` | Delete scanned, selected items; accepts only fixed ids returned by the scan, never paths (1–20, deduplicated) |
| `network.setWifiPower` / `network.setDns` | Wi-Fi toggle / set 0–4 DNS servers (accepts a service name or interface name) |
| `power.sleep` / `power.lock` | Sleep / lock |
| `software.brewUninstall` / `software.wingetUninstall` | Uninstall a package-manager formula or package |

Windows keeps the same action ids with platform implementations: `Stop-Process`, `Rename-Computer`,
`ms-settings:`, `Enable/Disable-NetAdapter`, `Set-DnsClientServerAddress`, `Clear-RecycleBin` and so on.
`app.uninstall` switches its parameter to `id` (`msi:{GUID}` / `winget:<id>` / an uninstall registry key).
No arbitrary shell strings are ever executed.

**Security model**: same-origin `/devicex/api/*`, behind DSH's Connection trust fence (signed session
cookie + Host/Origin validation; unauthenticated 401, cross-origin 403). Child processes always use
`execFile` with an argument array, never a shell; path parameters are checked against allowed roots and
suffixes; every action — failed ones included — lands in a 50-entry ring history.

## Uninstall leftover cleanup

Dragging an app to the Trash deletes only the `.app`; its data stays behind in `~/Library`. Before
uninstalling, Device X scans those scattered data directories and **lists them for per-item selection**.

| Tier | Basis | Preselected |
|---|---|---|
| A · high confidence | Bundle ID match, MSIX package container, Homebrew cask `zap` list | ✅ |
| B · name candidate | Directory name resembles the app name and matches exactly one installed app | ❌ |
| C · conflict candidate | The same directory matches ≥2 installed apps | ❌ |
| D · shared/restricted | Vendor-level directory (`Google/`, `Microsoft/`) or needs administrator rights | No checkbox |

B/C are shown but not preselected — in a real measurement `Application Support/Claude-3p` held 11 GB
yet contained no bundle id, so only the name heuristic could find it; hiding it would silently give up
11 GB on the user's behalf. The modal footer always shows "N more items unselected (X total)".

**Deletion never accepts a path**: `GET /devicex/api/footprint` is a read-only scan returning a one-time
`scanId`; full paths stay in Host memory. The browser only receives item ids, and `app.uninstall` sends
`scanId` + `itemIds`. The Host verifies the token is unexpired, unused and belongs to that scan, and that
after `realpath` the item is still inside an allowed root, is not a root directory and is not a symlink.

**Pipeline**: scan → select → uninstall the app → verify it really is gone → rescan → move each item to
the Trash. If the uninstall fails or is cancelled, the pipeline **aborts globally and not a single byte
is deleted**; a running app is rejected outright; lacking a bundled uninstaller is not a failure; macOS
does not run in-bundle uninstallers (neither of the two existing ones has a verifiable CLI contract).
Everything is moved to the Trash, and the result page states "Emptying the Trash frees X".

Windows can list but not clean: moving items to the Recycle Bin requires the shell and has not been
verified on real hardware, so a request carrying a `scanId` returns `UNSUPPORTED_PLATFORM` rather than
silently discarding the user's selection. See the [design doc](docs/uninstall-footprint-design.md).

## Agent tools

- `device_info`: `section` picks one of eight sections, `fresh` bypasses the cache.
- `device_control`: `action` + `params`, sharing the exact same implementation as the UI — never two sets of logic.
- `device_benchmark`: `tests?`, `repeat?`, using the same engine as the Benchmark tab.

## HTTP API

All prefixed with `/devicex/api`, same-origin, `cache-control: no-store`.

| Path | Description |
|---|---|
| `GET /metrics` | Live metrics (the UI polls every 2.5 s) |
| `GET /inventory[?section=&fresh=1]` | Full inventory or a single section |
| `GET /actions` · `POST /action` | Action catalogue / run an action (a business failure is still HTTP 200) |
| `GET /cleanup[?fresh=1]` | Allowlisted cleanup scan (60 s cache) |
| `GET /footprint[?path=&fresh=1]` | Read-only leftover scan, returns a one-time `scanId` |
| `POST /benchmark` | Run the benchmark (body: `{ tests?, repeat? }`) |

## Architecture

```
plugin/
├── index.js              # Host entry: warmup + 7 routes + 3 tools
├── host/
│   ├── collector*.js     # Platform collectors (system commands / PowerShell+CIM), TTL cache & warmup
│   ├── actions*.js       # 19 allowlisted actions, one implementation per platform
│   ├── cleanup*.js       # Allowlisted cleanup scan and deletion
│   ├── footprint*.js     # Leftover scan: pure core + platform impl + one-time token
│   ├── uninstall.js      # Uninstall pipeline (validation gates, zero side effects on failure)
│   ├── benchmark.js      # CPU/memory/disk benchmark (worker_threads)
│   ├── win.js + win/*.ps1 # PowerShell bridge and seven read-only collector scripts
│   ├── transport.js      # Route registration + trust fence + JSON envelope
│   └── tool.js           # Schemas and rendering for the three agent tools
└── client.js             # Build artifact (don't edit by hand; change the source, then npm run build)

src/client/               # Browser-side TSX source (10 tabs + 44 components)
```

The browser half is bundled by esbuild into a single IIFE (225 KB, requesting `react` from the loader
exactly once); the committed `plugin/client.js` is self-contained with zero runtime dependencies. In an
environment without a bundler, `npm run build:concat` produces an equivalent artifact (322 KB).
[types/contracts.ts](types/contracts.ts) is a pure type file defining the frozen shapes shared by
Host ↔ API ↔ client.

## Verification

```sh
npm run verify:ci    # one command for the whole gate (same as CI)

# Or run them individually:
npm test                          # 119 unit tests
node scripts/verify.mjs           # 96 general regression checks
node scripts/verify-windows.mjs   # 167 Windows adaptation checks (fixtures, no real machine needed)
node scripts/verify-sensors.mjs   # 57 thermal/driver checks
node scripts/verify-cleanup.mjs   # 130 cleanup checks (real scan + sandboxed deletion)
node scripts/verify-benchmark.mjs # 46 benchmark checks
node scripts/verify-footprint.mjs # 72 uninstall-leftover checks
node scripts/render-check.mjs     # 282 client render assertions
```

`verify-footprint.mjs` pins the pitfalls found during real measurements as regressions: Team ID prefixes,
`Claude-3p` name matching, vendor-directory false positives, single-use tokens and cross-scan mixing,
zero side effects when uninstall fails, and `moveToTrash` never overwriting an existing item.

## Known limitations

- **Windows has not been verified on real hardware**: everything passes via fixtures, static checks and a
  simulated win32 Host. Real PowerShell 5.1 CIM field differences and admin-required queries/actions
  still need confirmation on a physical machine.
- **Uninstall leftovers (Windows)**: listing only, not cleaning — see above.
- Admin-required actions (hostname, firewall, startup items, DNS, Wi-Fi toggle) return the command error
  verbatim on failure; they never pretend to have succeeded.
- macOS automation permission (quit app, dark mode, lock screen) may be denied by TCC on first use;
  Apple Silicon does not expose CPU/GPU temperature to normal users, so `thermal.cpuCelsius` is `null`
  with an explanatory `note` rather than a fabricated value.
- Cleanup and leftovers: `~/.Trash` and some system caches are TCC-protected, so a scan honestly returns
  `EPERM`. The pipeline does not depend on enumerating the Trash and does not promise "always restorable".
- Benchmark scores are only for comparing the same machine over time, not against other benchmark suites;
  machine load affects a single run.
- The port list contains TCP LISTEN sockets only; non-admin users cannot see ports of some system processes.

## Installation

```sh
# Install straight from GitHub (the other side needs no local source)
dsh plugin --profile desktop add https://github.com/cfour-hi/dsh-plugin-devicex

# Or from a local directory / tgz
npm run release:pack
dsh plugin --profile desktop add /absolute/path/cfour-hi-dsh-plugin-devicex-<version>.tgz
```

A running session can also hot-install without a restart via
`plugin_manager action=install_bundle target=<path or repository URL>`. The root `package.json` is the
Git-install entry point, while `plugin/package.json` serves local linking and tgz packages; the two
manifests must stay in sync (`verify.mjs` checks them field by field). Full steps are in
[docs/INSTALL.md](docs/INSTALL.md).

## Development

After changing `plugin/`, re-run `install_bundle` or restart Harness. For UI changes, edit `src/client/`
and run `npm run build` (CI rejects stale artifacts), then `npm run verify:ci`.

## License

[MIT](LICENSE) © 2026 cfour-hi. The root `LICENSE` is the single source of truth; `plugin/LICENSE` is
the packaged copy and must be byte-identical.

---

More detail: [Build contract](docs/build-contract.md) · [Windows contract](docs/windows-contract.md) ·
[Release flow](docs/RELEASE.md) · [Install guide](docs/INSTALL.md)
