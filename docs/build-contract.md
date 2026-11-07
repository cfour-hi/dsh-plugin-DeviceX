# Device X — build contract

> **Platform note (2026-11, Windows adaptation):** the macOS implementation of this contract lives in
> `plugin/host/collector-darwin.js` / `actions-darwin.js`; `plugin/host/collector.js` / `actions.js` are
> platform dispatchers (`darwin` | `win32`). The Windows implementation keeps every JSON shape and the
> action/tool surface below, with platform equivalents documented in
> [`windows-contract.md`](windows-contract.md). `dsh.bundle.platforms` limits installation to
> `darwin` + `win32`.

Single source of truth for the three build workstreams. Do not edit files outside your assigned scope.
Lead owns integration, installation and end-to-end verification.

## Product

A persistent DSH (DeepSeek Harness) plugin, installed into the `desktop` profile, that gives the
user one elegant page to see **everything** about the current machine (hardware, system, software,
network, security, processes) and to **operate** everything that is not hardware (kill/suspend
processes, quit/launch/uninstall apps, toggle launch agents, change host name / volume / dark mode /
Wi-Fi / DNS, uninstall Homebrew formulas, flush DNS, empty trash, sleep/lock, open the right System
Settings panes, …). A **main panel** page (same placement as the shipped "Plugins" page) hosts the
dashboard; a sidebar panel icon opens it. The Host half also exposes two agent tools
(`device_info`, `device_control`) that call the same Host operations as the UI.

The page must look native to the harness: theme tokens only, light/dark support, refined spacing,
charts drawn with SVG, and a tasteful CSS-3D device visual. No external libraries, no CDN, no
`three.js`, no `require` of other harness client packages.

## Environment facts

- Working directory: `~/GitHub/DSHP-DeviceX` (the repository root). The plugin package is `plugin/`.
  The repository root also carries a thin `package.json`: it is the manifest a Git install reads
  (`dsh.bundle` / `dsh.client` plus `exports` mapped into `plugin/`), because DSH/pnpm treat the
  repository root as the package. `plugin/package.json` stays the source of truth for the plugin's
  own files; keep the two in sync (`scripts/verify.mjs` checks it).
- Target machine: macOS (darwin, Apple Silicon). Node 24 available. Host half runs in the DSH Host
  process (Node). `plugin/package.json` is already written; the bundle is installed later by Lead.
- Unpacked DSH sources for reference (read-only): `/tmp/dshx/asar/dsh/node_modules/@deepseek-ai/`.
  Useful examples:
  - `dsh-client-ui-schedule/lib/client.js` — `main` panel + `sidebar.panellist` registration.
  - `dsh-client-ui-plugin-manager/lib/client.js` — `main` panel + sidebar entry.
  - `dsh-client-ui-settings-general/lib/client.js` — settings section, styles, locale registration.
  - `dsh-host-open-in-app/lib/index.js` — secured Host HTTP routes (`connection.requestRejection`).
  - `dsh-tool-todo/lib/index.js` — `defineTool` tool registration.
- The live Web GUI is `http://127.0.0.1:50732`. Do NOT install/toggle plugins, do not write the
  DSH profile, do not start servers. Lead does that.

## File ownership

| Owner | Files |
|---|---|
| Lead | `plugin/package.json`, `plugin/cordis.patch.yml`, `plugin/locale/*.json`, `plugin/icon.svg`, `plugin/index.js`, `plugin/host/transport.js`, `plugin/host/tool.js` |
| host-collector | `plugin/host/collector.js`, `plugin/host/actions.js`, `plugin/host/proc.js` (shared exec helper, optional) |
| client-ui | `plugin/client.js` |
| verifier | `dev/verify-host.mjs` (temp harness), writes no plugin files |

Temp/scratch scripts go under `/tmp/devicex-host/` or `/tmp/devicex-client/`, NOT in the workspace.
`plugin/CONTRACT.md` is frozen: if something is genuinely impossible, report it instead of editing.

## Host — `host/collector.js` (host-collector)

Plain ESM module (runs in Node). No imports of harness packages. May import `node:*` only.
Use `execFile` (never `exec`/shell string interpolation) with timeout + maxBuffer, `os`, `fs`, `path`.

