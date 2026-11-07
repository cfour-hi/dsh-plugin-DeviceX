# Device X — Windows adaptation contract

Goal: make the plugin work on **Windows 10/11 (win32)** with the same browser UI, HTTP API and agent
tools as macOS. The Host half gets a second implementation selected by `plugin/host/collector.js` /
`plugin/host/actions.js`; the browser half stays cross-platform.

The public data contract is `docs/build-contract.md`: `Metrics`, the six section shapes, `Inventory`,
`Action`, `ActionLogEntry`, the four HTTP routes and the two agent tools. **Windows must produce the
same shapes** — nulls where data is genuinely unavailable, never `undefined`/NaN/cycles.

## Layout (Lead already created the dispatchers and the PowerShell bridge)

```
plugin/host/
├── collector.js           # dispatcher: darwin | win32  (Lead, frozen)
├── actions.js             # dispatcher: darwin | win32  (Lead, frozen)
├── collector-darwin.js    # original macOS implementation (frozen)
├── actions-darwin.js      # original macOS implementation (frozen)
├── proc.js                # execFile helper (frozen)
├── win.js                 # PowerShell bridge (Lead, frozen)
├── collector-win32.js     # WIN-COLLECTOR owns (placeholders now)
├── actions-win32.js       # WIN-ACTIONS owns (placeholder now)
└── win/                   # WIN-COLLECTOR owns: bundled .ps1 scripts
    ├── metrics.ps1
    ├── hardware.ps1
    ├── system.ps1
    ├── software.ps1
    ├── network.ps1
    ├── security.ps1
    └── processes.ps1
```

`plugin/index.js`, `client.js`, `package.json`, `docs/`, `scripts/verify*.mjs` are Lead-owned. Do not
edit them.

## `host/win.js` bridge (use it; do not spawn PowerShell yourself)

```js
import { runPS, runPSJson, readScript, psString, resolveInterpreter } from './win.js';

// Runs Windows PowerShell 5.1 (preferred; DEVICEX_PWSH overrides) or pwsh 7 as
// `-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -` and streams
// the script over the child's stdin (plus a UTF-8 console prefix). Scripts are
// NOT encoded into argv: Windows caps a command line at 32,767 chars and the
// bundled collectors are larger once encoded. Never throws; no shell.
const result = await runPSJson(scriptText, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
// { ok: true, data }  |  { ok: false, error, raw, stderr }

const script = readScript('metrics.ps1');           // cached read from host/win/
const env = { DEVICEX_ARG_PID: '1234' };            // parameters go via env vars
const out = await runPSJson(script, { env });
```

Conventions for bundled `.ps1` scripts:

- Start with `$ErrorActionPreference = 'Stop'`. Failures are caught by the JS side; a hard failure
  should `throw` / exit non-zero so `runPSJson` reports it (no silent empty output).
- Read parameters from `$env:DEVICEX_ARG_*`; never interpolate JS input into script text.
- Emit **exactly one** `ConvertTo-Json -Depth 8 -Compress` document on stdout (no other stdout text;
  write diagnostics to stderr).
- ConvertTo-Json collapses single-element arrays in old PowerShell versions: emit arrays as object
  properties and have the JS mapper normalize with a tolerant `asArray()` helper.
- Use CIM/registry/cmdlets available in Windows PowerShell 5.1 (`Get-CimInstance`, `Get-NetAdapter`,
  `Get-Process`, `Get-ItemProperty`, `Get-LocalUser`, `Get-PnpDevice`, `netsh`, `ipconfig`).
- Read paths that need no admin must not require elevation. Admin-only actions fail with the command
  error text when not elevated (never silently pretend success).
- No network calls, no extra modules, no `Install-Module`.

## Collector requirements (`collector-win32.js`)

Match `collector-darwin.js` surface exactly:

