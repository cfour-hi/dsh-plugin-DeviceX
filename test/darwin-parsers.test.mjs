import { test } from 'node:test';
import assert from 'node:assert/strict';

const { __test: p } = await import('../plugin/host/collector-darwin.js');

/* ------------------------------------------------------------------ vm_stat */

test('parseVmStat reads page size and every page counter', () => {
  const text = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                              123456.',
    'Pages active:                            234567.',
    'Pages inactive:                          345678.',
    'Pages speculative:                         4567.',
    'Pages wired down:                         56789.',
    'Pages purgeable:                           1234.',
    'File-backed pages:                       123456.',
    'Anonymous pages:                         234567.',
    'Pages occupied by compressor:             12345.',
  ].join('\n');
  const vm = p.parseVmStat(text);
  assert.equal(vm.pageSize, 16384);
  assert.equal(vm.free, 123456);
  assert.equal(vm.active, 234567);
  assert.equal(vm.inactive, 345678);
  assert.equal(vm.speculative, 4567);
  assert.equal(vm.wired, 56789);
  assert.equal(vm.purgeable, 1234);
  assert.equal(vm.fileBacked, 123456);
  assert.equal(vm.anonymous, 234567);
  assert.equal(vm.compressed, 12345);
});

test('parseVmStat keeps safe defaults for empty/garbage output', () => {
  const vm = p.parseVmStat('');
  assert.equal(vm.pageSize, 4096);
  assert.equal(vm.free, 0);
  assert.equal(vm.active, 0);
  for (const key of Object.keys(vm)) {
    if (key === 'pageSize') continue;
    assert.equal(vm[key], 0);
  }
});

/* --------------------------------------------------------------------- swap */

test('parseSwap converts M/G suffixes to bytes', () => {
  assert.deepEqual(p.parseSwap('total = 12288.00M  used = 2048.00M  free = 10240.00M  (encrypted)'), {
    total: 12_884_901_888,
    used: 2_147_483_648,
  });
  assert.deepEqual(p.parseSwap('total = 1.00G  used = 0.50G'), { total: 1_073_741_824, used: 536_870_912 });
});

test('parseSwap is zero-safe for missing values', () => {
  assert.deepEqual(p.parseSwap(''), { total: 0, used: 0 });
});

/* ------------------------------------------------------------------- pmset */

const PMSET_BATTERY = [
  "Now drawing from 'Battery Power'",
  ' -InternalBattery-0 (id=4653155)\t87%; discharging; 4:10 remaining present: true',
].join('\n');
const PMSET_AC = [
  "Now drawing from 'AC Power'",
  ' -InternalBattery-0 (id=6684771)\t100%; charged; 0:00 remaining present: true',
].join('\n');

test('parsePmsetBattery handles the leading-space InternalBattery line', () => {
  const battery = p.parsePmsetBattery(PMSET_BATTERY);
  assert.equal(battery.present, true);
  assert.equal(battery.percent, 87);
  assert.equal(battery.charging, false);
  assert.equal(battery.plugged, false);
  assert.equal(battery.powerSource, 'Battery Power');
  assert.equal(battery.batteryState, 'discharging');
  assert.equal(battery.timeRemainingMin, 250);
});

test('parsePmsetBattery treats AC + charged as plugged, no countdown', () => {
  const battery = p.parsePmsetBattery(PMSET_AC);
  assert.equal(battery.present, true);
  assert.equal(battery.percent, 100);
  assert.equal(battery.plugged, true);
  assert.equal(battery.powerSource, 'AC Power');
  assert.equal(battery.batteryState, 'charged');
  assert.equal(battery.charging, false);
  assert.equal(battery.timeRemainingMin, null);
});

test('parsePmsetBattery reports no battery when the line is absent', () => {
  const battery = p.parsePmsetBattery("Now drawing from 'AC Power'");
  assert.equal(battery.present, false);
  assert.equal(battery.percent, null);
  assert.equal(battery.powerSource, 'AC Power');
});

/* ------------------------------------------------------------------- ioreg */

const IOREG_BATTERY = [
  '+-o AppleSmartBattery  <class AppleSmartBattery>',
  '  {',
  '    "BatteryInstalled" = Yes',
  '    "CurrentCapacity" = 80',
  '    "MaxCapacity" = 100',
  '    "AppleRawMaxCapacity" = 8091',
  '    "DesignCapacity" = 8694',
  '    "Temperature" = 3000',
  '    "CycleCount" = 564',
  '    "IsCharging" = No',
  '    "ExternalConnected" = Yes',
  '    "TimeRemaining" = 0',
  '    "BatteryData" = {"Temperature"=1234,"CycleCount"=99}',
  '  }',
].join('\n');

