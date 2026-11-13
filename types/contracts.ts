/**
 * Device X — type-only contract layer (P0 of the "contracts, not full TS" plan).
 *
 * This file is **types only**: it is never imported at runtime, never bundled,
 * and `tsc --noEmit` erases it. It documents the frozen boundary between
 *   Host collectors  ↔  Host actions / HTTP API  ↔  browser client
 * and between the two platform adapters (`darwin` / `win32`).
 *
 * Host JS references these types from JSDoc:
 *   `@type {import('../types/contracts.js').Metrics}`
 * `types/contracts.js` resolves to this file with NodeNext module resolution.
 *
 * External command output is always *untrusted*: these types describe the
 * validated/collected shape, they do not replace the runtime guards.
 */

/** Host platforms the bundle is installable on. */
export type Platform = 'darwin' | 'win32';

/** The six inventory sections, in UI order. */
export type SectionName = 'hardware' | 'system' | 'software' | 'network' | 'security' | 'processes';

/** Memory pressure reported by the OS. */
export type MemoryPressure = 'normal' | 'warning' | 'critical';

/** macOS/Windows thermal pressure state. */
export type ThermalPressure = 'nominal' | 'fair' | 'serious' | 'critical';

/** Why a temperature source is missing (never fabricated). */
export type ThermalNote = 'cpu-needs-admin' | 'wmi-unsupported' | 'unavailable';

/** Cleanup item categories. */
export type CleanupCategory = 'cache' | 'logs' | 'trash' | 'temp' | 'developer' | 'updates';

/** Action danger level. */
export type DangerLevel = 'low' | 'medium' | 'high';

/** Action groups, in UI order. */
export type ActionGroup = 'process' | 'app' | 'system' | 'network' | 'software' | 'power';

/* ------------------------------------------------------------------------- */
/* Fast metrics (polled every 2500 ms)                                        */
/* ------------------------------------------------------------------------- */

export interface CpuMetrics {
  model: string | null;
  usagePercent: number | null;
  perCore: number[];
  loadAvg: number[];
  logicalCores: number | null;
  physicalCores: number | null;
}

export interface MemoryMetrics {
  totalBytes: number | null;
  usedBytes: number | null;
  appBytes: number | null;
  wiredBytes: number | null;
  compressedBytes: number | null;
  cachedBytes: number | null;
  freeBytes: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
  pressure: MemoryPressure;
}

export interface DiskMetrics {
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
}

export interface WifiMetrics {
  ssid: string | null;
  rssi: number | null;
  channel: number | null;
}

export interface NetworkMetrics {
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  totalRxBytes: number | null;
  totalTxBytes: number | null;
  wifi: WifiMetrics | null;
  primaryIpv4: string[];
  defaultInterface: string | null;
}

export interface BatteryMetrics {
  present: boolean;
  percent: number | null;
  charging: boolean;
  plugged: boolean;
  powerSource: string | null;
  timeRemainingMin: number | null;
  temperatureC: number | null;
  cycleCount: number | null;
  healthPercent: number | null;
}

export interface FanReading {
  name: string | null;
  rpm: number | null;
}

/** `metrics.thermal` — see docs/benchmark-contract.md and windows-contract.md. */
export interface ThermalMetrics {
  available: boolean;
  cpuCelsius: number | null;
  gpuCelsius: number | null;
  batteryCelsius: number | null;
  nvmeCelsius: number | null;
  pressure: ThermalPressure | null;
  fans: FanReading[];
  sources: string[];
  note: ThermalNote | null;
}

export interface TopProcess {
  pid: number;
  name: string;
  cpu: number | null;
  memPercent: number | null;
  user: string | null;
}

export interface ProcessMetrics {
  total: number | null;
  top: TopProcess[];
}

export interface Metrics {
  ts: number;
  hostname: string;
  osVersion: string;
  uptimeSec: number | null;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  battery: BatteryMetrics | null;
  thermal: ThermalMetrics;
  processes: ProcessMetrics;
}