```js
export const PLATFORM = process.platform;            // 'darwin'
export const SECTIONS = ['hardware','system','software','network','security','processes'];
export function warmup(): void;                      // fire-and-forget: start slow collection
export async function collectMetrics(): Promise<Metrics>;               // < 250 ms, no cache needed
export async function collectSection(section, options = {}): Promise<object>; // { fresh?: boolean }
export async function collectInventory(options = {}): Promise<Inventory>;     // { sections?: string[], fresh?: boolean }
export function clearCache(section?: string): void;
```

Every collector must be failure-tolerant: a failed command yields `null`/empty value plus a
non-fatal entry in the section's `errors[]` (never throw from `collectSection` unless the section
name is unknown). `collectMetrics` must never throw (return best-effort data).

### Metrics (exact shape, polled by the UI every 2500 ms)

```js
{
  ts: 1762500000000,                 // Date.now()
  hostname: "MacBook-Pro.local",
  osVersion: "macOS 15.1 (24B83)",
  uptimeSec: 123456,
  cpu: {
    model: "Apple M3 Pro",
    usagePercent: 12.4,              // 0..100, whole-machine
    perCore: [8.1, 14.0, ...],       // logical cores, 0..100
    loadAvg: [1.2, 1.5, 1.4],        // 1/5/15
    logicalCores: 12,
    physicalCores: 12
  },
  memory: {
    totalBytes: 38654705664, usedBytes: 21474836480, appBytes: 12000000000,
    wiredBytes: 3000000000, compressedBytes: 800000000, cachedBytes: 4000000000,
    freeBytes: 5000000000, swapTotalBytes: 0, swapUsedBytes: 0,
    pressure: "normal" | "warning" | "critical"
  },
  disk: { totalBytes: 494384795648, usedBytes: 300000000000, freeBytes: 194384795648,
          readBytesPerSec: 0, writeBytesPerSec: 0 },
  network: {
    rxBytesPerSec: 10240, txBytesPerSec: 2048, totalRxBytes: 0, totalTxBytes: 0,
    wifi: { ssid: "MyWiFi", rssi: -52, channel: 36 } | null,
    primaryIpv4: ["192.168.1.8"], defaultInterface: "en0"
  },
  battery: { present: true, percent: 87, charging: false, plugged: false,
             powerSource: "Battery Power", timeRemainingMin: 250,
             temperatureC: 31.2, cycleCount: 123, healthPercent: 92 } | null,
  thermal: { /* superseded by the 1.2 additions below: full thermal contract */ },
  processes: {
    total: 512,
    top: [ { pid: 1234, name: "WindowServer", cpu: 14.2, memPercent: 2.8, user: "_windowserver" }, ... ]
  }
}
```

### Section shapes (exact field names)

`sections` object inside Inventory may omit a section when not requested. Every section also carries
`errors: string[]` (possibly empty). Include `generatedAt` numbers where cheap.