test('parseIoregBattery reads top-level keys, not nested BatteryData', () => {
  const battery = p.parseIoregBattery(IOREG_BATTERY);
  assert.equal(battery.present, true);
  assert.equal(battery.currentCapacity, 80);
  assert.equal(battery.rawMaxCapacity, 8091);
  assert.equal(battery.designCapacity, 8694);
  assert.equal(battery.temperatureC, 30);
  assert.equal(battery.cycleCount, 564);
  assert.equal(battery.charging, false);
  assert.equal(battery.external, true);
  assert.equal(battery.timeRemaining, 0);
  assert.equal(p.batteryHealth(battery), 93);
});

test('parseIoregBattery reports absent battery and null densities', () => {
  const battery = p.parseIoregBattery('');
  assert.equal(battery.present, false);
  assert.equal(battery.temperatureC, null);
  assert.equal(p.batteryHealth(battery), null);
});

test('batteryHealth clamps the computed percentage', () => {
  assert.equal(p.batteryHealth({ rawMaxCapacity: 12000, designCapacity: 10000 }), 100);
  assert.equal(p.batteryHealth({ rawMaxCapacity: 0, designCapacity: 0 }), null);
});

/* ------------------------------------------------------- ioreg disk/netstat */

test('parseIoregDisk sums read/write counters across drivers', () => {
  const text = '"Bytes (Read)"=1000 "Bytes (Write)"=2000 "Bytes (Read)"=500 "Bytes (Write)"=700';
  assert.deepEqual(p.parseIoregDisk(text), { read: 1500, write: 2700 });
});

test('parseNetstatBytes skips headers, loopback and short rows', () => {
  const text = [
    'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
    'lo0       16384 <Link#1>                      24962731     0 66342758772 24962731     0 66342758772     0',
    'en0       1500  <Link#4> aa:bb:cc:dd:ee:ff       100     0       1000      200     0       2000     0',
    'en7       1500  <Link#9>                       50     0        500       60     0        600     0',
    'garbage row',
  ].join('\n');
  assert.deepEqual(p.parseNetstatBytes(text), { read: 1500, write: 2600 });
});

/* ----------------------------------------------------------------------- df */

test('parseDf converts 1024-blocks into bytes', () => {
  const text = [
    'Filesystem     1024-blocks      Used Available Capacity  Mounted on',
    '/dev/disk3s1s1   971350180  10328535 800000000    2%   /',
  ].join('\n');
  const result = p.parseDf(text);
  assert.equal(result.totalBytes, 971350180 * 1024);
  assert.equal(result.freeBytes, 800000000 * 1024);
  // df's Used column is not used directly: used = total - available.
  assert.equal(result.usedBytes, (971350180 - 800000000) * 1024);
});

