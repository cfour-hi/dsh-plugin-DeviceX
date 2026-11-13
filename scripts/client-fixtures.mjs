const GB = 1024 ** 3;

export const metricsFixture = () => ({
  ts: Date.now(),
  hostname: "MacBook-Pro.local",
  osVersion: "macOS 15.1 (24B83)",
  uptimeSec: 93600,
  cpu: {
    model: "Apple M3 Pro",
    usagePercent: 23.5,
    perCore: [12.1, 5.2, 44.3, 9.9, 31.2, 18.4, 7.7, 62.1, 11.1, 4.4, 28.8, 15.5],
    loadAvg: [1.2, 1.5, 1.4],
    logicalCores: 12,
    physicalCores: 12,
  },
  memory: {
    totalBytes: 36 * GB,
    usedBytes: 21 * GB,
    appBytes: 12 * GB,
    wiredBytes: 3 * GB,
    compressedBytes: 0.8 * GB,
    cachedBytes: 4 * GB,
    freeBytes: 5 * GB,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    pressure: "normal",
  },
  disk: { totalBytes: 460 * GB, usedBytes: 280 * GB, freeBytes: 180 * GB, readBytesPerSec: 1024, writeBytesPerSec: 2048 },
  network: {
    rxBytesPerSec: 10240,
    txBytesPerSec: 2048,
    totalRxBytes: 0,
    totalTxBytes: 0,
    wifi: { ssid: "MyWiFi", rssi: -52, channel: 36 },
    primaryIpv4: ["192.168.1.8"],
    defaultInterface: "en0",
  },
  battery: { present: true, percent: 87, charging: false, plugged: false, powerSource: "Battery Power", timeRemainingMin: 250, temperatureC: 31.2, cycleCount: 123, healthPercent: 92 },
  thermal: {
    available: true,
    cpuCelsius: 46.5,
    gpuCelsius: null,
    batteryCelsius: 31.2,
    nvmeCelsius: null,
    pressure: "nominal",
    fans: [],
    sources: ["nsprocessinfo", "ioreg-applesmartbattery"],
    note: "cpu-needs-admin",
  },
  processes: {
    total: 512,
    top: [
      { pid: 1234, name: "WindowServer", cpu: 14.2, memPercent: 2.8, user: "_windowserver" },
      { pid: 222, name: "kernel_task", cpu: 8.1, memPercent: 1.2, user: "root" },
    ],
  },
});

export const hardwareFixture = () => ({
  cpu: { model: "Apple M3 Pro", vendor: "Apple", physicalCores: 12, logicalCores: 12, speedGHz: 3.7, architecture: "arm64", features: ["NEON", "FP16", "SHA3"] },
  memory: {
    totalBytes: 36 * GB,
    type: "LPDDR5",
    speedMHz: 6400,
    modules: [{ slot: "Unified", sizeBytes: 36 * GB, type: "LPDDR5", speedMHz: 6400, manufacturer: "Apple", partNumber: "M3PRO-36" }],
  },
  gpu: [{ name: "Apple M3 Pro GPU", cores: 18, vramBytes: 12 * GB, vendor: "Apple", metal: true }],
  displays: [
    { name: "Liquid Retina XDR", resolution: "3456x2234", refreshHz: 120, main: true, connection: "built-in" },
    { name: "D2724Q", resolution: "2560x1440", refreshHz: 75, main: false, connection: "external" },
  ],
  storage: {
    physical: [{ name: "APPLE SSD AP0512Z", model: "AP0512Z", sizeBytes: 500 * GB, mediaType: "SSD", smartStatus: "Verified" }],
    volumes: [
      { name: "Macintosh HD", mount: "/", fs: "APFS", totalBytes: 460 * GB, usedBytes: 280 * GB, freeBytes: 180 * GB, removable: false, internal: true },
      { name: "Backup", mount: "/Volumes/Backup", fs: "APFS", totalBytes: 100 * GB, usedBytes: 40 * GB, freeBytes: 60 * GB, removable: true, internal: false },
    ],
  },
  battery: { percent: 87, condition: "Normal", cycleCount: 123, designCapacityMah: 8694, maxCapacityMah: 8000, temperatureC: 31.2, healthPercent: 92 },
  usb: [{ name: "USB-C Digital AV Adapter", vendor: "Apple", productId: "0x1234", serial: "ABC123", speed: "5 Gb/s", bus: "USB 3.1" }],
  bluetooth: {
    controller: { address: "AA:BB:CC:DD:EE:FF", chipset: "BCM4387", firmware: "1.0", state: "on" },
    devices: [{ name: "Magic Keyboard", address: "11:22:33:44:55:66", connected: true, batteryPercent: 76, type: "keyboard" }],
  },
  audio: [
    { name: "MacBook Pro Speakers", kind: "output", manufacturer: "Apple", default: true },
    { name: "MacBook Pro Mic", kind: "input", manufacturer: "Apple", default: true },
  ],
  cameras: [{ name: "FaceTime HD Camera", modelId: "AppleCamera", uniqueId: "0x0001" }],
  drivers: [
    { name: "AppleAPFSMedia", class: null, manufacturer: "Apple", version: "2333.41.3", date: "2024-11-01", signer: "Apple Inc.", inf: null, deviceId: "com.apple.filesystems.apfs", kind: "kext", problem: null },
    { name: "AppleNVMe", class: null, manufacturer: "Apple", version: "1.0", date: "2024-10-02", signer: "Apple Inc.", inf: null, deviceId: "com.apple.driver.AppleNVMe", kind: "kext", problem: null },
    { name: "Elgato Virtual HID", class: null, manufacturer: "Elgato", version: "1.4.2", date: "2025-02-11", signer: "Elgato Systems GmbH", inf: null, deviceId: "com.elgato.virtualhid", kind: "driverkit", problem: null },
  ],
  driverSummary: { total: 3, thirdParty: 1, problems: 0 },
  driverProblems: [],
  errors: [],
});