/* ------------------------------------------------------------------------- */
/* Inventory sections                                                         */
/* ------------------------------------------------------------------------- */

/** Read-only driver inventory entry (1.2 addition). */
export interface DriverInfo {
  name: string;
  class: string | null;
  manufacturer: string | null;
  version: string | null;
  date: string | null;
  signer: string | null;
  inf: string | null;
  deviceId: string | null;
  kind: 'kext' | 'driverkit' | 'pnp';
  problem: string | null;
}

export interface DriverSummary {
  total: number;
  thirdParty: number;
  problems: number;
  truncated?: boolean;
}

export interface HardwareSection {
  cpu: {
    model: string | null;
    vendor: string | null;
    physicalCores: number | null;
    logicalCores: number | null;
    speedGHz: number | null;
    architecture: string | null;
    features: string[];
  };
  memory: {
    totalBytes: number | null;
    type: string | null;
    speedMHz: number | null;
    modules: Array<{
      slot: string | null;
      sizeBytes: number | null;
      type: string | null;
      speedMHz: number | null;
      manufacturer: string | null;
      partNumber: string | null;
    }>;
  };
  gpu: Array<{
    name: string | null;
    cores: number | null;
    vramBytes: number | null;
    vendor: string | null;
    metal: boolean | null;
  }>;
  displays: Array<{
    name: string | null;
    resolution: string | null;
    refreshHz: number | null;
    main: boolean | null;
    connection: string | null;
  }>;
  storage: {
    physical: Array<{
      name: string | null;
      model: string | null;
      sizeBytes: number | null;
      mediaType: string | null;
      smartStatus: string | null;
    }>;
    volumes: Array<{
      name: string | null;
      mount: string | null;
      fs: string | null;
      totalBytes: number | null;
      usedBytes: number | null;
      freeBytes: number | null;
      removable: boolean | null;
      internal: boolean | null;
    }>;
  };
  battery: {
    percent: number | null;
    condition: string | null;
    cycleCount: number | null;
    designCapacityMah: number | null;
    maxCapacityMah: number | null;
    temperatureC: number | null;
    healthPercent: number | null;
  } | null;
  drivers: DriverInfo[];
  driverSummary: DriverSummary;
  driverProblems: Array<{ name: string; code: string; class: string | null }>;
  usb: Array<{
    name: string | null;
    vendor: string | null;
    productId: string | null;
    serial: string | null;
    speed: number | null;
    bus: number | null;
  }>;
  bluetooth: {
    controller: {
      address: string | null;
      chipset: string | null;
      firmware: string | null;
      state: string | null;
    };
    devices: Array<{
      name: string | null;
      address: string | null;
      connected: boolean | null;
      batteryPercent: number | null;
      type: string | null;
    }>;
  };
  audio: Array<{ name: string | null; kind: 'output' | 'input'; manufacturer: string | null; default: boolean | null }>;
  cameras: Array<{ name: string | null; modelId: string | null; uniqueId: string | null }>;
  errors: string[];
}

export interface SystemSection {
  os: {
    name: string | null;
    version: string | null;
    build: string | null;
    kernel: string | null;
    arch: string | null;
    release: string | null;
  };
  device: {
    hostname: string | null;
    computerName: string | null;
    localHostname: string | null;
    model: string | null;
    modelId: string | null;
    chip: string | null;
    serial: string | null;
    hardwareUuid: string | null;
  };
  boot: { bootTime: number | null; uptimeSec: number | null };
  user: {
    name: string | null;
    fullName: string | null;
    uid: number | null;
    gid: number | null;
    home: string | null;
    shell: string | null;
    admin: boolean | null;
  };
  users: Array<{
    name: string | null;
    uid: number | null;
    gid: number | null;
    fullName: string | null;
    home: string | null;
    shell: string | null;
    admin: boolean | null;
    isCurrent: boolean | null;
  }>;
  launchAgents: Array<{
    label: string | null;
    path: string;
    scope: 'user' | 'system';
    loaded: boolean;
    pid: number | null;
    lastExitStatus: number | null;
    program: string;
  }>;
  loginItems: Array<{ name: string | null }>;
  environment: { PATH?: string; SHELL?: string; HOME?: string; USER?: string; LANG?: string; TERM?: string };
  locale: { timezone: string | null; locale: string | null; language: string | null };
  errors: string[];
}

