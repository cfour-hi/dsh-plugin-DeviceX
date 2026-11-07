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