```js
export const PLATFORM = 'win32';
export const SECTIONS = ['hardware','system','software','network','security','processes'];
export function warmup();
export async function collectMetrics();                     // fast poll, never throws
export async function collectSection(section, {fresh}={}); // unknown section throws; else errors[]
export async function collectInventory(options={});
export function clearCache(section);
export const __test = { /* pure mappers used by scripts/verify-windows.mjs */ };
```

Add a tolerant `asArray()` and export pure mapping functions (`mapMetrics`, `mapHardware`,
`mapSystem`, `mapSoftware`, `mapNetwork`, `mapSecurity`, `mapProcesses`) under `__test` so the offline
verification can feed realistic CIM JSON fixtures without Windows or PowerShell.

Data sources:

| Domain | Source |
|---|---|
| CPU | `Win32_Processor` (Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, Architecture); CPU % from `os.cpus()` deltas (same algorithm as darwin `cpuUsage()`) |
| Memory | `Win32_OperatingSystem` TotalVisibleMemorySize/FreePhysicalMemory/TotalVirtualMemorySize/FreeVirtualMemory; modules `Win32_PhysicalMemory` (Capacity, Speed, Manufacturer, PartNumber, DeviceLocator) |
| Disks | `Win32_DiskDrive` (Model, Size, MediaType, InterfaceType, SerialNumber), `Win32_LogicalDisk` fixed drives (DeviceID→mount, Size, FreeSpace, FileSystem), `Get-Volume` / `Get-Partition` |
| GPU | `Win32_VideoController` (Name, AdapterRAM, DriverVersion, VideoProcessor) |
| Displays | `Win32_VideoController` CurrentHorizontalResolution/CurrentVerticalResolution/CurrentRefreshRate; optional `WmiMonitorID` |
| Battery | `Win32_Battery` (EstimatedChargeRemaining, BatteryStatus) + `root\wmi BatteryFullChargedCapacity`, `BatteryStaticData` (DesignedCapacity, CycleCount), `BatteryStatus` (Temperature) |
| USB / Bluetooth / Audio / Camera | `Get-PnpDevice -Class USB / Bluetooth / AudioEndpoint|MEDIA / Camera|Image` (FriendlyName, Status, InstanceId) |
| OS | `Win32_OperatingSystem` (Caption, Version, BuildNumber, InstallDate, LastBootUpTime), `Get-CimInstance Win32_ComputerSystem` (Manufacturer, Model, TotalPhysicalMemory, UserName), `Win32_BIOS` (SerialNumber), `Get-CimInstance Win32_BaseBoard` |
| Users | `Get-LocalUser`, `Get-LocalGroupMember -Group Administrators`, `os.userInfo()` for current |
| Startup | `Win32_StartupCommand` + registry `HKCU/HKLM:\Software\Microsoft\Windows\CurrentVersion\Run` (map to `launchAgents[]`, see actions pseudo-path) |
| Installed apps | registry Uninstall keys (`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall`, `HKLM\Software\WOW6432Node\...`, `HKCU\...`): DisplayName, DisplayVersion, InstallLocation, Publisher, EstimatedSize; expose `uninstallId` = `<HIVE>:<full key path>` and `bundleId` = registry key name |
| Network | `Get-NetAdapter`, `Get-NetIPConfiguration`, `Get-NetIPAddress`, `Get-NetRoute -DestinationPrefix 0.0.0.0/0`, `Get-DnsClientServerAddress`, `Get-NetTCPConnection -State Listen|Established` (join OwningProcess with Get-Process), proxy from `HKCU\...\Internet Settings`; Wi-Fi via `netsh wlan show interfaces` (SSID, Signal %, State, Channel when present) |
| Security | `Get-BitLockerVolume` (device encryption) with `manage-bde -status` fallback, `Get-MpComputerStatus` (Defender), `Get-NetFirewallProfile`, `Confirm-SecureBootUEFI` (try/catch), UAC `EnableLUA` registry, `Get-LocalUser`/admins; TCC equivalent → `{ readable:false, reason:'Windows does not expose a per-app consent store', grants:[] }` |
| Processes | `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process` (PercentProcessorTime, WorkingSetPrivate) or `Get-Process`; name/pid/user/state/start; top 200 by CPU |