export interface SoftwareSection {
  applications: Array<{
    name: string;
    path: string;
    version: string | null;
    bundleId: string | null;
    source: 'system' | 'user' | 'other' | string;
    arch: string | null;
    lastUsed: number | null;
    sizeBytes: number | null;
  }>;
  totalApplications: number;
  homebrew: {
    available: boolean;
    prefix: string | null;
    installed: Array<{ name: string; version: string | null }>;
    outdated: Array<{ name: string; version: string | null }>;
  };
  winget?: {
    available: boolean;
    version: string | null;
    upgraded: Array<{ name: string; id: string; version: string | null }>;
  };
  errors: string[];
}

export interface NetworkSection {
  interfaces: Array<{
    name: string;
    type: 'wifi' | 'ethernet' | 'loopback' | 'bridge' | 'other';
    up: boolean;
    ipv4: string[];
    ipv6: string[];
    mac: string | null;
    mtu: number | null;
    primary: boolean;
  }>;
  wifi: {
    ssid: string | null;
    bssid: string | null;
    rssi: number | null;
    noise: number | null;
    channel: number | null;
    security: string | null;
    txRateMbps: number | null;
  } | null;
  defaultRoute: { gateway: string | null; interface: string | null } | null;
  dns: { servers: string[]; searchDomains: string[] };
  proxy: { http: string | null; https: string | null; socks: string | null };
  listeningPorts: Array<{
    proto: string;
    address: string;
    port: number;
    pid: number | null;
    process: string;
  }>;
  establishedCount: number;
  errors: string[];
}

export interface SecuritySection {
  fileVault: { enabled: boolean | null; raw: string | null };
  sip: { enabled: boolean | null; raw: string | null };
  gatekeeper: { enabled: boolean | null; raw: string | null };
  firewall: { enabled: boolean | null; raw: string | null; stealthMode: boolean | null };
  tcc: { readable: boolean; reason: string | null; grants: Array<{ service: string; client: string }> };
  users: { current: string | null; admins: string[]; total: number };
  remoteLogin: boolean | null;
  autoLogin: string | null;
  /** Windows-only additions (1.2); absent on macOS. */
  bitLocker?: { enabled: boolean | null; raw: string | null };
  secureBoot?: { enabled: boolean | null; raw: string | null };
  defender?: { enabled: boolean | null; raw: string | null };
  errors: string[];
}

export interface ProcessesSection {
  total: number;
  list: Array<{
    pid: number;
    ppid: number | null;
    user: string | null;
    cpu: number | null;
    memPercent: number | null;
    rssBytes: number | null;
    state: string | null;
    /** Seconds the process has been running (both hosts normalise `ps`/CIM to seconds). */
    elapsed: number | null;
    command: string;
  }>;
  byUser: Array<{ user: string; count: number }>;
  errors: string[];
}

/** All six section payloads, keyed by section id. */
export interface SectionPayloads {
  hardware: HardwareSection;
  system: SystemSection;
  software: SoftwareSection;
  network: NetworkSection;
  security: SecuritySection;
  processes: ProcessesSection;
}

/** Full inventory returned by `GET /devicex/api/inventory` without a section. */
export interface Inventory {
  generatedAt: number;
  platform: Platform;
  hostname: string | null;
  metrics: Metrics;
  sections: Partial<SectionPayloads>;
  actions: { catalog: Action[]; history: ActionLogEntry[] };
  errors: string[];
}

/* ------------------------------------------------------------------------- */
/* Action catalogue                                                           */
/* ------------------------------------------------------------------------- */