test('parseDf returns null for empty/truncated output', () => {
  assert.equal(p.parseDf(''), null);
  assert.equal(p.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on'), null);
});

/* ----------------------------------------------------------------- ifconfig */

test('parseIfconfig splits interfaces, addresses, MAC and status', () => {
  const text = [
    'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
    '\tether 86:b3:7c:26:69:95',
    '\tinet 192.168.1.87 netmask 0xffffff00 broadcast 192.168.1.255',
    '\tinet6 fe80::1c2d:3e4f:5a6b:7c8d%en0 prefixlen 64 secured scopeid 0xc',
    '\tinet6 ::1',
    '\tstatus: active',
    'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384',
    '\tinet 127.0.0.1 netmask 0xff000000',
    '\tinet6 ::1',
  ].join('\n');
  const interfaces = p.parseIfconfig(text);
  assert.equal(interfaces.length, 2);
  const en0 = interfaces[0];
  assert.equal(en0.name, 'en0');
  assert.equal(en0.up, true);
  assert.equal(en0.mtu, 1500);
  assert.equal(en0.mac, '86:b3:7c:26:69:95');
  assert.deepEqual(en0.ipv4, ['192.168.1.87']);
  assert.deepEqual(en0.ipv6, ['fe80::1c2d:3e4f:5a6b:7c8d']);
  assert.equal(en0.status, 'active');
  assert.equal(interfaces[1].name, 'lo0');
});

test('parseIfconfig ignores malformed interface headers', () => {
  assert.deepEqual(p.parseIfconfig('not an interface\n\tinet 1.2.3.4'), []);
});

/* ------------------------------------------------- hardware ports + types */

test('parseHardwarePorts maps device to port and classifies interfaces', () => {
  const text = [
    'Hardware Port: Wi-Fi',
    'Device: en0',
    '',
    'Hardware Port: Thunderbolt Ethernet',
    'Device: en7',
    '',
    'Hardware Port: USB 10/100/1000 LAN',
    'Device: en9',
  ].join('\n');
  const ports = p.parseHardwarePorts(text);
  assert.equal(ports.get('en0'), 'Wi-Fi');
  assert.equal(ports.get('en7'), 'Thunderbolt Ethernet');
  const wifi = { name: 'en0', up: true, mtu: 1500, mac: null, ipv4: [], ipv6: [] };
  const eth = { name: 'en7', up: true, mtu: 1500, mac: null, ipv4: [], ipv6: [] };
  assert.equal(p.interfaceType(wifi, ports), 'wifi');
  assert.equal(p.interfaceType(eth, ports), 'ethernet');
  assert.equal(p.interfaceType({ name: 'lo0' }, ports), 'loopback');
  assert.equal(p.interfaceType({ name: 'bridge0' }, ports), 'bridge');
  assert.equal(p.interfaceType({ name: 'utun3' }, ports), 'other');
});

/* ---------------------------------------------------------------- routing */

test('parseDefaultRoute extracts gateway and interface', () => {
  const text = [
    '   route to: default',
    'destination: default',
    '    gateway: 172.16.111.1',
    '  interface: en9',
  ].join('\n');
  assert.deepEqual(p.parseDefaultRoute(text), { gateway: '172.16.111.1', interface: 'en9' });
  assert.equal(p.parseDefaultRoute('nothing here'), null);
});

/* ------------------------------------------------------------ dns + proxy */

test('parseDns deduplicates servers and search domains, capped at 8', () => {
  const lines = ['DNS configuration', ''];
  for (let index = 0; index < 10; index += 1) {
    lines.push(`  nameserver[${index}] : 192.168.1.${index}`);
  }
  lines.push('  nameserver[0] : 192.168.1.0', '  search domain[0] : lan', '  search domain[0] : lan', '  search domain[1] : home');
  const dns = p.parseDns(lines.join('\n'));
  assert.equal(dns.servers.length, 8);
  assert.equal(dns.servers[0], '192.168.1.0');
  assert.deepEqual(dns.searchDomains, ['lan', 'home']);
});

test('parseScutilDictionary + parseProxy build the three proxy slots', () => {
  const config = p.parseScutilDictionary(
    [
      '<dictionary> {',
      '  HTTPEnable : 1',
      '  HTTPPort : 8080',
      '  HTTPProxy : proxy.local',
      '  HTTPSEnable : 0',
      '  HTTPSProxy : proxy.local',
      '  SOCKSEnable : 1',
      '  SOCKSPort : 1080',
      '  SOCKSProxy : socks.local',
      '}',
    ].join('\n'),
  );
  assert.equal(config.HTTPEnable, 1);
  assert.equal(config.HTTPPort, 8080);
  assert.equal(config.HTTPProxy, 'proxy.local');
  assert.deepEqual(p.parseProxy(config), { http: 'proxy.local:8080', https: null, socks: 'socks.local:1080' });
});

test('parseProxy returns nulls when every slot is disabled', () => {
  assert.deepEqual(p.parseProxy({ HTTPEnable: 0, HTTPSEnable: 0, SOCKSEnable: 0 }), { http: null, https: null, socks: null });
});

/* --------------------------------------------------------- lsof + ps + etime */

test('parseLsofListeners decodes escaped names and handles IPv6 brackets', () => {
  const text = [
    'COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'node      1234 qaxc84   23u  IPv4 0x1234567890      0t0  TCP 127.0.0.1:50732 (LISTEN)',
    'DeepSeek\\x20Harness  999 qaxc84   10u  IPv6 0x1234      0t0  TCP [::1]:8080 (LISTEN)',
    'bad row',
  ].join('\n');
  const rows = p.parseLsofListeners(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { proto: 'tcp', address: '127.0.0.1', port: 50732, pid: 1234, process: 'node' });
  assert.equal(rows[1].process, 'DeepSeek Harness');
  assert.equal(rows[1].address, '::1');
  assert.equal(rows[1].port, 8080);
});

test('parsePs maps rss to bytes and parses elapsed time', () => {
  const text = [
    '  123 1 qaxc84 14.2 2.8 204800 S 08-07:05:32 /usr/sbin/WindowServer -daemon',
    '  456 1 root 0.1 0.5 1024 R 00:03 /usr/libexec/foo bar',
  ].join('\n');
  const rows = p.parsePs(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pid, 123);
  assert.equal(rows[0].ppid, 1);
  assert.equal(rows[0].cpu, 14.2);
  assert.equal(rows[0].memPercent, 2.8);
  assert.equal(rows[0].rssBytes, 204800 * 1024);
  assert.equal(rows[0].state, 'S');
  assert.equal(rows[0].elapsed, 8 * 86400 + 7 * 3600 + 5 * 60 + 32);
  assert.equal(rows[0].command, '/usr/sbin/WindowServer -daemon');
  assert.equal(rows[1].elapsed, 3);
});

test('parseElapsed understands day/hour/minute/second forms', () => {
  assert.equal(p.parseElapsed('08-07:05:32'), 8 * 86400 + 7 * 3600 + 5 * 60 + 32);
  assert.equal(p.parseElapsed('16:01'), 16 * 60 + 1);
  assert.equal(p.parseElapsed('02:03'), 2 * 60 + 3);
  assert.equal(p.parseElapsed('45'), 45);
  assert.equal(p.parseElapsed('bogus'), null);
  assert.equal(p.parseElapsed(''), null);
});

/* --------------------------------------------------------------- launchd */

test('parseLaunchctlList reads pid/status/label and skips the header', () => {
  const text = [
    'PID\tStatus\tLabel',
    '-\t0\tcom.apple.SafariHistoryServiceAgent',
    '-\t-9\tcom.apple.progressd',
    '1234\t0\tcom.example.agent',
  ].join('\n');
  const map = p.parseLaunchctlList(text);
  assert.deepEqual(map.get('com.apple.SafariHistoryServiceAgent'), { pid: null, status: 0 });
  assert.deepEqual(map.get('com.apple.progressd'), { pid: null, status: -9 });
  assert.deepEqual(map.get('com.example.agent'), { pid: 1234, status: 0 });
  assert.equal(map.get('PID'), undefined);
});

test('parseXmlPlist extracts label, program, arguments and disabled flag', () => {
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.agent</string>
  <key>Program</key><string>/usr/local/bin/agent &amp; helper</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>echo &lt;ok&gt;</string></array>
  <key>Disabled</key><true/>
</dict></plist>`;
  const parsed = p.parseXmlPlist(text);
  assert.equal(parsed.Label, 'com.example.agent');
  assert.equal(parsed.Program, '/usr/local/bin/agent & helper');
  assert.deepEqual(parsed.ProgramArguments, ['/bin/sh', '-c', 'echo <ok>']);
  assert.equal(parsed.Disabled, true);
  assert.equal(p.parseXmlPlist('no plist here').Label, null);
});

/* ---------------------------------------------------------------- airport */

test('parseAirportWifi reads the current network block', () => {
  const sp = {
    SPAirPortDataType: [
      {
        spairport_airport_interfaces: [
          { spairport_current_network_information: null },
          {
            spairport_current_network_information: {
              _name: 'MyWiFi',
              spairport_network_bssid: 'aa:bb:cc:dd:ee:ff',
              spairport_network_rssi: -52,
              spairport_network_noise: -90,
              spairport_network_channel: '36 (5GHz, 80MHz)',
              spairport_security_mode: 'spairport_security_mode_wpa3_personal',
              spairport_network_rate: 1200,
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(p.parseAirportWifi(sp), {
    ssid: 'MyWiFi',
    bssid: 'aa:bb:cc:dd:ee:ff',
    rssi: -52,
    noise: -90,
    channel: 36,
    security: 'spairport_security_mode_wpa3_personal',
    txRateMbps: 1200,
  });
  assert.equal(p.parseAirportWifi({}), null);
});

/* -------------------------------------------------------------------- mdls */

test('mergeMdlsBatch attaches attributes to the matching paths in order', () => {
  const stdout = [
    'kMDItemCFBundleIdentifier = "com.apple.Safari"',
    'kMDItemFSSize = 123456',
    'kMDItemLastUsedDate = "2026-10-16 10:17:05 +0000"',
    '',
    'kMDItemCFBundleIdentifier = (null)',
    'kMDItemFSSize = (null)',
  ].join('\n');
  const target = new Map();
  p.mergeMdlsBatch(stdout, ['/Applications/Safari.app', '/Applications/Broken.app'], target);
  const safari = target.get('/Applications/Safari.app');
  assert.equal(safari.bundleId, 'com.apple.Safari');
  assert.equal(safari.sizeBytes, 123456);
  assert.equal(safari.lastUsed, Date.parse('2026-10-16T10:17:05+00:00'));
  assert.deepEqual(target.get('/Applications/Broken.app'), { bundleId: null, sizeBytes: null, lastUsed: null });
});

test('parseMdlsDate handles the Spotlight format and fallbacks', () => {
  assert.equal(p.parseMdlsDate('2026-10-16 10:17:05 +0000'), Date.parse('2026-10-16T10:17:05+00:00'));
  assert.equal(p.parseMdlsDate('2026-10-16T10:17:05Z'), Date.parse('2026-10-16T10:17:05Z'));
  assert.equal(p.parseMdlsDate('not a date'), null);
});

test('mapArchitecture maps every known profiler kind', () => {
  assert.equal(p.mapArchitecture('arch_arm_i64'), 'universal');
  assert.equal(p.mapArchitecture('arch_arm'), 'arm64');
  assert.equal(p.mapArchitecture('arch_i64'), 'x86_64');
  assert.equal(p.mapArchitecture('arch_ios'), 'ios');
  assert.equal(p.mapArchitecture('arch_other'), 'other');
  assert.equal(p.mapArchitecture('something-else'), 'something-else');
  assert.equal(p.mapArchitecture(null), null);
});

/* ---------------------------------------------------------------- drivers */

test('parseDarwinDrivers sorts third-party first, caps at 250 and reports truncation', () => {
  const entries = [
    { _name: 'AppleAPFS', spext_bundleid: 'com.apple.filesystems.apfs', spext_signed_by: 'Apple Inc.', spext_version: '2333', spext_lastModified: '2024-11-01T09:00:00Z', spext_loaded: 'spext_yes', spext_path: '/System/Library/Extensions/AppleAPFS.kext' },
    { _name: 'Elgato Virtual HID', spext_bundleid: 'com.elgato.virtualhid', spext_signed_by: 'Subject: Developer ID Application: Elgato Systems GmbH (ABC123)', spext_version: '1.4.2', spext_lastModified: '2025-02-11T09:00:00Z', spext_path: '/Library/SystemExtensions/com.elgato.virtualhid.dext', spext_loaded: 'spext_no' },
    { _name: 'Unknown Vendor Driver', spext_bundleid: 'com.example.unknown', spext_signed_by: '', spext_version: '0.1', spext_path: '/Library/Extensions/Unknown.kext' },
  ];
  const { drivers, truncated } = p.parseDarwinDrivers(entries);
  assert.equal(drivers.length, 3);
  assert.equal(truncated, false);
  const elgato = drivers.find((driver) => driver.name === 'Elgato Virtual HID');
  assert.equal(elgato.manufacturer, 'Elgato Systems GmbH');
  assert.equal(elgato.date, '2025-02-11');
  assert.equal(elgato.kind, 'driverkit');
  assert.equal(drivers.find((driver) => driver.name === 'Unknown Vendor Driver').manufacturer, 'Third-party');
  assert.equal(drivers[0].name, 'Elgato Virtual HID', 'third-party extensions are ordered first');
  assert.equal(drivers[2].kind, 'kext');
  assert.equal(p.parseDarwinDrivers('nope').drivers.length, 0);
});

test('parseDarwinDrivers caps the result and reports truncated', () => {
  const entries = Array.from({ length: 260 }, (_ignored, index) => ({
    _name: `Ext${index}`,
    spext_bundleid: `com.example.ext${index}`,
    spext_signed_by: 'Example',
    spext_version: '1.0',
  }));
  const { drivers, truncated } = p.parseDarwinDrivers(entries);
  assert.equal(drivers.length, 250);
  assert.equal(truncated, true);
});

test('driverSummaryOf counts third-party and problems from the capped lists', () => {
  const drivers = [
    { manufacturer: 'Apple' },
    { manufacturer: 'Example' },
    { manufacturer: 'Third Party' },
  ];
  assert.deepEqual(p.driverSummaryOf(drivers, [{ name: 'x' }], true), {
    total: 3,
    thirdParty: 2,
    problems: 1,
    truncated: true,
  });
  assert.deepEqual(p.driverSummaryOf(drivers, []), { total: 3, thirdParty: 2, problems: 0, truncated: false });
});