Recommended TTLs: metrics stateful (no TTL, deltas), hardware 300 s, system 120 s, software 600 s,
network 15 s, security 60 s, processes 30 s. `warmup()` primes slow sections in the background.

## Action catalog for win32 (`actions-win32.js`)

Same surface as darwin (`GROUPS`, `actionCatalog()`, `actionHistory()` max 50 newest-first,
`runAction()` never throws for bad input, JSON-safe results, strict validation, guards). Same result
union. Parameters reach PowerShell via `$env:DEVICEX_ARG_*`; validate everything in JS first.

| id | group | params | Windows implementation |
|---|---|---|---|
| `process.signal` | process | `pid:number`, `signal:select(TERM,KILL,INT)` default TERM | TERM→`Stop-Process -Id` (no -Force); KILL/INT→`Stop-Process -Force`; reject pid 1, self, parent |
| `app.quit` | app | `name:string` | `Stop-Process -Name <process name>` (validate `[A-Za-z0-9._ -]{1,128}`); friendly error when no match |
| `app.launch` | app | `path:string` | `Start-Process -FilePath <abs path>` (must exist) |
| `app.reveal` | app | `path:string` | `Start-Process explorer.exe -ArgumentList '/select,"<path>"'` |
| `app.uninstall` | app | `id:string` | `msi:{GUID}` → `msiexec /x {GUID} /qn`; `winget:<id>` → `winget uninstall --id <id> --silent --accept-source-agreements --accept-package-agreements`; registry form `<HKLM|HKCU>:<path under Uninstall>` → read DisplayName/UninstallString, convert `MsiExec.exe /I{...}` to `/x{...} /qn`, otherwise `Start-Process` the stored exe with parsed args (never Invoke-Expression); validate GUID/hive/key path strictly |
| `system.setHostname` | system | `kind:select(ComputerName)`, `value:string` | `Rename-Computer -NewName <value> -Force` (admin; reboot required — say so in the message); value `^[A-Za-z0-9-]{1,63}$` |
| `system.setVolume` | system | `percent:number 0..100` | CoreAudio `IAudioEndpointVolume` via `Add-Type` P/Invoke-ish C# snippet (inline `Add-Type -TypeDefinition`, singleton per process is impossible — each call re-adds a uniquely named type) |
| `system.setDarkMode` | system | `enabled:boolean` | registry `HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`: AppsUseLightTheme + SystemUsesLightTheme 0/1 |
| `system.launchAgent` | system | `path:string`, `enabled:boolean` | startup entries: `path = startup:<HKCU|HKLM|HKLM32>:<ValueName>` (HKLM32 = WOW6432Node Run key); disable removes the Run value and stores `{name,command}` under `HKCU:\Software\DeviceX\DisabledStartup\<HIVE>`; enable restores from there. Reject other path forms |
| `system.openSettings` | system | `pane:select(display,sound,bluetooth,apps,privacy,network,wifi,windowsupdate,windowsdefender,storage,battery,power,users,datetime,language,defaultapps,startup)` | `Start-Process ms-settings:<uri>`, where the frozen option name maps to its canonical URI: apps→appsfeatures, wifi→network-wifi, storage→storagesense, battery→batterysaver, power→powersleep, users→otherusers, datetime→dateandtime, language→regionlanguage, startup→startupapps, windowsdefender→windowsdefender; the rest are identical |
| `system.toggleFirewall` | system | `enabled:boolean` | `Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True/False` (admin) |
| `system.flushDNS` | system | — | `Clear-DnsClientCache`, fallback `ipconfig /flushdns` |
| `system.emptyTrash` | system | — | `Clear-RecycleBin -Force -ErrorAction Stop` |
| `network.setWifiPower` | network | `enabled:boolean` | resolve wireless adapter (`Get-NetAdapter -Physical` where InterfaceDescription matches `Wi-Fi|Wireless|WLAN`), `Enable-NetAdapter`/`Disable-NetAdapter -Confirm:$false` (admin) |
| `network.setDns` | network | `service:string`, `servers:string \| string[]` (0–4 valid IPs) | validate alias via `Get-NetAdapter`, `Set-DnsClientServerAddress -InterfaceAlias <alias> -ServerAddresses <...>` (admin); `servers` as string or array like darwin, empty = clear |
| `power.sleep` | power | — | `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` (document hibernate caveat in message) |
| `power.lock` | power | — | `rundll32.exe user32.dll,LockWorkStation` |
| `software.wingetUninstall` | software | `id:string` | validate `[A-Za-z0-9._+-]{1,200}`, `winget uninstall --id <id> --silent --accept-source-agreements` |