export interface ActionParam {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** The client may send an array of values (e.g. `network.setDns.servers`, `cleanup.delete.ids`). */
  multiple?: boolean;
}

/** Ids of the frozen action catalogue (19 on both platforms; the software id differs by platform). */
export type ActionId =
  | 'process.signal'
  | 'app.quit'
  | 'app.launch'
  | 'app.reveal'
  | 'app.uninstall'
  | 'system.setHostname'
  | 'system.setVolume'
  | 'system.setDarkMode'
  | 'system.launchAgent'
  | 'system.openSettings'
  | 'system.toggleFirewall'
  | 'system.flushDNS'
  | 'system.emptyTrash'
  | 'cleanup.delete'
  | 'network.setWifiPower'
  | 'network.setDns'
  | 'power.sleep'
  | 'power.lock'
  | 'software.brewUninstall'
  | 'software.wingetUninstall';

export interface Action {
  id: ActionId | string;
  group: ActionGroup | string;
  danger: DangerLevel;
  requiresAdmin: boolean;
  params: ActionParam[];
}

export type ActionResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; message: string; code?: string };

export interface ActionLogEntry {
  ts: number;
  id: string;
  params: Record<string, unknown>;
  ok: boolean;
  message: string;
}

/* ------------------------------------------------------------------------- */
/* Cleanup (1.2 addition)                                                     */
/* ------------------------------------------------------------------------- */

export interface CleanupItem {
  id: string;
  label: string;
  detail: string;
  category: CleanupCategory;
  path: string;
  bytes: number;
  files: number;
  requiresAdmin: boolean;
  exists: boolean;
  error: string | null;
}

export interface CleanupPayload {
  platform: Platform;
  generatedAt: number;
  durationMs: number;
  items: CleanupItem[];
  totalBytes: number;
  totalFiles: number;
  errors: string[];
}

export interface CleanupDeleteResult {
  ok: boolean;
  message: string;
  data: { deletedBytes: number; items: Array<{ id: string; ok: boolean; bytes: number; message: string }> };
}

/* ------------------------------------------------------------------------- */
/* Uninstall footprint (1.6 addition)                                         */
/* ------------------------------------------------------------------------- */

/**
 * Confidence tier of one discovered leftover location.
 *
 * `high`     — bundle-id / MSIX / brew-zap / registry evidence; selected by default.
 * `medium`   — name-similarity only, and the directory matched exactly one app.
 * `conflict` — name-similarity, but the directory matched two or more apps.
 * `shared`   — vendor-level directory that other products also live in; never deletable.
 */
export type FootprintConfidence = 'high' | 'medium' | 'conflict' | 'shared';

/** Which discovery path produced the candidate. */
export type FootprintSource =
  | 'bundle-id'
  | 'name-match'
  | 'brew-zap'
  | 'entitlements'
  | 'registry'
  | 'msix'
  | 'system-item';

/** One candidate leftover location. Paths are only valid within their own scan. */
export interface FootprintItem {
  /** Scan-local identifier; the client never sees or sends a path for deletion. */
  id: string;
  kind: 'app' | 'data' | 'container' | 'shared' | 'system';
  /** Absolute path, server-side only. Never accepted back from a caller. */
  path: string;
  /** `~`-abbreviated form for display. */
  displayPath: string;
  bytes: number;
  files: number;
  confidence: FootprintConfidence;
  source: FootprintSource;
  /** Human-readable justification shown verbatim in the UI. */
  reason: string;
  /** `conflict` tier only: the other installed apps this directory also matched. */
  alsoMatchedBy?: string[];
  requiresAdmin: boolean;
  exists: boolean;
  warning?: string;
}

/** The read-only scan report. `scanId` is the only handle a caller may echo back. */
export interface FootprintReport {
  scanId: string;
  appPath: string;
  bundleId: string | null;
  sandboxed: boolean;
  /** Roots actually swept after the sandbox decision. */
  targetedRoots: string[];
  generatedAt: number;
  durationMs: number;
  items: FootprintItem[];
  totalBytes: number;
  /** Bytes of the `high` tier only: what a default-confirmed dialog would remove. */
  selectedBytes: number;
  errors: string[];
}

