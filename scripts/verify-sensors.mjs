#!/usr/bin/env node
/**
 * Device X — thermal sensors and driver inventory verification.
 *
 * Standalone companion to `scripts/verify.mjs` / `scripts/verify-windows.mjs`
 * (the Lead owns those; this one is scoped to the sensors/drivers work). It
 * never spawns PowerShell and never needs Windows:
 *
 *   1. static guards over the macOS/Windows collectors and bundled scripts
 *      (contract keys, caps, ASCII-only scripts, bounded probes, docs),
 *   2. the Windows `metrics.json` / `hardware.json` fixtures through the pure
 *      `collector-win32.__test.mapMetrics/mapHardware` mappers (exact shapes,
 *      JSON-safety, caps, failure tolerance),
 *   3. live macOS probes: `collectMetrics()` returns the frozen thermal object
 *      and `collectSection('hardware')` returns the driver arrays (bounded
 *      runtime, no Windows/PowerShell involved).
 *
 * Usage: node scripts/verify-sensors.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');
const fixtureDir = join(here, 'fixtures', 'win32');

const startedAt = Date.now();
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail === undefined ? '' : ` (${detail})`}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` (${detail})`}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function jsonSafe(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' && !text.includes('NaN') && !text.includes('Infinity') ? text : null;
  } catch {
    return null;
  }
}
function hasKeys(object, keys) {
  return isPlainObject(object) && keys.every((key) => Object.hasOwn(object, key));
}
function exactKeys(object, keys) {
  if (!isPlainObject(object)) return false;
  const own = Object.keys(object);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(object, key));
}
const THERMAL_KEYS = [
  'available',
  'cpuCelsius',
  'gpuCelsius',
  'batteryCelsius',
  'nvmeCelsius',
  'pressure',
  'fans',
  'sources',
  'note',
];
const DRIVER_KEYS = ['name', 'class', 'manufacturer', 'version', 'date', 'signer', 'inf', 'deviceId', 'kind', 'problem'];
const THERMAL_NOTES = ['cpu-needs-admin', 'wmi-unsupported', 'unavailable'];
const THERMAL_PRESSURE = ['nominal', 'fair', 'serious', 'critical'];
const DRIVER_KINDS = ['kext', 'driverkit', 'pnp'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const darwinSource = readFileSync(join(pluginDir, 'host', 'collector-darwin.js'), 'utf8');
const win32Source = readFileSync(join(pluginDir, 'host', 'collector-win32.js'), 'utf8');
const metricsPs1 = readFileSync(join(pluginDir, 'host', 'win', 'metrics.ps1'), 'utf8');
const hardwarePs1 = readFileSync(join(pluginDir, 'host', 'win', 'hardware.ps1'), 'utf8');
const contractDoc = readFileSync(join(root, 'docs', 'windows-contract.md'), 'utf8');

// ---------------------------------------------------------------------------
section('1. Static guards (contract keys, caps, bounded probes, ASCII)');

check(
  'darwin collector has the metrics.thermal contract keys',
  THERMAL_KEYS.every((key) => darwinSource.includes(key)),
  THERMAL_KEYS.join(','),
);
check(
  'darwin thermal pressure uses NSProcessInfo.thermalState via osascript',
  darwinSource.includes('NSProcessInfo.processInfo.thermalState') && darwinSource.includes('readThermalPressure'),
);
check(
  'darwin pressure probe is bounded (1500 ms timeout)',
  darwinSource.includes('timeout: 1_500'),
);
check(
  'darwin optional helpers are looked up (osx-cpu-temp/smctemp/istats)',
  ['osx-cpu-temp', 'smctemp', 'istats'].every((name) => darwinSource.includes(`'${name}'`)),
);
check(
  'darwin runs powermetrics only with root privileges',
  darwinSource.includes('POWERMETRICS') && darwinSource.includes('function isRootUser') && darwinSource.includes('getuid() === 0'),
);
check(
  'darwin thermal probe is cached for 5000 ms',
  /const THERMAL_TTL = 5_000;/.test(darwinSource) && darwinSource.includes("memo('thermal', THERMAL_TTL"),
);
check(
  'darwin pump/powermetrics probes are timeout-bounded',
  darwinSource.includes('timeout: 2_000') && darwinSource.includes('timeout: 4_000'),
);
check(
  'darwin always leaves nvmeCelsius null and fans empty (no invented sources)',
  darwinSource.includes('nvmeCelsius: null') && darwinSource.includes('const fans = [];'),
);
check(
  'darwin drivers come from SPExtensionsDataType with kext/driverkit kinds',
  darwinSource.includes('SPExtensionsDataType') &&
    darwinSource.includes("'driverkit'") &&
    darwinSource.includes("'kext'"),
);
check(
  'darwin hardware returns drivers/driverSummary/driverProblems',
  darwinSource.includes('parseDarwinDrivers') &&
    darwinSource.includes('driverSummary: driverSummaryOf') &&
    darwinSource.includes('driverProblems,'),
);
check(
  'darwin drivers are ordered third-party/loaded first then version desc and capped',
  darwinSource.includes('records.length > MAX_DRIVERS') &&
    darwinSource.includes('left.thirdParty ? -1 : 1') &&
    darwinSource.includes('compareDriverVersions'),
);
check(
  'win32 driver summary reports truncation of the raw list',
  win32Source.includes('truncated: rawDrivers.length > MAX_DRIVERS'),
);
check(
  'win32 collector maps metrics.thermal with the frozen caps',
  win32Source.includes('function mapThermal') &&
    win32Source.includes('MAX_DRIVERS = 250') &&
    win32Source.includes('MAX_DRIVER_PROBLEMS = 50'),
);
check(
  'win32 collector maps the driver inventory',
  ['mapDriver', 'mapDriverProblem', 'driverSummary', 'driverProblems'].every((token) => win32Source.includes(token)),
);
check(
  'win metrics.ps1 reads WMI thermal zones and optional nvidia-smi',
  metricsPs1.includes('MSAcpi_ThermalZoneTemperature') &&
    metricsPs1.includes('nvidia-smi') &&
    metricsPs1.includes("'wmi-unsupported'"),
);
check(
  'win hardware.ps1 reads signed drivers and problem devices',
  hardwarePs1.includes('Win32_PnPSignedDriver') &&
    hardwarePs1.includes('ConfigManagerErrorCode') &&
    hardwarePs1.includes("'yyyy-MM-dd'"),
);
check('host/win/metrics.ps1 is ASCII-only', !/[^\x00-\x7F]/.test(metricsPs1));
check('host/win/hardware.ps1 is ASCII-only', !/[^\x00-\x7F]/.test(hardwarePs1));
check(
  'no legacy thermal key remains in either host collector',
  !darwinSource.includes('cpuTempC') && !win32Source.includes('cpuTempC'),
);
check(
  'fallbackMetrics on both platforms carries the null-filled thermal object',
  darwinSource.includes('thermal: emptyThermal()') && win32Source.includes('thermal: emptyThermal()'),
);
check(
  'host collectors never use a shell/child_process directly',
  !darwinSource.includes('child_process') && !win32Source.includes('child_process'),
);
check(
  'every win32 PowerShell script keeps its wall-clock timeout',
  /'metrics\.ps1': 15_000/.test(win32Source) && /'hardware\.ps1': 30_000/.test(win32Source),
);
check(
  'docs carry the Thermal contract and Driver inventory contract sections',
  contractDoc.includes('## Thermal contract (sensors)') && contractDoc.includes('## Driver inventory contract'),
);

// ---------------------------------------------------------------------------
section('2. Windows fixtures through the pure mappers');
const collector = await import(pathToFileURL(join(pluginDir, 'host', 'collector-win32.js')));
const metricsFixture = JSON.parse(readFileSync(join(fixtureDir, 'metrics.json'), 'utf8'));
const hardwareFixture = JSON.parse(readFileSync(join(fixtureDir, 'hardware.json'), 'utf8'));
const mappedMetrics = collector.__test.mapMetrics(metricsFixture, { now: 1762516500000 });
const mappedHardware = collector.__test.mapHardware(hardwareFixture);

check('mapped win32 metrics is JSON-safe', jsonSafe(mappedMetrics) !== null);
check('metrics.thermal has exactly the frozen keys', exactKeys(mappedMetrics.thermal, THERMAL_KEYS));
check(
  'thermal.available is true when a temperature was read',
  mappedMetrics.thermal.available === true,
  String(mappedMetrics.thermal.available),
);
check(
  'fixture thermal maps cpu/gpu temperatures',
  mappedMetrics.thermal.cpuCelsius === 62.5 && mappedMetrics.thermal.gpuCelsius === 54,
  `cpu=${mappedMetrics.thermal.cpuCelsius} gpu=${mappedMetrics.thermal.gpuCelsius}`,
);
check(
  'thermal.batteryCelsius mirrors metrics.battery.temperatureC',
  mappedMetrics.battery !== null && mappedMetrics.thermal.batteryCelsius === mappedMetrics.battery.temperatureC,
  String(mappedMetrics.thermal.batteryCelsius),
);
check(
  'thermal nvmeCelsius/pressure stay null on Windows',
  mappedMetrics.thermal.nvmeCelsius === null && mappedMetrics.thermal.pressure === null,
);
check(
  'thermal fans map to {name,rpm} and sources list what was used',
  Array.isArray(mappedMetrics.thermal.fans) &&
    mappedMetrics.thermal.fans.length === 1 &&
    exactKeys(mappedMetrics.thermal.fans[0], ['name', 'rpm']) &&
    mappedMetrics.thermal.fans[0].name === 'GPU' &&
    mappedMetrics.thermal.fans[0].rpm === null &&
    JSON.stringify(mappedMetrics.thermal.sources) === JSON.stringify(['wmi-thermal-zone', 'nvidia-smi']),
);
check(
  'thermal note is null when the WMI zone succeeded',
  mappedMetrics.thermal.note === null,
  String(mappedMetrics.thermal.note),
);
const emptyMetrics = collector.__test.mapMetrics({});
check(
  'empty metrics input still yields the frozen thermal shape',
  exactKeys(emptyMetrics.thermal, THERMAL_KEYS) &&
    emptyMetrics.thermal.available === false &&
    THERMAL_NOTES.includes(emptyMetrics.thermal.note) &&
    Array.isArray(emptyMetrics.thermal.fans) &&
    emptyMetrics.thermal.fans.length === 0 &&
    jsonSafe(emptyMetrics) !== null,
);
const outOfRange = collector.__test.mapMetrics({ thermal: { cpuCelsius: 9999, gpuCelsius: 43.2, fans: [{ name: 'GPU', rpm: 1200 }] } });
check(
  'implausible temperatures are discarded, plausible ones kept',
  outOfRange.thermal.cpuCelsius === null &&
    outOfRange.thermal.gpuCelsius === 43.2 &&
    outOfRange.thermal.fans[0].rpm === 1200 &&
    outOfRange.thermal.available === true,
);
check('mapped win32 hardware is JSON-safe', jsonSafe(mappedHardware) !== null);
check(
  'fixture drivers map to the frozen driver shape',
  Array.isArray(mappedHardware.drivers) &&
    mappedHardware.drivers.length === 6 &&
    mappedHardware.drivers.every((driver) => exactKeys(driver, DRIVER_KEYS)),
  `${mappedHardware.drivers.length} drivers`,
);
check(
  'driver fields are typed and serialised correctly',
  mappedHardware.drivers.every(
    (driver) =>
      typeof driver.name === 'string' &&
      DRIVER_KINDS.includes(driver.kind) &&
      (driver.date === null || DATE_RE.test(driver.date)) &&
      (driver.class === null || typeof driver.class === 'string'),
  ),
);
check(
  'the problem device is joined onto its driver entry (code 28)',
  mappedHardware.drivers.filter((driver) => driver.problem === '28').length === 1,
);
check(
  'driverProblems maps to {name,code,class}',
  Array.isArray(mappedHardware.driverProblems) &&
    mappedHardware.driverProblems.length === 1 &&
    exactKeys(mappedHardware.driverProblems[0], ['name', 'code', 'class']) &&
    mappedHardware.driverProblems[0].code === '28',
);
check(
  'driverSummary is derived from the capped arrays',
  exactKeys(mappedHardware.driverSummary, ['total', 'thirdParty', 'problems', 'truncated']) &&
    mappedHardware.driverSummary.total === mappedHardware.drivers.length &&
    mappedHardware.driverSummary.problems === mappedHardware.driverProblems.length &&
    mappedHardware.driverSummary.thirdParty === 5 &&
    mappedHardware.driverSummary.truncated === false,
  JSON.stringify(mappedHardware.driverSummary),
);
const emptyHardware = collector.__test.mapHardware({});
check(
  'empty hardware input keeps the empty driver shape',
  Array.isArray(emptyHardware.drivers) &&
    emptyHardware.drivers.length === 0 &&
    Array.isArray(emptyHardware.driverProblems) &&
    emptyHardware.driverProblems.length === 0 &&
    emptyHardware.driverSummary.total === 0 &&
    emptyHardware.driverSummary.problems === 0 &&
    emptyHardware.driverSummary.truncated === false &&
    jsonSafe(emptyHardware) !== null,
);
const dateNormalisation = collector.__test.mapHardware({
  drivers: [
    { name: 'ISO timestamp', date: '2023-06-15T00:00:00Z' },
    { name: 'garbage', date: 'not-a-date' },
  ],
}).drivers;
check(
  'malformed driver date input normalises or becomes null',
  dateNormalisation[0].date === '2023-06-15' && dateNormalisation[1].date === null,
);
const overCapDrivers = Array.from({ length: 300 }, (_, index) => ({ name: `Driver ${index}`, deviceClass: 'SYSTEM' }));
const overCapProblems = Array.from({ length: 60 }, (_, index) => ({
  name: `Broken device ${index}`,
  configManagerErrorCode: 28,
  deviceClass: 'Net',
}));
const capped = collector.__test.mapHardware({ drivers: overCapDrivers, driverProblems: overCapProblems });
check(
  'drivers cap is enforced at 250 with a matching summary',
  capped.drivers.length === 250 &&
    capped.driverSummary.total === 250 &&
    capped.driverSummary.truncated === true,
  `${capped.drivers.length}`,
);
check(
  'driverProblems cap is enforced at 50 with a matching summary',
  capped.driverProblems.length === 50 && capped.driverSummary.problems === 50,
  `${capped.driverProblems.length}`,
);
check('capped hardware stays JSON-safe', jsonSafe(capped) !== null, `${JSON.stringify(capped).length} bytes`);

// ---------------------------------------------------------------------------
section('3. Live macOS probes (metrics.thermal + hardware drivers)');
if (process.platform === 'darwin') {
  const darwin = await import(pathToFileURL(join(pluginDir, 'host', 'collector-darwin.js')));
  const liveMetrics = await darwin.collectMetrics();
  check('collectMetrics() returns a thermal object with the frozen keys', exactKeys(liveMetrics.thermal, THERMAL_KEYS));
  const liveHasTemperature = [
    liveMetrics.thermal.cpuCelsius,
    liveMetrics.thermal.gpuCelsius,
    liveMetrics.thermal.batteryCelsius,
    liveMetrics.thermal.nvmeCelsius,
  ].some((value) => typeof value === 'number' && Number.isFinite(value));
  check(
    'live availability reflects the numeric temperature fields',
    liveMetrics.thermal.available === liveHasTemperature,
    `available=${liveMetrics.thermal.available} numeric=${liveHasTemperature}`,
  );
  check(
    'live batteryCelsius is plausible (or null without a battery)',
    liveMetrics.thermal.batteryCelsius === null ||
      (typeof liveMetrics.thermal.batteryCelsius === 'number' &&
        liveMetrics.thermal.batteryCelsius >= -20 &&
        liveMetrics.thermal.batteryCelsius <= 150),
    String(liveMetrics.thermal.batteryCelsius),
  );
  check(
    'live thermal pressure is a contract value or null',
    liveMetrics.thermal.pressure === null || THERMAL_PRESSURE.includes(liveMetrics.thermal.pressure),
    String(liveMetrics.thermal.pressure),
  );
  check(
    'live thermal note and sources are contract-safe',
    (liveMetrics.thermal.note === null || THERMAL_NOTES.includes(liveMetrics.thermal.note)) &&
      Array.isArray(liveMetrics.thermal.sources) &&
      liveMetrics.thermal.sources.every((source) => typeof source === 'string' && source.length > 0),
    `${liveMetrics.thermal.note} / ${liveMetrics.thermal.sources.join(',')}`,
  );
  check(
    'live thermal keeps nvmeCelsius null and fans [] on darwin',
    liveMetrics.thermal.nvmeCelsius === null &&
      Array.isArray(liveMetrics.thermal.fans) &&
      liveMetrics.thermal.fans.length === 0,
  );
  check('live metrics are JSON-safe', jsonSafe(liveMetrics) !== null);

  const liveHardware = await darwin.collectSection('hardware');
  check(
    'live hardware drivers is a capped array of the frozen shape',
    Array.isArray(liveHardware.drivers) &&
      liveHardware.drivers.length > 0 &&
      liveHardware.drivers.length <= 250 &&
      liveHardware.drivers.every((driver) => exactKeys(driver, DRIVER_KEYS)),
    `${liveHardware.drivers.length} drivers`,
  );
  check(
    'live darwin driver kinds/dates are valid',
    liveHardware.drivers.every(
      (driver) =>
        ['kext', 'driverkit'].includes(driver.kind) &&
        (driver.date === null || DATE_RE.test(driver.date)) &&
        typeof driver.name === 'string',
    ),
  );
  check(
    'live darwin driverProblems is [] and the summary matches the array',
    Array.isArray(liveHardware.driverProblems) &&
      liveHardware.driverProblems.length === 0 &&
      liveHardware.driverSummary.total === liveHardware.drivers.length &&
      liveHardware.driverSummary.problems === 0 &&
      liveHardware.driverSummary.thirdParty >= 0 &&
      liveHardware.driverSummary.truncated === true,
    JSON.stringify(liveHardware.driverSummary),
  );
  check(
    'live darwin driver cap keeps third-party rows first',
    !liveHardware.drivers.some((driver) => driver.manufacturer !== 'Apple') ||
      liveHardware.drivers[0].manufacturer !== 'Apple',
    `first=${liveHardware.drivers[0]?.name} (${liveHardware.drivers[0]?.manufacturer})`,
  );
  check('live hardware is JSON-safe', jsonSafe(liveHardware) !== null);
} else {
  check('live darwin probes require macOS', false, process.platform);
}

const elapsedMs = Date.now() - startedAt;
check('the whole verification stays under the 20 s live-probe budget', elapsedMs < 20_000, `${elapsedMs} ms`);

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'ALL SENSOR CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} — ${passed} checks`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