export const systemFixture = () => ({
  os: { name: "macOS", version: "15.1", build: "24B83", kernel: "Darwin 24.1.0", arch: "arm64", release: "24B83" },
  device: { hostname: "MacBook-Pro.local", computerName: "MacBook Pro", localHostname: "MacBook-Pro", model: "MacBook Pro", modelId: "Mac15,6", chip: "Apple M3 Pro", serial: "C02XYZ123", hardwareUuid: "UUID-1234" },
  boot: { bootTime: Date.now() - 93600 * 1000, uptimeSec: 93600 },
  user: { name: "qaxc84", fullName: "Qax C84", uid: 501, gid: 20, home: "/Users/qaxc84", shell: "/bin/zsh", admin: true },
  users: [
    { name: "qaxc84", uid: 501, gid: 20, fullName: "Qax C84", home: "/Users/qaxc84", shell: "/bin/zsh", admin: true, isCurrent: true },
    { name: "_windowserver", uid: 88, gid: 88, fullName: "WindowServer", home: "/var/empty", shell: "/usr/bin/false", admin: false, isCurrent: false },
  ],
  launchAgents: [
    { label: "com.apple.SafariHistoryServiceAgent", path: "/System/Library/LaunchAgents/com.apple.SafariHistoryServiceAgent.plist", scope: "system", loaded: true, pid: null, lastExitStatus: 0, program: "/usr/libexec/SafariHistoryServiceAgent" },
    { label: "com.example.agent", path: "/Users/qaxc84/Library/LaunchAgents/com.example.agent.plist", scope: "user", loaded: false, pid: null, lastExitStatus: null, program: "/usr/local/bin/example" },
  ],
  loginItems: [{ name: "Dropbox" }, { name: "Bartender" }],
  environment: { PATH: "/usr/local/bin:/usr/bin:/bin", SHELL: "/bin/zsh", HOME: "/Users/qaxc84", USER: "qaxc84", LANG: "en_US.UTF-8", TERM: "xterm-256color" },
  locale: { timezone: "Asia/Shanghai", locale: "en_US.UTF-8", language: "en" },
  errors: [],
});