/** Optional footprint cleanup attached to `app.uninstall`; all three travel together. */
export interface FootprintCleanupRequest {
  scanId: string;
  itemIds: string[];
  cleanup: 'trash' | 'none';
}

/* ------------------------------------------------------------------------- */
/* Benchmark (1.2 addition)                                                   */
/* ------------------------------------------------------------------------- */

export interface BenchmarkEnvironment {
  hostname: string;
  cpuModel: string | null;
  logicalCores: number;
  physicalCores: number | null;
  memoryBytes: number;
  osVersion: string;
}

export interface BenchmarkResult {
  id: 'cpu' | 'memory' | 'disk';
  durationMs: number;
  score: number | null;
  unit: 'ops/s' | 'GB/s' | 'MB/s';
  details: Record<string, unknown>;
  error?: string;
}

export interface BenchmarkRun {
  platform: Platform;
  startedAt: number;
  durationMs: number;
  environment: BenchmarkEnvironment;
  results: BenchmarkResult[];
  previous: { at: number; results: Array<{ id: string; score: number | null; unit: string }> } | null;
}

/* ------------------------------------------------------------------------- */
/* Command execution                                                          */
/* ------------------------------------------------------------------------- */

/** Result of one bounded child-process run (`host/proc.js`). Never throws. */
export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  error: string | null;
}

/* ------------------------------------------------------------------------- */
/* Platform adapters (compile-checked at the dispatchers)                     */
/* ------------------------------------------------------------------------- */

/**
 * The `collector-*.js` surface each platform must provide. Payloads are typed
 * loosely here on purpose: the frozen JSON shapes live in this file, while the
 * per-platform builders are still incremental (`checkJs`, not `.ts`).
 */
export interface PlatformCollector {
  warmup(): void;
  collectMetrics(): Promise<unknown>;
  collectSection(section: string, options?: { fresh?: boolean }): Promise<unknown>;
  collectInventory(options?: { sections?: string[]; fresh?: boolean }): Promise<unknown>;
  clearCache(section?: string): void;
}

/** The `actions-*.js` surface each platform must provide. */
export interface PlatformActions {
  GROUPS: readonly string[];
  actionCatalog(): any[];
  actionHistory(): any[];
  runAction(id: string, params: Record<string, unknown>): Promise<any>;
}

/* ------------------------------------------------------------------------- */
/* Plugin host surface (minimal DSH contract, deliberately not DSH .d.ts)      */
/* ------------------------------------------------------------------------- */

/** A Cordis disposable: call it to undo an effect. */
export type Disposable = () => void;

/** Request object passed to HTTP route handlers (Node IncomingMessage subset). */
export type RouteRequest = any;
/** Response object passed to HTTP route handlers (Node ServerResponse subset). */
export type RouteResponse = any;

export interface WebRoute {
  kind: 'exact';
  path: string;
  handler: (req: RouteRequest, res: RouteResponse) => void | Promise<void>;
}

export interface WebServerService {
  register(route: WebRoute): Disposable;
}

/** The shipped connection trust fence (`ctx.connection.requestRejection`). */
export interface ConnectionService {
  requestRejection(req: RouteRequest): number | undefined;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output?: Record<string, unknown>;
  execute(args: any, context?: any): any;
  [key: string]: unknown;
}

export interface ToolsService {
  register(definition: ToolDefinition): Disposable;
}