`requiresAdmin: true` for: `system.setHostname`, `system.launchAgent` (HKLM only — keep true),
`system.toggleFirewall`, `network.setWifiPower`, `network.setDns`. Failure messages carry the
PowerShell/command error text. `danger` per darwin (`high` for uninstall/hostname/firewall/DNS,
medium for signal/launchAgent/emptyTrash/wifi, low for the rest).

Include `__test = { actionIds, validate: {...} }` so `scripts/verify-windows.mjs` can assert the
catalog and exercise guards without Windows.

## Known Windows-only limitations (documented, not hidden)

- `HKCU`-scoped actions (dark mode, `startup:HKCU` toggles) and the reported current user apply to the account
  the Host process runs as (`$env:USERNAME`); if the Host is elevated or runs as a service they may target a
  different profile than the interactive desktop user.
- Bluetooth `connected`/battery and audio `default` come from PnP/MMDevices registry data; values that Windows
  does not expose are reported as false/absent rather than invented.
- The metrics poll costs one PowerShell startup plus ~20 CIM queries (~0.5–1.5 s real hardware), so Windows uses
  a 2.5–3 s metrics TTL instead of the macOS <250 ms budget; the UI's 2.5 s cadence is unaffected.
- `Win32_VideoController.AdapterRAM` is a UInt32 (caps at 4 GB); the qwMemorySize registry fallback covers most
  dedicated GPUs. When neither value can establish the real size, VRAM is reported as `null` plus an `errors[]`
  annotation instead of a bogus number.
- `Clear-RecycleBin`, BitLocker/Defender reads and all admin actions can fail without elevation; they surface the
  real command error instead of pretending success.

## Testing each owner must do before reporting

- `node --check` on every file you wrote.
- WIN-COLLECTOR: write realistic CIM fixture JSON under `scripts/fixtures/win32/` (one per PS script)
  and a temp harness that calls your exported `__test.mapX(fixture)` for all six sections + metrics;
  assert the exact contract keys/types, JSON-safety, and that empty/failed input still returns the
  shape with `errors[]`. Verify the `.ps1` files are valid text and only use allowed cmdlets (static
  review). Document every field whose real Windows value you could not verify.
- WIN-ACTIONS: a temp harness under `/tmp` that imports `actions-win32.js` and checks: catalog ids
  match the table above, every param validation rejects bad input without spawning PowerShell,
  `runAction('nope')` → UNKNOWN_ACTION, guards (pid 1/self, path roots, GUID/token validation) hold.
  Also confirm that a valid-looking invocation on this macOS host fails cleanly with a PowerShell/
  command failure (no throw, `ok:false`).
- Report files, evidence, deviations (state them, do not silently change frozen shapes), and what
  still needs a real Windows machine.

Constraints: no installs, no plugin_manager calls, no profile changes, no other workspace files.
Scratch files under `/tmp/devicex-win-<owner>/`.