export const softwareFixture = () => ({
  applications: [
    { name: "Safari", path: "/System/Applications/Safari.app", version: "18.0", bundleId: "com.apple.Safari", source: "system", arch: "arm64", lastUsed: Date.now() - 3600 * 1000, sizeBytes: 120 * 1024 * 1024 },
    { name: "Visual Studio Code", path: "/Applications/Visual Studio Code.app", version: "1.95.0", bundleId: "com.microsoft.VSCode", source: "user", arch: "arm64", lastUsed: Date.now() - 60 * 1000, sizeBytes: 380 * 1024 * 1024 },
    { name: "Example Tool", path: "/Applications/Example Tool.app", version: "0.1.0", bundleId: "com.example.tool", source: "other", arch: "universal", lastUsed: null, sizeBytes: null },
  ],
  totalApplications: 3,
  homebrew: {
    available: true,
    prefix: "/opt/homebrew",
    installed: [{ name: "git", version: "2.47.0" }, { name: "jq", version: "1.7.1" }],
    outdated: [{ name: "jq", current: "1.7.1", latest: "1.7.2" }],
  },
  errors: [],
});

export const networkFixture = () => ({
  interfaces: [
    { name: "en0", type: "wifi", up: true, ipv4: ["192.168.1.8"], ipv6: ["fe80::1"], mac: "AA:BB:CC:DD:EE:FF", mtu: 1500, primary: true },
    { name: "lo0", type: "loopback", up: true, ipv4: ["127.0.0.1"], ipv6: ["::1"], mac: "", mtu: 16384, primary: false },
  ],
  wifi: { ssid: "MyWiFi", bssid: "AA:BB:CC:DD:EE:FF", rssi: -52, noise: -90, channel: 36, security: "WPA3", txRateMbps: 1200 },
  defaultRoute: { gateway: "192.168.1.1", interface: "en0" },
  dns: { servers: ["192.168.1.1", "1.1.1.1"], searchDomains: ["lan"] },
  proxy: { http: null, https: null, socks: null },
  listeningPorts: [
    { proto: "tcp", address: "127.0.0.1", port: 50732, pid: 1234, process: "DeepSeek Harness" },
    { proto: "tcp6", address: "::1", port: 8080, pid: 5678, process: "node" },
  ],
  establishedCount: 42,
  errors: [],
});

export const securityFixture = () => ({
  fileVault: { enabled: true, raw: "FileVault is On." },
  sip: { enabled: true, raw: "System Integrity Protection status: enabled." },
  gatekeeper: { enabled: true, raw: "assessments enabled" },
  firewall: { enabled: true, raw: "Firewall is enabled.", stealthMode: false },
  tcc: { readable: true, reason: "", grants: [{ service: "Camera", client: "com.apple.FaceTime" }, { service: "Accessibility", client: "com.example.tool" }] },
  users: { current: "qaxc84", admins: ["qaxc84"], total: 5 },
  remoteLogin: false,
  autoLogin: null,
  errors: [],
});

export const processesFixture = () => ({
  total: 512,
  list: [
    // `elapsed` is seconds, like both hosts emit (`parseElapsed` on macOS, the
    // creation-date delta on Windows) — not the raw `ps` "3d 04:12" string.
    { pid: 1234, ppid: 1, user: "_windowserver", cpu: 14.2, memPercent: 2.8, rssBytes: 512 * 1024 * 1024, state: "running", elapsed: 3 * 86400 + 4 * 3600 + 12 * 60, command: "/System/Library/PrivateFrameworks/SkyLight.framework/WindowServer" },
    { pid: 222, ppid: 0, user: "root", cpu: 8.1, memPercent: 1.2, rssBytes: 256 * 1024 * 1024, state: "running", elapsed: 3 * 86400 + 4 * 3600 + 12 * 60, command: "kernel_task" },
    { pid: 9876, ppid: 1234, user: "qaxc84", cpu: 0.4, memPercent: 0.1, rssBytes: 24 * 1024 * 1024, state: "sleeping", elapsed: 12, command: "node /tmp/dshx/asar/index.js" },
  ],
  byUser: [{ user: "qaxc84", count: 320 }, { user: "root", count: 120 }],
  errors: [],
});

const action = (id, group, danger, requiresAdmin, params) => ({ id, group, danger, requiresAdmin, params });

