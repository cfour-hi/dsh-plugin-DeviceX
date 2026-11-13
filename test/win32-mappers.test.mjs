import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const { __test: win } = await import('../plugin/host/collector-win32.js');
const { __test: cleanup } = await import('../plugin/host/cleanup-win32.js');

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../scripts/fixtures/win32/${name}.json`, import.meta.url), 'utf8'));
}

/* --------------------------------------------------------------- metrics */

test('mapMetrics maps the CIM fixture to the frozen metrics shape', () => {
  const metrics = win.mapMetrics(fixture('metrics'));
  assert.equal(metrics.hostname, 'DESKTOP-8F3K2Q1');
  assert.match(String(metrics.osVersion), /Windows/);
  assert.ok(metrics.cpu.usagePercent !== null && metrics.cpu.usagePercent >= 0 && metrics.cpu.usagePercent <= 100);
  assert.ok(metrics.cpu.logicalCores > 0);
  assert.ok(metrics.memory.totalBytes > 0);
  assert.ok(metrics.disk.totalBytes > 0);
  assert.ok(metrics.processes.top.length > 0);
  assert.equal(typeof metrics.thermal.available, 'boolean');
  assert.ok(Array.isArray(metrics.thermal.sources));
  assert.ok(metrics.thermal.cpuCelsius === null || typeof metrics.thermal.cpuCelsius === 'number');
});

test('mapMetrics is defensive for a missing/empty payload', () => {
  const metrics = win.mapMetrics({});
  assert.equal(metrics.hostname, os.hostname(), 'falls back to the local hostname');
  assert.equal(metrics.cpu.usagePercent, 0);
  assert.deepEqual(metrics.cpu.perCore, []);
  assert.ok(['normal', 'warning', 'critical', null].includes(metrics.memory.pressure));
  assert.equal(metrics.battery, null);
  assert.deepEqual(metrics.processes.top, []);
  assert.equal(metrics.thermal.available, false);
  assert.ok(['wmi-unsupported', null].includes(metrics.thermal.note));
  assert.equal(typeof JSON.stringify(metrics), 'string');
});

test('mapMetrics keeps the fixture JSON-safe', () => {
  const metrics = win.mapMetrics(fixture('metrics'));
  assert.equal(typeof JSON.stringify(metrics), 'string');
  assert.ok(!JSON.stringify(metrics).includes('undefined'));
});

/* --------------------------------------------------------------- hardware */

test('mapHardware maps drivers, summaries and problem devices', () => {
  const hardware = win.mapHardware(fixture('hardware'));
  assert.ok(Array.isArray(hardware.drivers));
  assert.ok(hardware.drivers.length > 0);
  assert.ok(hardware.drivers.length <= 250);
  const driver = hardware.drivers[0];
  assert.equal(typeof driver.name, 'string');
  assert.ok(['pnp', 'kext', 'driverkit'].includes(driver.kind));
  assert.ok(hardware.driverSummary.total >= hardware.drivers.length);
  assert.equal(typeof hardware.driverSummary.thirdParty, 'number');
  assert.ok(Array.isArray(hardware.driverProblems));
});

test('mapHardware tolerates an empty profiler payload', () => {
  const hardware = win.mapHardware({});
  assert.deepEqual(hardware.drivers, []);
  assert.deepEqual(hardware.driverProblems, []);
  assert.equal(hardware.driverSummary.total, 0);
  assert.deepEqual(hardware.usb, []);
  assert.deepEqual(hardware.cameras, []);
});

/* --------------------------------------------------------------- sections */

test('mapSystem/mapSoftware/mapNetwork/mapSecurity/mapProcesses return the frozen shapes', () => {
  const system = win.mapSystem(fixture('system'));
  assert.equal(typeof system.os.name, 'string');
  assert.ok(Array.isArray(system.users));
  assert.ok(Array.isArray(system.launchAgents));

  const software = win.mapSoftware(fixture('software'));
  assert.ok(Array.isArray(software.applications));
  assert.equal(typeof software.totalApplications, 'number');
  assert.equal(typeof software.winget.available, 'boolean');

  const network = win.mapNetwork(fixture('network'));
  assert.ok(Array.isArray(network.interfaces));
  assert.ok(Array.isArray(network.listeningPorts));
  assert.equal(typeof network.establishedCount, 'number');
  assert.ok(Array.isArray(network.dns.servers));

  const security = win.mapSecurity(fixture('security'));
  assert.ok('bitLocker' in security || 'fileVault' in security);
  assert.equal(typeof security.users.total, 'number');

  const processes = win.mapProcesses(fixture('processes'));
  assert.ok(processes.total >= 1);
  assert.ok(Array.isArray(processes.list));
  assert.ok(processes.list.length <= 200);
});

/* ----------------------------------------------------------- cleanup (win32) */

const CLEAN_ENV = {
  SystemRoot: 'C:\\Windows',
  windir: 'C:\\Windows',
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
  TEMP: 'C:\\Users\\dev\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\dev\\AppData\\Local\\Temp',
};

test('normalizeWinItems expands environment variables into fixed paths', () => {
  const items = cleanup.normalizeWinItems(CLEAN_ENV);
  assert.ok(Array.isArray(items) && items.length >= 8);
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'item ids are unique');
  assert.equal(ids[0], 'user-temp');
  const temp = items.find((item) => item.id === 'user-temp');
  assert.match(temp.path, /Users\\dev\\AppData\\Local\\Temp$/);
  assert.equal(items.find((item) => item.id === 'crash-dumps').path, 'C:\\Users\\dev\\AppData\\Local\\CrashDumps');
  assert.ok(items.some((item) => item.requiresAdmin === true));
  // Without environment variables every path is null except the special
  // Recycle Bin pseudo-item, which is not a filesystem path.
  for (const item of cleanup.normalizeWinItems({})) {
    if (item.id === 'recycle-bin') {
      assert.equal(item.path, 'Recycle Bin');
    } else {
      assert.equal(item.path, null, item.id);
    }
  }
});

test('normalizeDeleteIds accepts arrays and comma strings within the cap', () => {
  const fromArray = cleanup.normalizeDeleteIds(['user-temp', 'crash-dumps']);
  assert.equal(fromArray.ok, true);
  assert.deepEqual(fromArray.items.map((item) => item.id), ['user-temp', 'crash-dumps']);
  const fromString = cleanup.normalizeDeleteIds('user-temp, crash-dumps');
  assert.equal(fromString.ok, true);
  assert.deepEqual(fromString.items.map((item) => item.id), ['user-temp', 'crash-dumps']);
  assert.equal(cleanup.normalizeDeleteIds([]).ok, false);
  assert.equal(cleanup.normalizeDeleteIds('../../etc/passwd').ok, false);
  assert.equal(cleanup.normalizeDeleteIds(['user-temp', 'user-temp']).ok, false);
  assert.equal(cleanup.normalizeDeleteIds(Array.from({ length: cleanup.MAX_DELETE_IDS + 1 }, () => 'user-temp')).ok, false);
});

/* --------------------------------------------------- metrics detail merge */

test('mergeMetricsRaw fills omitted fast fields from the detail document', () => {
  const fast = {
    hostname: 'HOST',
    cpu: null,
    battery: null,
    network: { counters: { read: 1, write: 2 }, defaultInterface: null, primaryIpv4: [], wifi: null },
    thermal: { cpuCelsius: null, gpuCelsius: null, fans: [], sources: [], note: 'wmi-unsupported' },
    processes: { total: 3, top: [{ pid: 42, name: 'x', cpuPercent: 1, workingSetBytes: 1, user: null }] },
  };
  const detail = {
    cpu: { name: 'CPU', physicalCores: 4, logicalCores: 8 },
    battery: { present: true, percent: 90 },
    network: { defaultInterface: 'Ethernet', defaultGateway: '10.0.0.1', primaryIpv4: ['10.0.0.2'], wifi: null },
    thermal: { gpuCelsius: 55, fans: [{ name: 'GPU', rpm: null }], sources: ['nvidia-smi'] },
    owners: { 42: 'DOMAIN' + String.fromCharCode(92) + 'user' },
  };
  const merged = win.mergeMetricsRaw(fast, detail);
  assert.equal(merged.cpu.physicalCores, 4);
  assert.equal(merged.battery.percent, 90);
  assert.equal(merged.network.defaultInterface, 'Ethernet');
  assert.deepEqual(merged.network.primaryIpv4, ['10.0.0.2']);
  // The fast byte counters are never replaced by the detail document.
  assert.deepEqual(merged.network.counters, { read: 1, write: 2 });
  assert.equal(merged.thermal.gpuCelsius, 55);
  assert.deepEqual(merged.thermal.sources, ['nvidia-smi']);
  assert.equal(merged.processes.top[0].user, 'DOMAIN' + String.fromCharCode(92) + 'user');
});

test('mergeMetricsRaw keeps fresh fast values and tolerates a missing detail', () => {
  const fast = {
    cpu: { name: 'FAST', physicalCores: 2, logicalCores: 2 },
    battery: { present: true, percent: 50 },
    network: { counters: { read: 0, write: 0 }, defaultInterface: 'Fast', primaryIpv4: ['1.1.1.1'], wifi: null },
    thermal: { cpuCelsius: 40, gpuCelsius: 60, fans: [], sources: ['wmi-thermal-zone'], note: null },
    processes: { total: 1, top: [{ pid: 1, name: 'a', cpuPercent: 0, workingSetBytes: 0, user: 'me' }] },
  };
  const merged = win.mergeMetricsRaw(fast, {
    cpu: { name: 'SLOW', physicalCores: 8, logicalCores: 16 },
    battery: { present: true, percent: 10 },
    network: { defaultInterface: 'Slow', primaryIpv4: ['2.2.2.2'] },
    thermal: { gpuCelsius: 99, fans: [{ name: 'GPU', rpm: 1 }], sources: ['nvidia-smi'] },
    owners: { 1: 'other' },
  });
  assert.equal(merged.cpu.name, 'FAST');
  assert.equal(merged.battery.percent, 50);
  assert.equal(merged.network.defaultInterface, 'Fast');
  assert.deepEqual(merged.network.primaryIpv4, ['1.1.1.1']);
  assert.equal(merged.thermal.gpuCelsius, 60);
  assert.equal(merged.processes.top[0].user, 'me');
  assert.equal(win.mergeMetricsRaw(fast, null), fast);
});