```js
hardware = {
  cpu: { model, vendor, physicalCores, logicalCores, speedGHz, architecture, features: string[] },
  memory: { totalBytes, type: "LPDDR5", speedMHz: 6400, modules: [{ slot, sizeBytes, type, speedMHz, manufacturer, partNumber }] },
  gpu: [{ name, cores, vramBytes, vendor, metal }],
  displays: [{ name, resolution: "3456x2234", refreshHz, main: true, connection: "built-in" }],
  storage: { physical: [{ name, model, sizeBytes, mediaType, smartStatus }],
             volumes: [{ name, mount, fs, totalBytes, usedBytes, freeBytes, removable, internal }] },
  battery: null | { percent, condition, cycleCount, designCapacityMah, maxCapacityMah, temperatureC, healthPercent },
  usb: [{ name, vendor, productId, serial, speed, bus }],
  bluetooth: { controller: { address, chipset, firmware, state }, devices: [{ name, address, connected, batteryPercent, type }] },
  audio: [{ name, kind: "output"|"input", manufacturer, default: true }],
  cameras: [{ name, modelId, uniqueId }],
  errors: []
}

system = {
  os: { name: "macOS", version: "15.1", build: "24B83", kernel: "Darwin 24.1.0", arch: "arm64", release: "..." },
  device: { hostname, computerName, localHostname, model: "MacBook Pro", modelId, chip, serial, hardwareUuid },
  boot: { bootTime: 1762400000000, uptimeSec: 123456 },
  user: { name, fullName, uid, gid, home, shell, admin: true },
  users: [{ name, uid, gid, fullName, home, shell, admin, isCurrent }],
  launchAgents: [{ label, path, scope: "user"|"system", loaded: true, pid: null|number, lastExitStatus: null|number, program: string }],
  loginItems: [{ name }],
  environment: { PATH, SHELL, HOME, USER, LANG, TERM },   // whitelist ONLY these keys
  locale: { timezone, locale, language },
  errors: []
}

software = {
  applications: [{ name, path, version, bundleId, source: "system"|"user"|"other", arch, lastUsed: null|number, sizeBytes: null|number }],
  totalApplications: 412,
  homebrew: { available: true, prefix: "/opt/homebrew", installed: [{ name, version }], outdated: [] },
  errors: []
}

network = {
  interfaces: [{ name, type: "wifi"|"ethernet"|"loopback"|"bridge"|"other", up, ipv4: [], ipv6: [],
                 mac, mtu, primary: true }],
  wifi: null | { ssid, bssid, rssi, noise, channel, security, txRateMbps },
  defaultRoute: { gateway: "192.168.1.1", interface: "en0" } | null,
  dns: { servers: ["192.168.1.1"], searchDomains: [] },
  proxy: { http: null, https: null, socks: null },
  listeningPorts: [{ proto: "tcp", address: "127.0.0.1", port: 50732, pid: 1234, process: "DeepSeek Harness" }],
  establishedCount: 42,
  errors: []
}

security = {
  fileVault: { enabled: true|false|null, raw: "FileVault is On." },
  sip: { enabled: true|false|null, raw: "System Integrity Protection status: enabled." },
  gatekeeper: { enabled: true|false|null, raw: "assessments enabled" },
  firewall: { enabled: true|false|null, raw: "...", stealthMode: null|boolean },
  tcc: { readable: false, reason: "...", grants: [{ service: "Camera", client: "com.apple.FaceTime" }] },
  users: { current: "qaxc84", admins: ["qaxc84"], total: 5 },
  remoteLogin: null|boolean,
  autoLogin: null|string,
  errors: []
}

processes = {
  total: 512,
  list: [{ pid, ppid, user, cpu, memPercent, rssBytes, state, elapsed, command }],  // top 200 by cpu desc
  byUser: [{ user, count }],
  errors: []
}

Inventory = {
  generatedAt, platform, hostname,
  metrics: Metrics,
  sections: { hardware?, system?, software?, network?, security?, processes? },
  actions: { catalog: Action[], history: ActionLogEntry[] },
  errors: [...]
}
```

All sizes are bytes (numbers). All timestamps are epoch ms numbers. Never put `undefined` in JSON;
use `null`. Keep each section response under ~2 MB.

Caching: `collectSection` caches per section for a sensible TTL (metrics-like 3–5 s, hardware/
software 120–600 s); `options.fresh` bypasses. `warmup()` starts the slow ones in background so the
first page view is fast. Guard against concurrent duplicate work.

### `host/actions.js` (host-collector)

```js
export const GROUPS = ['process','app','system','network','software','power'];
export function actionCatalog(): Action[];                       // stable order, see table
export function actionHistory(): ActionLogEntry[];               // newest first, max 50
export async function runAction(id, params): Promise<ActionResult>;
```

```js
Action = {
  id: "process.signal",
  group: "process",
  danger: "low"|"medium"|"high",
  requiresAdmin: false,                    // informational; the action may still fail
  params: [{
    name: "pid", type: "number"|"string"|"boolean"|"select",
    required: true, options: ["TERM","KILL"], min: 2, max: 4194304,
    placeholder: "..."
  }]
};
ActionResult = { ok: true, message: string, data?: object }
             | { ok: false, message: string, code?: string };
ActionLogEntry = { ts, id, params, ok, message };   // append on every attempt (success or failure)
```

All actions are implemented with `execFile` / `process.kill` / `fs`; **never** a shell string.
Validate every parameter strictly (type, range, enum). `runAction` must never throw for bad input —
return `{ok:false, message}`. Refuse dangerous targets: pid 1, the Host's own pid and ppid, paths
outside `/Applications`, `~/Applications`, `/System/Applications` (and system apps are refused for
uninstall), any `.app` path that does not end in `.app` after resolution.

Action table (ids are frozen; params as listed):