export const actionsFixture = () => [
  action("process.signal", "process", "high", false, [
    { name: "pid", type: "number", required: true, min: 2, max: 4194304, placeholder: "1234" },
    { name: "signal", type: "select", required: true, options: ["TERM", "KILL", "INT", "STOP", "CONT"] },
  ]),
  action("app.quit", "app", "low", false, [{ name: "name", type: "string", required: true }]),
  action("app.launch", "app", "low", false, [{ name: "path", type: "string", required: true }]),
  action("app.reveal", "app", "low", false, [{ name: "path", type: "string", required: true }]),
  action("app.uninstall", "app", "high", false, [
    { name: "path", type: "string", required: true },
    { name: "mode", type: "select", required: false, options: ["trash", "delete"] },
  ]),
  action("system.setHostname", "system", "medium", true, [
    { name: "kind", type: "select", required: true, options: ["HostName", "ComputerName", "LocalHostName"] },
    { name: "value", type: "string", required: true },
  ]),
  action("system.setVolume", "system", "low", false, [{ name: "percent", type: "number", required: true, min: 0, max: 100 }]),
  action("system.setDarkMode", "system", "low", false, [{ name: "enabled", type: "boolean", required: true }]),
  action("system.launchAgent", "system", "medium", true, [
    { name: "path", type: "string", required: true },
    { name: "enabled", type: "boolean", required: true },
  ]),
  action("system.openSettings", "system", "low", false, [
    { name: "pane", type: "select", required: true, options: ["network", "privacy", "firewall", "sharing", "users", "general"] },
  ]),
  action("system.toggleFirewall", "system", "high", true, [{ name: "enabled", type: "boolean", required: true }]),
  action("system.flushDNS", "system", "low", false, []),
  action("system.emptyTrash", "system", "high", false, []),
  action("cleanup.delete", "system", "high", false, [{ name: "ids", type: "string", required: true, multiple: true }]),
  action("network.setWifiPower", "network", "medium", false, [{ name: "enabled", type: "boolean", required: true }]),
  action("network.setDns", "network", "medium", true, [
    { name: "service", type: "string", required: true },
    { name: "servers", type: "string", required: false },
  ]),
  action("power.sleep", "power", "low", false, []),
  action("power.lock", "power", "low", false, []),
  action("software.brewUninstall", "software", "medium", false, [{ name: "name", type: "string", required: true }]),
];

export const historyFixture = () => [
  { ts: Date.now() - 1000 * 60, id: "system.flushDNS", params: {}, ok: true, message: "DNS cache flushed" },
  { ts: Date.now() - 1000 * 120, id: "process.signal", params: { pid: 4444, signal: "TERM" }, ok: true, message: "Sent TERM to 4444" },
];

export const inventoryBySection = () => ({
  hardware: hardwareFixture(),
  system: systemFixture(),
  software: softwareFixture(),
  network: networkFixture(),
  security: securityFixture(),
  processes: processesFixture(),
});

export const cleanupFixture = () => {
  const items = [
    { id: "user-caches", label: "User caches", detail: "~/Library/Caches", category: "cache", path: "/Users/qaxc84/Library/Caches", bytes: 12 * 1024 ** 3, files: 41200, requiresAdmin: false, exists: true, error: "" },
    { id: "user-logs", label: "User logs", detail: "~/Library/Logs", category: "logs", path: "/Users/qaxc84/Library/Logs", bytes: 1.2 * 1024 ** 3, files: 830, requiresAdmin: false, exists: true, error: "" },
    { id: "trash", label: "Trash", detail: "~/.Trash", category: "trash", path: "/Users/qaxc84/.Trash", bytes: 4.2 * 1024 ** 3, files: 210, requiresAdmin: false, exists: true, error: "" },
    { id: "xcode-derived", label: "Xcode DerivedData", detail: "~/Library/Developer/Xcode/DerivedData", category: "developer", path: "/Users/qaxc84/Library/Developer/Xcode/DerivedData", bytes: 8 * 1024 ** 3, files: 3200, requiresAdmin: false, exists: true, error: "" },
    { id: "system-caches", label: "System caches", detail: "/Library/Caches", category: "cache", path: "/Library/Caches", bytes: 2 * 1024 ** 3, files: 910, requiresAdmin: true, exists: true, error: "" },
  ];
  return {
    platform: "darwin",
    generatedAt: Date.now() - 4000,
    durationMs: 420,
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles: items.reduce((sum, item) => sum + item.files, 0),
    errors: [],
  };
};

/**
 * Uninstall-footprint report covering all four tiers, including the real
 * `Claude-3p` case (11 GB, name-only match, tier B).
 */
