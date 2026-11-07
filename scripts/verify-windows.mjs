#!/usr/bin/env node
/**
 * Device X — offline Windows adaptation verification.
 *
 * Runs on any host (this repo was developed on macOS with no PowerShell): it
 * never spawns PowerShell and never needs Windows. It checks:
 *   1. the frozen Windows public surface (exports, manifest platform + files),
 *   2. the PowerShell bridge's pure helpers (encoding, quoting, BOM trim),
 *   3. the shipped PowerShell scripts exist and follow the bridge conventions,
 *   4. every `scripts/fixtures/win32/*.json` fixture through the collector's
 *      exported `__test.mapX` pure mappers, asserting the docs/build-contract.md
 *      shapes, JSON-safety, and failure tolerance,
 *   5. the Windows action catalog/guards (no PowerShell execution needed:
 *      invalid input must be rejected in JS before any spawn),
 *   6. the browser half's Windows-aware metadata (winget action copy, uninstall
 *      id plumbing, platform prop).
 *
 * Usage: node scripts/verify-windows.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');
const fixtureDir = join(here, 'fixtures', 'win32');

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
    return typeof text === 'string' && !text.includes('NaN') ? text : null;
  } catch {
    return null;
  }
}
function hasKeys(object, keys) {
  return isPlainObject(object) && keys.every((key) => Object.hasOwn(object, key));
}

// Simulate the Windows Host on any dev machine: the dispatchers read
// `process.platform` at import time, so override it before importing them.
const REAL_PLATFORM = process.platform;
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true, enumerable: true });

const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const win = await import(pathToFileURL(join(pluginDir, 'host/win.js')));
const collector = await import(pathToFileURL(join(pluginDir, 'host/collector-win32.js')));
const actions = await import(pathToFileURL(join(pluginDir, 'host/actions-win32.js')));

// ---------------------------------------------------------------------------
section('1. Package and module surface');
check('bundle declares darwin + win32 platforms', JSON.stringify(manifest.dsh?.bundle?.platforms) === JSON.stringify(['darwin', 'win32']));
check('packaging ships host/win/*.ps1', Array.isArray(manifest.files) && manifest.files.includes('host/win/*.ps1'));
check('collector reports the win32 platform', collector.PLATFORM === 'win32');
check('collector exposes the frozen six sections', JSON.stringify(collector.SECTIONS) === JSON.stringify(['hardware', 'system', 'software', 'network', 'security', 'processes']));
for (const name of ['warmup', 'collectMetrics', 'collectSection', 'collectInventory', 'clearCache']) {
  check(`collector exports ${name}()`, typeof collector[name] === 'function');
}
check('collector exposes __test mappers', isPlainObject(collector.__test));
for (const mapper of ['mapMetrics', 'mapHardware', 'mapSystem', 'mapSoftware', 'mapNetwork', 'mapSecurity', 'mapProcesses']) {
  check(`__test.${mapper} is a function`, typeof collector.__test?.[mapper] === 'function');
}
check('actions expose the frozen five groups', JSON.stringify(actions.GROUPS) === JSON.stringify(['process', 'app', 'system', 'network', 'software', 'power']));
for (const name of ['actionCatalog', 'actionHistory', 'runAction']) {
  check(`actions export ${name}()`, typeof actions[name] === 'function');
}

// ---------------------------------------------------------------------------
section('2. PowerShell bridge pure helpers');
const argv = win.__test.commandArguments();
check(
  'bridge streams scripts over stdin (-Command -), never argv',
  argv.includes('-Command') && argv[argv.length - 1] === '-' && !argv.some((arg) => arg.startsWith('-EncodedCommand')) && argv.includes('-NoProfile') && argv.includes('Bypass'),
);
// Windows caps a command line at 32,767 chars; the bridge must stay tiny there.
check('bridge argv stays far below the Windows 32,767-character limit', argv.join(' ').length < 200);
check(
  'win.js has no -EncodedCommand path left',
  !readFileSync(join(pluginDir, 'host/win.js'), 'utf8').includes('EncodedCommand'),
);
const procHelper = await import(pathToFileURL(join(pluginDir, 'host/proc.js')));
const stdinEcho = await procHelper.run(
  process.execPath,
  ['-e', 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>process.stdout.write(s));'],
  { input: 'streamed-over-stdin', timeout: 15_000 },
);
check('proc.run streams options.input to the child stdin', stdinEcho.ok === true && stdinEcho.stdout === 'streamed-over-stdin');
check('psString quotes and doubles single quotes', win.__test.psString("it's") === "'it''s'" && win.__test.psString('a') === "'a'");
check('trimOutput strips a UTF-8 BOM and whitespace', win.__test.trimOutput('\uFEFF {"a":1} \n') === '{"a":1}');
check('the UTF-8 console prefix is applied to every script', win.__test.OUTPUT_PREFIX.includes('OutputEncoding'));
const noPowerShell = await win.runPSJson('Get-Date');
check(
  'runPSJson on a host without PowerShell fails cleanly (never throws)',
  noPowerShell.ok === false && typeof noPowerShell.error === 'string',
);

// ---------------------------------------------------------------------------
section('3. Bundled PowerShell scripts');
const scriptDir = join(pluginDir, 'host', 'win');
const expectedScripts = ['metrics.ps1', 'hardware.ps1', 'system.ps1', 'software.ps1', 'network.ps1', 'security.ps1', 'processes.ps1'];
for (const script of expectedScripts) {
  const path = join(scriptDir, script);
  const exists = existsSync(path);
  check(`host/win/${script} exists`, exists);
  if (!exists) continue;
  const text = readFileSync(path, 'utf8');
  check(
    `host/win/${script} ends with one compressed ConvertTo-Json`,
    /ConvertTo-Json\b[^\n]*-Depth\b[^\n]*-Compress/.test(text),
  );
  check(
    `host/win/${script} sets $ErrorActionPreference = 'Stop'`,
    /\$ErrorActionPreference\s*=\s*'Stop'/.test(text),
  );
  check(`host/win/${script} reads no interpolated user input`, !/\$env:DEVICEX_ARG_[A-Z_]+\s*\}/.test(text));
  check(`host/win/${script} avoids Invoke-Expression`, !/Invoke-Expression|\biex\b/i.test(text));
  check(
    `host/win/${script} is ASCII-only (stdin decodes with the console input code page)`,
    !/[^\x00-\x7F]/.test(text),
  );
}

// ---------------------------------------------------------------------------
section('4. Collector fixtures through the pure mappers');
const fixtureMap = [
  ['metrics.json', 'mapMetrics', null],
  ['hardware.json', 'mapHardware', ['cpu', 'memory', 'gpu', 'displays', 'storage', 'battery', 'usb', 'bluetooth', 'audio', 'cameras', 'errors']],
  ['system.json', 'mapSystem', ['os', 'device', 'boot', 'user', 'users', 'launchAgents', 'loginItems', 'environment', 'locale', 'errors']],
  ['software.json', 'mapSoftware', ['applications', 'totalApplications', 'homebrew', 'errors']],
  ['network.json', 'mapNetwork', ['interfaces', 'wifi', 'defaultRoute', 'dns', 'proxy', 'listeningPorts', 'establishedCount', 'errors']],
  ['security.json', 'mapSecurity', ['fileVault', 'sip', 'gatekeeper', 'firewall', 'tcc', 'users', 'remoteLogin', 'autoLogin', 'errors']],
  ['processes.json', 'mapProcesses', ['total', 'list', 'byUser', 'errors']],
];
const fixtureFiles = existsSync(fixtureDir) ? new Set(readdirSync(fixtureDir)) : new Set();
for (const [file, mapperName, expectedKeys] of fixtureMap) {
  if (!fixtureFiles.has(file)) {
    check(`fixture scripts/fixtures/win32/${file} exists`, false);
    continue;
  }
  const fixture = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const mapped = collector.__test[mapperName](fixture);
  check(`__test.${mapperName} maps ${file} to a JSON-safe object`, jsonSafe(mapped) !== null, file);
  if (expectedKeys !== null) {
    check(`__test.${mapperName}(${file}) has the contract keys`, hasKeys(mapped, expectedKeys));
    check(`__test.${mapperName}(${file}) reports errors[]`, Array.isArray(mapped.errors));
  }
  if (file === 'metrics.json') {
    check(
      'mapped metrics has the contract keys',
      hasKeys(mapped, ['ts', 'hostname', 'osVersion', 'uptimeSec', 'cpu', 'memory', 'disk', 'network', 'battery', 'thermal', 'processes']) &&
        hasKeys(mapped.cpu, ['model', 'usagePercent', 'perCore', 'loadAvg', 'logicalCores', 'physicalCores']) &&
        hasKeys(mapped.memory, ['totalBytes', 'usedBytes', 'appBytes', 'wiredBytes', 'compressedBytes', 'cachedBytes', 'freeBytes', 'swapTotalBytes', 'swapUsedBytes', 'pressure']) &&
        hasKeys(mapped.network, ['rxBytesPerSec', 'txBytesPerSec', 'totalRxBytes', 'totalTxBytes', 'wifi', 'primaryIpv4', 'defaultInterface']),
    );
  }
  // Failure tolerance: empty input still yields the documented shape with errors[].
  const empty = collector.__test[mapperName]({});
  check(`__test.${mapperName}({}) stays JSON-safe`, jsonSafe(empty) !== null);
  if (expectedKeys !== null) {
    check(`__test.${mapperName}({}) keeps the contract keys`, hasKeys(empty, expectedKeys));
    check(`__test.${mapperName}({}) records an error`, Array.isArray(empty.errors) && empty.errors.length > 0);
  }
}

// ---------------------------------------------------------------------------
section('5. Windows action catalog and guards');
const catalog = actions.actionCatalog();
const expectedIds = [
  'process.signal',
  'app.quit',
  'app.launch',
  'app.reveal',
  'app.uninstall',
  'system.setHostname',
  'system.setVolume',
  'system.setDarkMode',
  'system.launchAgent',
  'system.openSettings',
  'system.toggleFirewall',
  'system.flushDNS',
  'system.emptyTrash',
  'network.setWifiPower',
  'network.setDns',
  'power.sleep',
  'power.lock',
  'software.wingetUninstall',
];
check('catalog has the frozen 18 Windows actions', JSON.stringify(catalog.map((entry) => entry.id)) === JSON.stringify(expectedIds));
check('catalog actions carry the frozen fields', catalog.every((entry) => typeof entry.group === 'string' && ['low', 'medium', 'high'].includes(entry.danger) && Array.isArray(entry.params)));
for (const id of ['system.setHostname', 'system.toggleFirewall', 'network.setWifiPower', 'network.setDns']) {
  check(`${id} is marked requiresAdmin`, catalog.find((entry) => entry.id === id)?.requiresAdmin === true);
}
const unknown = await actions.runAction('definitely-not-an-action', {});
check('unknown action returns UNKNOWN_ACTION', unknown.ok === false && unknown.code === 'UNKNOWN_ACTION');
const badPid = await actions.runAction('process.signal', { pid: 1 });
check('pid 1 cannot be signalled', badPid.ok === false);
const badSignal = await actions.runAction('process.signal', { pid: process.pid, signal: 'KILL' });
check("the Host's own pid cannot be signalled", badSignal.ok === false);
const badUninstall = await actions.runAction('app.uninstall', { id: 'not-a-valid-target' });
check('app.uninstall rejects an invalid target', badUninstall.ok === false);
const badHostname = await actions.runAction('system.setHostname', { kind: 'ComputerName', value: 'bad name!' });
check('system.setHostname rejects an invalid host name', badHostname.ok === false);
const badDns = await actions.runAction('network.setDns', { service: 'Ethernet', servers: ['999.1.1.1'] });
check('network.setDns rejects an invalid IP', badDns.ok === false);
const mixedDns = await actions.runAction('network.setDns', { service: 'Ethernet', servers: ['1.1.1.1', '2400:3200::1'] });
check('network.setDns rejects mixed IPv4/IPv6 server families', mixedDns.ok === false && mixedDns.code === 'BAD_PARAMS');
const hklm32 = await actions.runAction('system.launchAgent', { path: 'startup:HKLM32:LegacyApp', enabled: false });
check('system.launchAgent accepts the HKLM32 (WOW6432Node) startup pseudo-path', hklm32.ok === false && hklm32.code !== 'BAD_PARAMS');
const actionsSource = readFileSync(join(pluginDir, 'host/actions-win32.js'), 'utf8');
check(
  'Windows settings panes map to canonical ms-settings URIs',
  actionsSource.includes('network-wifi') && actionsSource.includes('appsfeatures'),
);
const badPane = await actions.runAction('system.openSettings', { pane: 'not-a-pane' });
check('system.openSettings rejects an unknown pane', badPane.ok === false);
const paneParam = catalog.find((entry) => entry.id === 'system.openSettings')?.params.find((param) => param.name === 'pane');
check('Windows settings panes include windowsdefender (Windows Security)', paneParam?.options.includes('windowsdefender') === true);
const history = actions.actionHistory();
check('action history is an array with the frozen entry shape', Array.isArray(history) && history.every((entry) => isPlainObject(entry) && typeof entry.id === 'string' && typeof entry.ok === 'boolean'));
const actionsWinSource = readFileSync(join(pluginDir, 'host', 'actions-win32.js'), 'utf8');
check('actions source is ASCII-only (stdin decode constraint)', !/[^\x00-\x7F]/.test(actionsWinSource));
check(
  'power sleep/lock report success through the JSON contract, not exit codes',
  /'power\.sleep':[\s\S]{0,700}?runPSJson\(/.test(actionsWinSource) && /'power\.lock':[\s\S]{0,700}?runPSJson\(/.test(actionsWinSource),
);
check('emptyTrash probes an already-empty bin locale-independently', actionsWinSource.includes('Shell.Application'));
check(
  'default-route sorting uses the RouteMetric + InterfaceMetric sum',
  readFileSync(join(pluginDir, 'host', 'win', 'metrics.ps1'), 'utf8').includes('RouteMetric + [long]$_.InterfaceMetric') &&
    readFileSync(join(pluginDir, 'host', 'win', 'network.ps1'), 'utf8').includes('RouteMetric + [long]$_.InterfaceMetric'),
);

// ---------------------------------------------------------------------------
section('6. Browser half Windows metadata');
const client = readFileSync(join(pluginDir, 'client.js'), 'utf8');
check('client copy covers software.wingetUninstall', client.includes('action.software.wingetUninstall') && client.includes('software.wingetUninstall'));
check('client renders a winget card on Windows', client.includes('sw.winget') && client.includes('sw.wingetHint'));
check('client passes the app uninstall id through', client.includes('uninstallId') && client.includes('id: uninstallId'));
check('client receives the platform for tab-specific copy', client.includes('platform: catalog.platform'));
check('client kill dialog derives signals from the catalogue', client.includes('killSignals.map'));
check('client uses Explorer wording for reveal on Windows', client.includes('sw.revealWin'));
check(
  'client shows Windows security card titles',
  client.includes('sec.bitlocker') && client.includes('sec.secureBoot') && client.includes('sec.defender'),
);
check('client explains Windows privacy DB absence', client.includes('sec.tccUnreadableWin'));
check('client labels Windows startup items', client.includes('sys.startupItems'));
check('client opens Windows Security for the firewall pane', client.includes('sec.openSecurityWin') && client.includes('windowsdefender'));

// ---------------------------------------------------------------------------
section('7. Simulated Windows Host end to end (dispatchers + routes + tools)');
// Load the fixture-backed PowerShell runner, then prime the dispatchers'
// selected implementation with it (the modules share one instance).
const fixtureRunner = async (scriptName) => {
  const file = join(fixtureDir, String(scriptName).replace(/\.ps1$/, '.json'));
  if (!existsSync(file)) return { ok: false, error: `no fixture for ${scriptName}` };
  return { ok: true, data: JSON.parse(readFileSync(file, 'utf8')) };
};
collector.__test.reset();
collector.__test.setRunner(fixtureRunner);

const collectorDispatch = await import(pathToFileURL(join(pluginDir, 'host/collector.js')));
const actionsDispatch = await import(pathToFileURL(join(pluginDir, 'host/actions.js')));
check('dispatcher reports win32 via process.platform', collectorDispatch.PLATFORM === 'win32');
const winMetrics = await collectorDispatch.collectMetrics();
check('dispatched metrics come from the Windows implementation', winMetrics.hostname === 'DESKTOP-8F3K2Q1' && String(winMetrics.osVersion).includes('Windows'));
const winHardware = await collectorDispatch.collectSection('hardware');
check('dispatched hardware section maps the fixture', hasKeys(winHardware, ['cpu', 'memory', 'gpu', 'displays', 'storage', 'battery', 'usb', 'bluetooth', 'audio', 'cameras', 'errors']));
check('dispatched action catalog is the Windows 18', actionsDispatch.actionCatalog().length === 18);
check('dispatched unknown action fails cleanly', (await actionsDispatch.runAction('nope', {})).ok === false);

const plugin = await import(pathToFileURL(join(pluginDir, 'index.js')));
const routes = [];
const tools = [];
const effects = [];
const fakeCtx = {
  effect(callback, label) {
    const dispose = callback();
    effects.push({ label, dispose });
    return dispose;
  },
  webServer: { register(route) { routes.push(route); return () => { route.disposed = true; }; } },
  tools: { register(definition) { tools.push(definition); return () => { definition.disposed = true; }; } },
  connection: { requestRejection(req) { return req.headers['x-test-reject'] === '1' ? 403 : undefined; } },
};
plugin.apply(fakeCtx);
check('simulated win32 Host registers four routes + two tools', routes.length === 4 && tools.length === 2);
check('simulated device_control enum is the Windows catalog', tools[1].parameters.properties.action.enum.length === 18);
check('simulated device_control exposes winget uninstall', tools[1].parameters.properties.action.enum.includes('software.wingetUninstall'));

function makeReq(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
  return {
    method,
    url,
    headers: { host: '127.0.0.1:50732', ...headers },
    [Symbol.asyncIterator]() {
      let index = 0;
      return { next: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }) };
    },
    resume() {},
  };
}
function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    destroyed: false,
    setHeader(key, value) { res.headers[key.toLowerCase()] = value; },
    end(chunk) { res.headersSent = true; res.body = chunk === undefined ? '' : String(chunk); },
    destroy() { res.destroyed = true; },
  };
  return res;
}
async function call(method, path, body, headers) {
  const pathname = path.split('?', 1)[0];
  const handler = routes.find((route) => route.path === pathname).handler;
  const res = makeRes();
  await handler(makeReq(method, path, body, headers), res);
  let json;
  try { json = JSON.parse(res.body); } catch { json = undefined; }
  return { status: res.statusCode, json };
}
let sim = await call('GET', '/devicex/api/metrics');
check('win32 metrics route returns fixture-derived data', sim.status === 200 && sim.json.metrics.hostname === 'DESKTOP-8F3K2Q1');
sim = await call('GET', '/devicex/api/inventory?section=software');
check('win32 software route returns Windows apps + winget', sim.status === 200 && Array.isArray(sim.json.data.applications) && isPlainObject(sim.json.data.winget));
sim = await call('GET', '/devicex/api/actions');
check('win32 actions route reports the win32 platform', sim.status === 200 && sim.json.platform === 'win32' && sim.json.actions.length === 18);
const simOverview = await tools[0].execute({}, {});
check('win32 device_info overview summarises fixture metrics', typeof simOverview.summary === 'string' && simOverview.summary.includes('DESKTOP-8F3K2Q1'));
check('win32 device_info overview exposes available actions', Array.isArray(simOverview.data.availableActions) && simOverview.data.availableActions.includes('software.wingetUninstall'));
for (const entry of effects) {
  if (typeof entry.dispose === 'function') entry.dispose();
  else if (Array.isArray(entry.dispose)) for (const dispose of entry.dispose) if (typeof dispose === 'function') dispose();
}
collector.__test.resetRunner();
Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true, enumerable: true });

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'ALL WINDOWS CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} — ${passed} checks`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