| id | group | params | implementation (darwin) |
|---|---|---|---|
| `process.signal` | process | `pid:number`, `signal:select(TERM,KILL,INT,STOP,CONT)` default TERM | `process.kill(pid, signal)`; guards above |
| `app.quit` | app | `name:string` | `osascript -e 'tell application "NAME" to quit'` (escape via argv script with quoted AppleScript string; validate no control chars) |
| `app.launch` | app | `path:string` | `open -a PATH` (path must exist) |
| `app.reveal` | app | `path:string` | `open -R PATH` |
| `app.uninstall` | app | `path:string`, `mode:select(trash,delete)` default trash | validate `.app`; `trash` → `mv` into `~/.Trash` with unique name; `delete` → `rm -rf` after path guard |
| `system.setHostname` | system | `kind:select(HostName,ComputerName,LocalHostName)`, `value:string` | `scutil --set KIND VALUE` (validated: letters digits dot dash, 1..63 chars) |
| `system.setVolume` | system | `percent:number 0..100` | `osascript -e 'set volume output volume N'` |
| `system.setDarkMode` | system | `enabled:boolean` | `osascript` System Events appearance preferences |
| `system.launchAgent` | system | `path:string`, `enabled:boolean` | user scope: `launchctl bootstrap gui/$UID PATH` / `bootout gui/$UID PATH`; validate plist path under `~/Library/LaunchAgents` or `/Library/Launch*` |
| `system.openSettings` | system | `pane:string` | allowlist panes, `open "x-apple.systempreferences:PANE"` |
| `system.toggleFirewall` | system | `enabled:boolean` | `/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on|off` |
| `system.flushDNS` | system | — | `dscacheutil -flushcache` (+ report if mDNSResponder needed) |
| `system.emptyTrash` | system | — | remove entries inside `~/.Trash` |
| `network.setWifiPower` | network | `enabled:boolean` | resolve Wi-Fi device, `networksetup -setairportpower DEV on|off` |
| `network.setDns` | network | `service:string`, `servers:string[]` (0–4 valid IPs) | `networksetup -setdnsservers SERVICE ...` |
| `power.sleep` | power | — | `pmset sleepnow` |
| `power.lock` | power | — | `osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}'` |
| `software.brewUninstall` | software | `name:string` | resolve brew (`/opt/homebrew/bin/brew` or `/usr/local/bin/brew`), validate formula token `[A-Za-z0-9@+._/-]+` (no spaces), `brew uninstall NAME` |

`requiresAdmin` true for: `system.setHostname`, `system.launchAgent` (system scope),
`system.toggleFirewall`, `network.setDns`. Failures must carry the command's stderr in `message`.

## Host — HTTP API (Lead implements in `index.js`/`transport.js`; client-ui consumes)

