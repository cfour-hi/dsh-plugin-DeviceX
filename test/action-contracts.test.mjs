import { test } from 'node:test';
import assert from 'node:assert/strict';

const darwin = await import('../plugin/host/actions-darwin.js');
const win32 = await import('../plugin/host/actions-win32.js');

const SAFE_IDS = ['process.signal', 'app.uninstall', 'system.setHostname', 'network.setDns', 'cleanup.delete'];

/* ------------------------------------------------------------- catalogues */

test('both platform catalogues expose 19 unique, well-formed actions', () => {
  for (const [platform, module] of [['darwin', darwin], ['win32', win32]]) {
    const catalog = module.actionCatalog();
    assert.equal(catalog.length, 19, `${platform} catalogue size`);
    assert.equal(new Set(catalog.map((action) => action.id)).size, 19, `${platform} ids are unique`);
    for (const action of catalog) {
      assert.equal(typeof action.id, 'string');
      assert.ok(['low', 'medium', 'high'].includes(action.danger), `${action.id} danger`);
      assert.equal(typeof action.requiresAdmin, 'boolean');
      assert.ok(Array.isArray(action.params));
      for (const param of action.params) {
        assert.equal(typeof param.name, 'string');
        assert.ok(['number', 'string', 'boolean', 'select'].includes(param.type));
        assert.equal(typeof param.required, 'boolean');
      }
    }
    for (const id of SAFE_IDS) assert.ok(catalog.some((action) => action.id === id), `${platform} has ${id}`);
  }
  assert.ok(darwin.actionCatalog().some((action) => action.id === 'software.brewUninstall'));
  assert.ok(win32.actionCatalog().some((action) => action.id === 'software.wingetUninstall'));
  assert.ok(!win32.actionCatalog().some((action) => action.id === 'software.brewUninstall'));
});

/* --------------------------------------------------- darwin: cleanup ids */

test('darwin cleanup.delete reads arrays and comma strings, refuses bad ids', () => {
  const read = darwin.__test.readCleanupIds;
  const ok = read({ ids: ['user-caches', 'user-logs'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, ['user-caches', 'user-logs']);
  assert.deepEqual(read({ ids: 'user-caches, user-logs' }).value, ['user-caches', 'user-logs']);
  assert.equal(read({ ids: '' }).ok, false);
  assert.equal(read({ ids: [] }).ok, false);
  assert.equal(read({ ids: ['user-caches', 'user-caches'] }).ok, false);
  assert.equal(read({ ids: ['../../etc/passwd'] }).ok, false);
  assert.equal(read({ ids: Array.from({ length: 21 }, () => 'user-caches') }).ok, false);
  assert.equal(read({ ids: [42] }).ok, false);
});

/* ---------------------------------------------- win32: validator coverage */

const validators = win32.__test.validators;
const expectOk = (id, params) => assert.equal(validators[id](params), null, `${id} should accept ${JSON.stringify(params)}`);
const expectBad = (id, params) => assert.ok(validators[id](params) !== null, `${id} should reject ${JSON.stringify(params)}`);

test('win32 process.signal rejects protected/invalid pids', () => {
  expectBad('process.signal', { pid: 1 });
  expectBad('process.signal', { pid: 0 });
  expectBad('process.signal', { pid: -5 });
  // Windows pids are 32-bit unsigned: the upper bound is 4_294_967_295.
  expectBad('process.signal', { pid: 4_294_967_296 });
  expectBad('process.signal', { pid: process.pid });
  expectOk('process.signal', { pid: 4242, signal: 'TERM' });
});

test('win32 app.uninstall validates the id grammar (msi/winget/registry)', () => {
  expectOk('app.uninstall', { id: 'msi:{12345678-1234-1234-1234-123456789012}' });
  expectOk('app.uninstall', { id: 'winget:7zip.7zip' });
  expectOk('app.uninstall', { id: 'HKLM:Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip' });
  expectBad('app.uninstall', { id: 'not-a-target' });
  expectBad('app.uninstall', { id: 'winget:' });
  expectBad('app.uninstall', { id: 'msi:not-a-guid' });
  expectBad('app.uninstall', { id: 'C:\\Windows\\System32\\cmd.exe' });
});

test('win32 network.setDns validates IPv4/IPv6 and the 0–4 server cap', () => {
  expectOk('network.setDns', { service: 'Ethernet', servers: ['1.1.1.1', '8.8.8.8'] });
  expectOk('network.setDns', { service: 'Ethernet', servers: [] });
  expectOk('network.setDns', { service: 'Ethernet', servers: ['2400:3200::1'] });
  expectBad('network.setDns', { service: 'Ethernet', servers: ['999.1.1.1'] });
  expectBad('network.setDns', { service: '', servers: ['1.1.1.1'] });
  expectBad('network.setDns', { service: 'Ethernet', servers: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'] });
  // Mixing families is refused (Windows Set-DnsClientServerAddress limitation).
  expectBad('network.setDns', { service: 'Ethernet', servers: ['1.1.1.1', '2400:3200::1'] });
});

test('win32 system.setHostname validates the computer-name grammar', () => {
  expectOk('system.setHostname', { kind: 'ComputerName', value: 'DESKTOP-8F3K2Q1' });
  expectBad('system.setHostname', { kind: 'ComputerName', value: 'bad name!' });
  expectBad('system.setHostname', { kind: 'Nope', value: 'valid-name' });
});

test('win32 cleanup.delete shares the frozen allowlist and batch cap', () => {
  const ids = ['user-temp', 'crash-dumps'];
  const validate = win32.__test.validate['cleanup.delete'];
  assert.equal(validate({ ids }).ok, true);
  assert.equal(validate({ ids: 'user-temp, crash-dumps' }).ok, true);
  assert.equal(validate({ ids: ['../../etc/passwd'] }).ok, false);
  assert.equal(validate({ ids: [] }).ok, false);
  assert.equal(validate({ ids: 'user-temp,user-temp' }).ok, false);
  assert.equal(validate({ ids: Array.from({ length: 21 }, () => 'user-temp') }).ok, false);
  assert.equal(validate({ ids }).code, undefined);
  assert.equal(validate({ ids: ['nope'] }).code, 'BAD_PARAMS');
});

test('win32 guards parse startup/DNS/cleanup inputs defensively', () => {
  const guards = win32.__test.guards;
  const agent = guards.parseLaunchAgentPath({ path: 'startup:HKCU:OneDrive' });
  assert.equal(agent.ok, true);
  assert.deepEqual(agent.value, { hive: 'HKCU', name: 'OneDrive', path: 'startup:HKCU:OneDrive' });
  assert.equal(guards.parseLaunchAgentPath({ path: 'startup:HKLM32:LegacyApp' }).ok, true);
  assert.equal(guards.parseLaunchAgentPath({ path: 'C:\\evil.exe' }).ok, false);
  assert.equal(guards.readDnsServers({ servers: ['1.1.1.1', '8.8.8.8'] }).ok, true);
  assert.equal(guards.readDnsServers({ servers: ['999.1.1.1'] }).ok, false);
  assert.equal(guards.readCleanupIds({ ids: ['user-temp'] }).ok, true);
  assert.equal(guards.readCleanupIds({ ids: ['user-temp', 'user-temp'] }).ok, false);
  const registry = guards.parseUninstallId({ id: 'HKLM:Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip' });
  assert.equal(registry.ok, true);
  assert.equal(registry.value.kind, 'registry');
});