export const footprintFixture = () => {
  const items = [
    {
      id: "fp_app0001",
      kind: "app",
      path: "/Applications/Claude.app",
      displayPath: "/Applications/Claude.app",
      bytes: 680 * 1024 ** 2,
      files: 4200,
      confidence: "high",
      source: "bundle-id",
      reason: "The application bundle itself.",
      requiresAdmin: false,
      exists: true,
    },
    {
      id: "fp_cache001",
      kind: "data",
      path: "/Users/qaxc84/Library/Caches/com.anthropic.claudefordesktop",
      displayPath: "~/Library/Caches/com.anthropic.claudefordesktop",
      bytes: 300 * 1024,
      files: 12,
      confidence: "high",
      source: "bundle-id",
      reason: "Directory name matches the app's bundle identifier.",
      requiresAdmin: false,
      exists: true,
    },
    {
      id: "fp_name0001",
      kind: "data",
      path: "/Users/qaxc84/Library/Application Support/Claude-3p",
      displayPath: "~/Library/Application Support/Claude-3p",
      bytes: 11 * 1024 ** 3,
      files: 182000,
      confidence: "medium",
      source: "name-match",
      reason: "Directory name resembles the app name: Claude = Claude-3p.",
      requiresAdmin: false,
      exists: true,
    },
    {
      id: "fp_conf0001",
      kind: "data",
      path: "/Users/qaxc84/Library/Application Support/Claude",
      displayPath: "~/Library/Application Support/Claude",
      bytes: 361 * 1024 ** 2,
      files: 2100,
      confidence: "conflict",
      source: "name-match",
      reason: "Directory name also matches 1 other installed app(s).",
      alsoMatchedBy: ["claude"],
      requiresAdmin: false,
      exists: true,
    },
    {
      id: "fp_share001",
      kind: "shared",
      path: "/Users/qaxc84/Library/Application Support/Google",
      displayPath: "~/Library/Application Support/Google",
      bytes: 17 * 1024 ** 3,
      files: 90000,
      confidence: "shared",
      source: "bundle-id",
      reason: "Vendor-level directory shared with other products; shown for reference only.",
      requiresAdmin: false,
      exists: true,
    },
    {
      id: "fp_admin001",
      kind: "system",
      path: "/Library/PrivilegedHelperTools/com.example.helper",
      displayPath: "/Library/PrivilegedHelperTools/com.example.helper",
      bytes: 2 * 1024 ** 2,
      files: 3,
      confidence: "high",
      source: "bundle-id",
      reason: "Directory name matches the app's bundle identifier.",
      requiresAdmin: true,
      exists: true,
    },
  ];
  return {
    scanId: "11111111-2222-3333-4444-555555555555",
    appPath: "/Applications/Claude.app",
    bundleId: "com.anthropic.claudefordesktop",
    sandboxed: false,
    targetedRoots: ["~/Library/Application Support", "~/Library/Caches", "/Library/Preferences"],
    generatedAt: Date.now() - 1200,
    durationMs: 265,
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    selectedBytes: items
      .filter((item) => item.confidence === "high" && !item.requiresAdmin)
      .reduce((sum, item) => sum + item.bytes, 0),
    errors: [],
  };
};

export const benchmarkFixture = (previous = null) => ({
  platform: "darwin",
  startedAt: Date.now() - 1500,
  durationMs: 1510,
  environment: {
    hostname: "MacBook-Pro.local",
    cpuModel: "Apple M3 Pro",
    logicalCores: 12,
    physicalCores: null,
    memoryBytes: 36 * 1024 ** 3,
    osVersion: "darwin 24.5.0",
  },
  results: [
    { id: "cpu", durationMs: 1000, score: 300000000, unit: "ops/s", details: { singleThread: { score: 110000000, durationMs: 620 }, multiThread: { score: 300000000, threads: 4, mode: "multi" } } },
    { id: "memory", durationMs: 180, score: 9.2, unit: "GB/s", details: { passes: 48, megabytes: 1536 } },
    { id: "disk", durationMs: 40, score: 5200, unit: "MB/s", details: { writeMBps: 1800, readMBps: 8600, bytes: 64 * 1024 ** 2 } },
  ],
  previous,
});
