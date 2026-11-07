#!/usr/bin/env node
/**
 * Device X — offline verification.
 *
 * Reproduces the evidence behind the delivery without touching the DSH profile:
 *   1. syntax + manifest checks for the bundle package,
 *   2. the Host operation surface (metrics, one section, action guards),
 *   3. the plugin's registration wiring against a fake Cordis context
 *      (browser routes + agent tools + trust fence + JSON envelopes),
 *   4. the browser module format, registration options, locale dictionaries
 *      and style-tag disposal.
 *
 * Usage: node scripts/verify.mjs
 *
 * This does NOT install the plugin and does not call the live Web server.
 * AUTHENTICATED end-to-end calls live behind the browser session cookie; see
 * README.md for the live probe commands.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail === undefined ? '' : ` (${detail})`}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
section('1. Syntax and manifest');
const jsFiles = [
  'index.js',
  'client.js',
  'host/collector.js',
  'host/collector-darwin.js',
  'host/collector-win32.js',
  'host/actions.js',
  'host/actions-darwin.js',
  'host/actions-win32.js',
  'host/win.js',
  'host/proc.js',
  'host/transport.js',
  'host/tool.js',
];
for (const file of jsFiles) {
  const path = join(pluginDir, file);
  let ok = true;
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch {
    ok = false;
  }
  check(`node --check plugin/${file}`, ok);
}
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
check('package.json declares a bundle patch', manifest.dsh?.bundle?.patch === './cordis.patch.yml');
check(
  'package.json limits the bundle to macOS + Windows',
  JSON.stringify(manifest.dsh?.bundle?.platforms) === JSON.stringify(['darwin', 'win32']),
);
check(
  'package.json ships the bundled PowerShell scripts',
  Array.isArray(manifest.files) && manifest.files.includes('host/win/*.ps1'),
);
check('package.json declares a web client', manifest.dsh?.client?.platform === 'web');
check(
  'package.json exports icon + locales + client',
  manifest.exports?.['./icon'] === './icon.svg' &&
    manifest.exports?.['./locale/*.json'] === './locale/*.json' &&
    manifest.exports?.['./client'] === './client.js',
);
const patch = readFileSync(join(pluginDir, 'cordis.patch.yml'), 'utf8');
check('patch inserts the devicex row', /- id: devicex[\s\S]*name: '@local\/dsh-devicex'/.test(patch));
const icon = statSync(join(pluginDir, 'icon.svg')).size;
check('icon.svg is a plausible SVG under the 256 KiB limit', icon > 0 && icon < 262144, `${icon} B`);
for (const locale of ['en', 'zh']) {
  const json = JSON.parse(readFileSync(join(pluginDir, 'locale', `${locale}.json`), 'utf8'));
  check(
    `locale/${locale}.json carries localized meta`,
    typeof json.meta?.title === 'string' &&
      json.meta.title.length > 0 &&
      typeof json.meta?.description === 'string',
  );
}

// ---------------------------------------------------------------------------
section('2. Host operation surface');
const collector = await import(pathToFileURL(join(pluginDir, 'host/collector.js')));
const actions = await import(pathToFileURL(join(pluginDir, 'host/actions.js')));

const metrics = await collector.collectMetrics();
check('collectMetrics returns the documented shape', typeof metrics?.hostname === 'string' && typeof metrics?.cpu?.usagePercent === 'number');
check('metrics are JSON-safe', typeof JSON.stringify({ metrics }) === 'string');
const inventory = await collector.collectInventory({
  sections: ['hardware', 'system', 'software', 'network', 'security', 'processes'],
});
check('collectInventory carries all six sections', collector.SECTIONS.every((name) => inventory.sections?.[name] !== undefined));
check('inventory is JSON-safe', typeof JSON.stringify({ inventory }) === 'string');
const catalog = actions.actionCatalog();
check('action catalog exposes 18 whitelisted actions', catalog.length === 18, `${catalog.length}`);
for (const required of ['process.signal', 'app.uninstall', 'system.setHostname', 'network.setDns', 'power.sleep']) {
  check(`catalog includes ${required}`, catalog.some((entry) => entry.id === required));
}
const guard = await actions.runAction('process.signal', { pid: 1 });
check('pid 1 is refused', guard.ok === false);
const unknown = await actions.runAction('nope', {});
check('unknown action is refused', unknown.ok === false && unknown.code === 'UNKNOWN_ACTION');
const badParams = await actions.runAction('system.setVolume', { percent: 500 });
check('out-of-range params are refused', badParams.ok === false);

// ---------------------------------------------------------------------------
section('3. Registration wiring (fake Cordis context)');
const plugin = await import(pathToFileURL(join(pluginDir, 'index.js')));
const effects = [];
const routes = [];
const tools = [];
const fakeCtx = {
  effect(callback, label) {
    const dispose = callback();
    effects.push({ label, dispose });
    return dispose;
  },
  webServer: {
    register(route) {
      routes.push(route);
      return () => {
        route.disposed = true;
      };
    },
  },
  tools: {
    register(definition) {
      tools.push(definition);
      return () => {
        definition.disposed = true;
      };
    },
  },
  connection: {
    requestRejection(req) {
      return req.headers['x-test-reject'] === '1' ? 403 : undefined;
    },
  },
};
plugin.apply(fakeCtx);
check('plugin name is devicex', plugin.name === 'devicex');
check(
  'hard dependencies are webServer/connection/tools',
  JSON.stringify(plugin.inject) === JSON.stringify(['webServer', 'connection', 'tools']),
);
check('four browser API routes registered', routes.length === 4, routes.map((r) => r.path).join(', '));
check('two agent tools registered', tools.length === 2, tools.map((t) => t.name).join(', '));
check('tool names are device_info/device_control', tools.map((t) => t.name).sort().join(',') === 'device_control,device_info');
check('device_info parameters accept sections', tools[0].parameters.properties.section.enum.length === 7);
check('device_control actions mirror the catalog', tools[1].parameters.properties.action.enum.length === catalog.length);

function makeReq(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
  return {
    method,
    url,
    headers: { host: '127.0.0.1:50732', ...headers },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () =>
          index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      };
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
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      res.headersSent = true;
      res.body = chunk === undefined ? '' : String(chunk);
    },
    destroy() {
      res.destroyed = true;
    },
  };
  return res;
}
async function call(method, path, body, headers) {
  const pathname = path.split('?', 1)[0];
  const handler = routes.find((route) => route.path === pathname).handler;
  const res = makeRes();
  await handler(makeReq(method, path, body, headers), res);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = undefined;
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

let response = await call('GET', '/devicex/api/metrics', undefined, { 'x-test-reject': '1' });
check('trust fence rejects a foreign/unauthenticated caller', response.status === 403);
response = await call('GET', '/devicex/api/metrics');
check('GET metrics envelope', response.status === 200 && response.json.ok === true && typeof response.json.metrics.hostname === 'string');
response = await call('GET', '/devicex/api/inventory?section=network');
check('GET inventory section envelope', response.status === 200 && response.json.section === 'network');
response = await call('GET', '/devicex/api/inventory?section=bogus');
check('unknown section is a 400', response.status === 400 && response.json.error.code === 'unknown-section');
response = await call('GET', '/devicex/api/actions');
check('GET actions envelope', response.status === 200 && Array.isArray(response.json.actions) && Array.isArray(response.json.history));
response = await call('POST', '/devicex/api/metrics', '{}');
check('wrong method is a 405', response.status === 405 && response.headers.allow === 'GET');
response = await call('POST', '/devicex/api/action', '{}');
check('action route requires JSON content type', response.status === 415);
response = await call('POST', '/devicex/api/action', JSON.stringify({ action: 'nope' }), {
  'content-type': 'application/json',
});
check(
  'action route returns a business failure as HTTP 200',
  response.status === 200 && response.json.ok === false && response.json.code === 'UNKNOWN_ACTION',
);
const overview = await tools[0].execute({}, {});
check('device_info overview is executable and summarizable', typeof overview.summary === 'string' && overview.summary.length > 0);
check('device_info keeps the tool result shape', overview.section === 'overview' && typeof overview.data === 'object');
check('tool render produces text content blocks', Array.isArray(tools[0].output.render({}, overview)));
const controlGuard = await tools[1].execute({ action: 'process.signal', params: { pid: 1 } }, {});
check('device_control reuses the same guards', controlGuard.ok === false);
const disposeAll = () =>
  effects.forEach((entry) => {
    if (typeof entry.dispose === 'function') entry.dispose();
    else if (Array.isArray(entry.dispose)) {
      for (const dispose of entry.dispose) if (typeof dispose === 'function') dispose();
    }
  });
disposeAll();
check('route and tool registrations are disposable', routes.every((route) => route.disposed === true) && tools.every((tool) => tool.disposed === true));

// ---------------------------------------------------------------------------
section('4. Browser module (stubbed platform)');
const clientSource = readFileSync(join(pluginDir, 'client.js'), 'utf8');
check('module loader id matches the package name', clientSource.includes('id: "@local/dsh-devicex"'));
check('only react is required', !/require\("(?!react")/.test(clientSource));
class Component {
  constructor(props) {
    this.props = props ?? {};
  }
  setState() {}
}
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  Fragment: 'Fragment',
  memo: (component) => component,
  Component,
};
const moduleRegistry = { react: ReactStub };
let moduleEntry;
const documentStub = {
  head: { appendChild(node) { node.parentNode = documentStub.head; } },
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
};
new Function(
  'window',
  'document',
  'require',
  'globalThis',
  clientSource,
)({ __ModuleLoader__: { load(entry) { moduleEntry = entry; } } }, documentStub, (id) => {
  if (!(id in moduleRegistry)) throw new Error(`unexpected require: ${id}`);
  return moduleRegistry[id];
}, {});
check('browser module registers itself', moduleEntry?.id === '@local/dsh-devicex');
const clientExports = moduleEntry.factory((id) => moduleRegistry[id]);
check('client injects slots + locale', JSON.stringify(clientExports.inject) === JSON.stringify(['slots', 'locale']));
const slotRegistrations = [];
let localeRegistration;
const styleLifecycle = { appended: false, removed: false };
let styleTag;
const clientDisposers = [];
const clientCtx = {
  effect(callback) {
    const dispose = callback();
    clientDisposers.push(dispose);
    return dispose;
  },
  locale: {
    register(ns, dicts) {
      localeRegistration = { ns, dicts };
      return () => {};
    },
    bind() {
      return (key) => key;
    },
  },
  slots: {
    inject(key, factory) {
      return factory();
    },
    register(options, component) {
      slotRegistrations.push({ options, component });
      return () => {};
    },
  },
};
// Track the style element through the document stub.
documentStub.head.appendChild = (node) => {
  styleLifecycle.appended = true;
  styleTag = node;
  node.parentNode = { removeChild: () => { styleLifecycle.removed = true; } };
};
clientExports.apply(clientCtx);
for (const dispose of clientDisposers) if (typeof dispose === 'function') dispose();
check('locale namespace is devicex', localeRegistration?.ns === 'devicex');
const zhKeys = Object.keys(localeRegistration.dicts.zh).sort().join('|');
const enKeys = Object.keys(localeRegistration.dicts.en).sort().join('|');
check('zh/en dictionaries have identical keys', zhKeys === enKeys, `${Object.keys(localeRegistration.dicts.zh).length} keys`);
check('dictionaries carry no empty strings', [...Object.values(localeRegistration.dicts.zh), ...Object.values(localeRegistration.dicts.en)].every((value) => typeof value === 'string' && value.length > 0));
const mainRegistration = slotRegistrations.find((entry) => entry.options.name === 'main');
const sidebarRegistration = slotRegistrations.find((entry) => entry.options.name === 'sidebar.panellist');
check('main panel registered under key devicex', mainRegistration?.options.key === 'devicex');
check('sidebar.panellist registered under id devicex', sidebarRegistration?.options.id === 'devicex' && sidebarRegistration.options.locale === 'devicex');
check('sidebar entry exposes a localized label thunk', typeof sidebarRegistration?.options.label === 'function');
check('style tag is injected and its disposer removes it', styleLifecycle.appended && styleLifecycle.removed);
check('component exports are functions', typeof mainRegistration.component === 'function' && typeof sidebarRegistration.component === 'function');

// ---------------------------------------------------------------------------
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} — ${passed} checks`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