/** Operation surface shared by the HTTP routes and the agent tools. */
export interface PluginOperations {
  SECTIONS: readonly string[];
  PLATFORM: Platform;
  GROUPS: readonly string[];
  collectMetrics(): Promise<any>;
  collectSection(section: string, options?: { fresh?: boolean }): Promise<any>;
  collectInventory(options?: { sections?: string[]; fresh?: boolean }): Promise<any>;
  actionCatalog(): any[];
  actionHistory(): any[];
  runAction(id: string, params?: Record<string, unknown>): Promise<any>;
  scanCleanup(options?: { fresh?: boolean }): Promise<any>;
  /** Read-only leftover scan for one installed application (1.6). */
  scanFootprint(options?: { path?: string; fresh?: boolean }): Promise<FootprintReport>;
  runBenchmark(options?: { tests?: string[]; repeat?: boolean }): Promise<any>;
}

/** Minimal Cordis plugin context used by this plugin (not the full DSH type). */
export interface PluginContext {
  effect(callback: () => void | Disposable | Disposable[], label?: string): void | Disposable | Disposable[];
  webServer: WebServerService;
  connection: ConnectionService;
  tools: ToolsService;
}

/* ------------------------------------------------------------------------- */
/* Per-action normalized parameter values (P1)                                */
/* ------------------------------------------------------------------------- */

/** Signals macOS accepts for `process.signal`. */
export type DarwinSignal = 'TERM' | 'KILL' | 'INT' | 'STOP' | 'CONT';
/** Signals Windows accepts for `process.signal`. */
export type Win32Signal = 'TERM' | 'KILL' | 'INT';

/** Normalized value of a Windows uninstall target. */
export type Win32UninstallValue =
  | { kind: 'msi'; id: string; guid: string }
  | { kind: 'winget'; id: string; token: string }
  | { kind: 'registry'; id: string; key: string };

/**
 * The optional footprint-cleanup tail of `app.uninstall`, on both platforms.
 * Absent means "behave exactly like the pre-1.6 single-step uninstall".
 */
export type UninstallFootprintParams = Partial<FootprintCleanupRequest>;

/** macOS normalized action values (the subset consumed by the darwin runners). */
export interface DarwinActionParamsById {
  'process.signal': { pid: number; signal?: DarwinSignal };
  'app.quit': { name: string };
  'app.launch': { path: string };
  'app.reveal': { path: string };
  'app.uninstall': { path: string; mode?: 'trash' | 'delete' } & UninstallFootprintParams;
  'system.setHostname': { kind: 'HostName' | 'ComputerName' | 'LocalHostName'; value: string };
  'system.setVolume': { percent: number };
  'system.setDarkMode': { enabled: boolean };
  'system.launchAgent': { path: string; enabled: boolean };
  'system.openSettings': { pane: string };
  'system.toggleFirewall': { enabled: boolean };
  'system.flushDNS': Record<string, never>;
  'system.emptyTrash': Record<string, never>;
  'cleanup.delete': { ids: string[] };
  'network.setWifiPower': { enabled: boolean };
  'network.setDns': { service: string; servers: string[] };
  'power.sleep': Record<string, never>;
  'power.lock': Record<string, never>;
  'software.brewUninstall': { name: string };
}

/** Windows normalized action values (the shape `runAction` hands to each runner). */
export interface Win32ActionParamsById {
  'process.signal': { pid: number; signal: Win32Signal };
  'app.quit': { name: string };
  'app.launch': { path: string };
  'app.reveal': { path: string };
  'app.uninstall': Win32UninstallValue & UninstallFootprintParams;
  'system.setHostname': { kind: 'ComputerName'; value: string };
  'system.setVolume': { percent: number };
  'system.setDarkMode': { enabled: boolean };
  'system.launchAgent': { hive: 'HKCU' | 'HKLM' | 'HKLM32'; name: string; path: string; enabled: boolean };
  'system.openSettings': { pane: string };
  'system.toggleFirewall': { enabled: boolean };
  'system.flushDNS': Record<string, never>;
  'system.emptyTrash': Record<string, never>;
  'cleanup.delete': { ids: string[] };
  'network.setWifiPower': { enabled: boolean };
  'network.setDns': { service: string; servers: string[] };
  'power.sleep': Record<string, never>;
  'power.lock': Record<string, never>;
  'software.wingetUninstall': { id: string };
}