All routes are same-origin on the DSH Web server, guarded by `ctx.connection.requestRejection(req)`
(the shipped trust fence — the page's signed cookie authenticates the caller). Client code uses
`fetch` with default same-origin credentials.

| Method + path | Body / query | 200 response |
|---|---|---|
| `GET /devicex/api/metrics` | — | `{ ok: true, metrics: Metrics }` |
| `GET /devicex/api/inventory` | `section` (optional, one of SECTIONS), `fresh` (`1`) | `{ ok: true, section: string|null, data: object }` — with no `section`, `data` is the full `Inventory` |
| `GET /devicex/api/actions` | — | `{ ok: true, platform, actions: Action[], history: ActionLogEntry[] }` |
| `POST /devicex/api/action` | `{ action: string, params: object }` | `{ ok: boolean, message: string, data?: object }` (business failure still HTTP 200) |

Errors: `400 { ok:false, error:{code,message} }` for malformed requests, `403/401` when the trust
fence rejects, `405` for wrong method, `500` for unexpected. `cache-control: no-store`.

## Agent tools (Lead implements `host/tool.js`)

- `device_info` — read: `{ section?: "overview"|"hardware"|"system"|"software"|"network"|"security"|"processes", fresh?: boolean }`,
  returns a compact summary + JSON payload. `overview` = metrics + headline facts.
- `device_control` — write: `{ action: string (enum of action ids), params: object }`, returns
  `{ ok, message }`. Same implementation as the HTTP route (one operation, two callers).

## Client — `client.js` (client-ui)

Format (verified): a single browser module loaded by the module loader:

```js
window.__ModuleLoader__.load({
  id: '@cfour-hi/dsh-devicex',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // ... dictionaries, components, styles ...
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'devicex: dictionaries');
        const t = ctx.locale.bind(NS);
        // inject <style> into document.head via ctx.effect cleanup
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'devicex', locale: NS
        }, DeviceXPage));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'devicex', order: 20, locale: NS, label: () => t('panel')
        }, DeviceXIcon));
      }
    };
  }
});
```

Component props available in the `main` slot: standard slot props are spread in automatically
(`usePanelInfo`, `useRemoteAccess`, …), plus `t` (from `locale: NS`). The component receives no owner
props. It must render into `height:100%` inside the center column (the column already has padding for
macOS chrome). Unmount happens when the user switches panels — stop timers in `useEffect` cleanup.

Requirements:

1. **Layout**: a full-height page with a compact top header (device name, OS chip, live status,
   refresh + "3D" toggle), a vertical tab rail (`总览/硬件/系统/软件/网络/安全/进程/操作`; EN equivalents), and a
   scrollable content pane. Responsive down to ~720 px wide (tab rail becomes horizontal strip below
   ~880 px). Respect `prefers-reduced-motion`.
2. **Overview**: CSS-3D "device core" hero (rotating layered chip/grid, orbit rings, subtle depth —
   pure CSS transforms, artwork colors allowed here), KPI cards (CPU / memory / disk / battery /
   network) with SVG donut rings + live sparklines (client-side ring buffers, 60 samples), top
   processes list, derived alert chips (e.g. memory > 85 %). "3D" toggle pauses/restarts animation.
3. **Hardware**: cards for CPU (model + per-core bars), memory modules, GPU/displays, storage volumes
   (usage bars), battery health, USB, Bluetooth, audio, cameras. Null-safe rendering.
4. **System**: OS/device facts, boot/uptime, users table, launch agents list with enable/disable
   switch (calls `system.launchAgent`, confirm first), login items, safe environment table.
5. **Software**: application list (search / sort by name / source filter), per-row reveal + uninstall
   (confirm; `app.uninstall`), Homebrew table with uninstall buttons, empty/loading states.
6. **Network**: interface cards, Wi-Fi status card, DNS list, default route, proxy, listening ports
   + established count, actions (Wi-Fi power, set DNS modal, open network settings).
7. **Security**: status cards (FileVault/SIP/Gatekeeper/Firewall with on/off/unknown pills), TCC
   permission panel (readable or explanatory fallback), admin users, action buttons (open settings
   panes, toggle firewall with confirm, flush DNS, empty trash).
8. **Processes**: searchable table (pid, name, user, CPU, mem, state), sort desc/asc, kill button per
   row with signal select + confirmation modal; refresh; totals.
9. **Actions**: grouped catalog from `GET /devicex/api/actions`, each action rendered as a card with
   parameter inputs derived from `params` (number/string/boolean/select), a confirm dialog, and a
   result log (history from the API + live results).
10. **Live data**: metrics poll every 2500 ms while mounted; sections fetched lazily per tab and
    cached in memory (`fresh=1` on manual refresh). Show "无法连接到设备服务" panel with retry when the
    API fails; never blank the whole page on one failed section.
11. **Interactions**: custom modal (mask, Escape, focus first control, `role="dialog"`, returns focus);
    toast stack for action outcomes; buttons disabled while pending; all strings via `t()` in both
    `zh` and `en`; `aria-selected`/`role="tab"` on the tab rail; keyboard arrow navigation optional;
    tables have `<thead>` + `scope="col"`.
12. **Styling**: only these theme tokens for colors:
    `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-bg-overlay`,
    `--dsw-alias-border-l1`, `--dsw-alias-border-l2`, `--dsw-alias-brand-primary`,
    `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, `--dsw-alias-state-error-primary`,
    `--dsw-alias-state-idle-primary`, `--dsw-alias-state-success-primary`,
    `--dsw-alias-state-warn-primary`, `--dsw-specific-sidebar-fill`. Derived shades via
    `color-mix(in srgb, ...)` are fine. Literal colors allowed only inside the 3D artwork/SVG charts.
    Radius 6–14 px literal, no external fonts (use the inherited UI font). Do not read another
    plugin's DOM or stylesheets; do not append to `document.body` (a `<style>` tag in `document.head`
    registered as a disposable effect is the one exception, following shipped precedent).
13. **Robustness**: defensive against missing fields; wrap each tab body in an error boundary-ish
    fallback (a small class-free guard: try/catch in render helpers is not enough — validate shapes
    with optional chaining and defaults). No timers at module scope. No network calls outside
    `/devicex/api/*`. Do not throw during render: an uncaught error blanks the slot.

The client dictionary `NS = 'devicex'` needs, at minimum: `panel`, all tab labels, section titles,
column headers, action group labels, confirmation copy, toast copy, empty/loading/error text
(zh + en). Keep action labels/descriptions in a client-side map keyed by the frozen action ids.

## Verification each owner must do before reporting

- `node --check plugin/<file>` passes for every file you wrote (client.js too).
- host-collector: run a temp harness under `/tmp/devicex-host/` that imports
  `collectMetrics`, every `collectSection`, and a few safe actions (`process.signal` on a spawned
  `sleep` child, `system.setVolume` to the current value, `system.openSettings` with a harmless pane
  behind a guard you do not actually open — prefer dry validation). Print shapes; verify JSON-safe
  (no undefined/circular). Report command latencies.
- client-ui: verify `node --check`, and validate every dictionary key used exists in both locales
  (a temp script that scans `t('...')` literals against the dictionaries). Report rendered layout
  design decisions and any contract mismatch.
- Do not install the plugin. Report: files written, how tested, known limitations, and anything the
  Lead must wire.

## 1.2 additions — sensors, drivers, cleanup, benchmark (frozen)

Added after the initial six-section build; every earlier shape above is unchanged.

### `metrics.thermal` (polled with metrics, cached 5 s in the platform collector)

```js
thermal: {
  available: boolean,                 // true iff any Celsius field below is a finite number
  cpuCelsius: number|null, gpuCelsius: number|null,
  batteryCelsius: number|null, nvmeCelsius: number|null,
  pressure: 'nominal'|'fair'|'serious'|'critical'|null,
  fans: [{ name: string|null, rpm: number|null }],
  sources: string[],                  // e.g. ['nsprocessinfo','ioreg-applesmartbattery']
  note: 'cpu-needs-admin'|'wmi-unsupported'|'unavailable'|null
}
```

macOS: battery °C from `AppleSmartBattery`, thermal pressure from
`NSProcessInfo.thermalState` (via a bounded `osascript -l JavaScript`), CPU/GPU only when a
`smctemp` / `osx-cpu-temp` / `istats` helper exists or the Host runs as root (`powermetrics`).
Windows: ACPI thermal zones from `root/wmi MSAcpi_ThermalZoneTemperature`, optional `nvidia-smi`
GPU/fan data; `wmi-unsupported` is a normal outcome on boards/VMs without the class.

### `hardware.drivers`, `driverSummary`, `driverProblems` (read-only)

```js
drivers: [{ name, class, manufacturer, version, date, signer, inf, deviceId,
            kind: 'kext'|'driverkit'|'pnp', problem }]   // capped at 250
driverSummary: { total, thirdParty, problems, truncated? }
driverProblems: [{ name, code, class }]                 // win32 only, capped at 50
```

macOS: `system_profiler SPExtensionsDataType` (third-party/loaded first, then version desc).
Windows: `Win32_PnPSignedDriver` + `Win32_PnPEntity.ConfigManagerErrorCode`. No update/rollback is
attempted anywhere — the inventory is read-only by design.

### Cleanup (`host/cleanup.js`, `cleanup-darwin.js`, `cleanup-win32.js`)

```js
scanCleanup({ fresh } = {}) -> {
  platform, generatedAt, durationMs,
  items: [{ id, label, detail, category: 'cache'|'logs'|'trash'|'temp'|'developer'|'updates',
            path, bytes, files, requiresAdmin, exists, error }],
  totalBytes, totalFiles, errors: []
}
deleteCleanup(ids) -> { ok, message, data: { deletedBytes, items: [{ id, ok, bytes, message }] } }
```

Fixed per-platform allowlist only (the client can never supply a path). Recursive `lstat` size walk
bounded to 150k entries and 5 s per root, symlinks never followed, scan cached 60 s. Deletion resolves
each id back to its frozen absolute path, removes contents (recreating cache roots), reports per-item
OS errors, and has a strict `cleanup.delete` action (group `system`, danger `high`, one `ids`
parameter: 1–20 unique allowlist ids; array or comma-separated string).

### Benchmark (`host/benchmark.js`, platform-agnostic Node engine)

```js
runBenchmark({ tests = [], repeat = false } = {}) -> { ok: true, benchmark: {
  platform, startedAt, durationMs,
  environment: { hostname, cpuModel, logicalCores, physicalCores, memoryBytes, osVersion },
  results: [{ id: 'cpu'|'memory'|'disk', durationMs, score, unit, details, error? }],
  previous: null | { at, results: [{ id, score, unit }] }
} }
benchmarkHistory() -> last <=5 runs, newest first
```

Fixed work per run: CPU 70,000,000 integer-mix iterations (one single-thread leg, one
`min(4, cores)`-thread leg via `worker_threads`, bounded 20 s, single-thread fallback), memory 48
copy passes over two 32 MiB `Float64Array`s, disk one 64 MiB write+fsync+read under `os.tmpdir()`
(always unlinked). Scores are only comparable on the same machine over time.

### Routes / tools / actions after 1.2

- Browser routes (6): `GET /devicex/api/metrics`, `GET /devicex/api/inventory`,
  `GET /devicex/api/actions`, `POST /devicex/api/action`, `GET /devicex/api/cleanup`,
  `POST /devicex/api/benchmark` — all behind the same Connection trust fence.
- Agent tools (3): `device_info` (sections gain `cleanup`), `device_control` (catalog now includes
  `cleanup.delete`), `device_benchmark` (`tests?`, `repeat?`).
- Action catalogue: 19 ids (the 18 frozen ids plus `cleanup.delete`; Windows swaps
  `software.brewUninstall` for `software.wingetUninstall` as before).

## 1.3 build pipeline (frozen)

The browser half is no longer hand-edited as one file:

- Editable source: `src/client/` — `entry.js` (module-loader registration), `runtime.js` (the
  loader's `react` seed), `core.js` (page + components), `dicts.js`, `styles.js`, `helpers.js`,
  `constants.js`, `normalizers.js`, `api.js`.
- Artifact: `plugin/client.js`, generated by `scripts/build-client.mjs` with esbuild
  (`bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true`).
  The build refuses to write if the bundle requests anything but the single `react` seed.
- `node scripts/build-client.mjs --check` is part of CI and fails on a stale artifact.
- `tsconfig.json` runs `checkJs` over `plugin/index.js` + `plugin/host/**/*.js` with
  `strictNullChecks` (other strict flags staged); JSDoc is the contract documentation.
- `scripts/render-check.mjs` / `render-windows-check.mjs` mount the real client with React 18 +
  jsdom (devDependencies) and are part of CI.
- UI code stays in the `h()` style for now; the esbuild entry supports a future incremental
  migration to `.jsx` without changing the loader contract.

## 1.3.1 build engines (frozen: B + C + D)

- **B — esbuild (primary)**: `scripts/build-client.mjs` → minified IIFE `plugin/client.js`
  (single file, only the loader `react` seed, no sibling imports). `--check` fails on a
  stale artifact; `--out <file>` writes elsewhere for verification.
- **C — no-bundler fallback**: `scripts/build-client-concat.mjs` concatenates
  `src/client/*.js` in dependency order (`runtime → constants → helpers → dicts → styles →
  normalizers → api → core`), strips `import`/`export`, rejects duplicate top-level
  declarations, and appends the same loader registration. Pure Node, zero dependencies.
  The generated file is a dev/verification artifact, not the committed one.
- **D — zero-build artifact**: `plugin/client.js` stays committed and self-contained; install
  (GitHub/tgz/link) and runtime load never invoke a build and never need devDependencies.
- **Conformance**: `scripts/verify-build.mjs` proves determinism, loader contract, identical
  registration surface, and renders both B and C through the 215-assertion 10-tab suite and
  the 32-assertion Windows scenario.
- **Supplements**: JSDoc + `tsc --noEmit` (host, `checkJs`) and GitHub Actions CI remain
  mandatory; CI order: `npm ci → build --check → typecheck → verify:build → verify`.

## 1.3.2 type contract layer (frozen, P0)

- `types/contracts.ts` is types-only: no runtime import, no bundle content, not in `files`.
  It is the single written source for `Metrics`, the six section payloads, `Inventory`, the action
  catalogue types, cleanup/benchmark payloads, `ExecResult`, and the minimal DSH plugin surface
  (`PluginContext`, `PluginOperations`, `WebRoute`, `ToolDefinition`).
- Host JS consumes it from JSDoc (`@type {import('../types/contracts.js').Metrics}`); NodeNext
  resolution maps `.js` to the `.ts` source. Browser source uses comment-level `@typedef` imports
  only, so minified bundle output is unchanged.
- `PlatformCollector`/`PlatformActions` are applied at the platform dispatchers; both
  `collector-darwin.js`/`collector-win32.js` and `actions-darwin.js`/`actions-win32.js` are checked
  structurally by `tsc --noEmit`.
- Deliberately deferred: per-action parameter discriminated unions (runners still validate at
  runtime), client `checkJs`, and `.tsx` components.

## 1.3.3 parser unit tests (P1, frozen)

- `test/*.test.mjs` runs with `node --test`; tests import only the modules' `__test` seams
  (or pure mappers) and never spawn a command or mutate a cache. Suites:
  `darwin-parsers`, `win32-mappers`, `action-contracts`, `benchmark-helpers`.
- `collector-darwin.js` now exports `__test` with the pure parsers (same idea as the Windows
  `__test`), so macOS command-output parsing is covered without sudo/real hardware.
- Parser fixes carried by this work: indented `pmset` battery lines are recognised; battery
  `charging` state is matched exactly (previously `discharging` matched the `charging` substring).
- CI order: `build --check → typecheck → npm test → verify:build → verify`.

## 1.3.4 per-action parameter contracts (P1, frozen)

- `types/contracts.ts` exports `DarwinActionParamsById` / `Win32ActionParamsById`: the
  normalized value each action runner receives, with discriminated unions where the code
  branches (`app.uninstall.kind`, `system.launchAgent.hive`) and platform-specific signal
  unions.
- Windows: every `SPECS[].validate(params)` is annotated with
  `@returns {Win32ActionParamsById['<action id>']}`; the validators are the trust boundary
  (raw JSON in, typed value out) and `tsc --noEmit` enforces the contract.
- macOS: runners keep validating raw input inline and are deliberately not typed as the
  normalized contract (an untrusted boundary must not be disguised as trusted data); the
  contract interfaces are the documentation/future-typing target.
- CI still runs `build --check → typecheck → npm test → verify:build → verify`.

## 1.3.5 client pure-logic checkJs (P2-a, frozen)

- `tsconfig.client.json` type-checks `src/client/{constants,helpers,runtime,normalizers,api}.js`
  with `allowJs`/`checkJs`, `strictNullChecks`, `lib: [ES2022, DOM]`, no node types.
  `npm run typecheck` = host project + client project.
- Exclusions are intentional: `core.js` (UI, `h()` style) is protected by the jsdom render
  suites (215 assertions), `dicts.js`/`styles.js` are data/stylesheet modules.
- `// @ts-check` and JSDoc casts are comments, so the generated `plugin/client.js` bundle stays
  byte-identical (`build --check` enforced in CI); `.tsx`/jsx-runtime migration remains P2-b.

## 1.3.6 JSX pilot (P2-b, frozen)

- JSX is compiled with the **classic transform** (`jsxFactory: 'h'`,
  `jsxFragmentFactory: 'Fragment'`) because the module loader injects React: importing
  `react/jsx-runtime` would add a second runtime request and break the zero-dependency
  bundle contract. `scripts/build-client.mjs` validates that the bundle still asks the
  loader for exactly one `react` seed.
- `src/client/jsx.js` is the runtime: `h(type, props, ...children)` resolves the injected
  React lazily; the `Fragment` marker is mapped to `React.Fragment`.
- Pilot components: `src/client/components/Pill.tsx` and `SignalBars.tsx`; they are
  imported from `core.js` (extensionless specifier, resolved by esbuild and Bundler
  moduleResolution) and stay behaviour-identical.
- `tsconfig.client.json` includes the `.tsx` files with `jsx: react` / `jsxFactory: h`;
  `@types/react` and `@types/react-dom` are devDependencies only (runtime React is still
  supplied by the loader).
- Migration continues incrementally: new UI components should be `.tsx`; existing `h()`
  calls can be converted module by module without changing the build chain.
- The C (concat) fallback transpiles `.ts`/`.tsx` with the TypeScript compiler
  (`jsx: React`, `jsxFactory: h`) before concatenating — still no bundler, and TypeScript
  is already a devDependency for typecheck. `verify-build` counts loader seed *calls*
  after stripping comments, so the non-minified concat artifact passes the same check.

## 1.3.7 TSX presentation primitives (P2-b, frozen)

- `src/client/components/` now hosts nine `.tsx` components imported by `core.js`:
  `Pill`, `SignalBars`, `Icon`, `Card`, `Skeleton`, `EmptyState`, `Fact`, `FactGrid`,
  `DataTable`. Markup and class names are unchanged; the render suites are the guard.
- `Icon` reads the frozen `ICONS` table from `constants.js`; dynamic SVG shapes are emitted
  with `h` (`jsxFactory`), so no React runtime import is added.
- The concat (C) fallback transpiles each `.tsx` with the TypeScript compiler before
  concatenation; module order in `scripts/build-client-concat.mjs` follows the component
  dependency chain.
- Remaining `h()` components convert incrementally; new UI components should be `.tsx`.
