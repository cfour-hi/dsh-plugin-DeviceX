// Render every tab with real mapped Windows data; catch runtime/error-boundary failures.
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, label, extra) => { results.push({ ok: !!ok, label }); console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (ok || !extra ? '' : ' — ' + extra)); };

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:50732/', pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w; globalThis.document = w.document;
globalThis.HTMLElement = w.HTMLElement; globalThis.Node = w.Node; globalThis.Event = w.Event;
globalThis.KeyboardEvent = w.KeyboardEvent; globalThis.MouseEvent = w.MouseEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (h) => clearTimeout(h);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch {}

const consoleErrors = [];
console.error = (...args) => { const t = args.map((v) => String(v && v.stack ? v.stack : v)).join(' '); if (!/deprecated|Could not parse CSS/.test(t)) consoleErrors.push(t); };

import { fileURLToPath } from 'node:url';
const FILE = process.env.DEVICEX_CLIENT_FILE
  ? path.resolve(process.env.DEVICEX_CLIENT_FILE)
  : fileURLToPath(new URL('../plugin/client.js', import.meta.url));
const DATA = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/windows-mapped.json', import.meta.url)), 'utf8'));

let registration = null;
w.__ModuleLoader__ = { load(v) { registration = v; } };
new Function(fs.readFileSync(FILE, 'utf8'))();

const React = (await import('react')).default;
const ReactDOMClient = await import('react-dom/client');
const TestUtils = await import('react-dom/test-utils');
const act = typeof React.act === 'function' ? React.act : TestUtils.act;

const dicts = {}; const regs = [];
const exportsObj = registration.factory((spec) => { if (spec === 'react') return React; throw new Error('bad require ' + spec); });
exportsObj.apply({
  effect(fn) { fn(); return () => {}; },
  locale: { register(ns, d) { dicts[ns] = d; return () => {}; }, bind() { return (k) => k; } },
  slots: { inject(_n, f) { f(); return () => {}; }, register(o, c) { regs.push({ o, c }); return () => {}; } },
});
const Page = regs.find((r) => r.o.name === 'main').c;
const translate = (key, params) => {
  const dict = dicts.devicex.en;
  const tpl = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  return params ? tpl.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m)) : tpl;
};
const t = (k, p) => translate(k, p);

globalThis.fetch = async (url) => {
  const path = String(url);
  await sleep(60);
  let body;
  if (path.includes('/metrics')) body = { ok: true, metrics: DATA.metrics };
  else if (path.includes('/actions')) body = { ok: true, platform: 'win32', actions: DATA.actions, history: DATA.history };
  else {
    const section = new URL('http://x' + path).searchParams.get('section');
    body = { ok: true, section, data: DATA.sections[section] ?? {} };
  }
  return { ok: true, status: 200, json: async () => body };
};

const container = document.createElement('div');
document.body.appendChild(container);
const root = ReactDOMClient.createRoot(container);
const flush = async (ms = 90) => { await act(async () => { await sleep(ms); }); };
const bodyText = () => (container.textContent || '').replace(/\s+/g, ' ');
const findTab = (label) => [...container.querySelectorAll('[role="tab"]')].find((n) => (n.textContent || '').trim() === label);
const clickTab = async (label) => {
  const tab = findTab(label);
  check(!!tab, 'tab present: ' + label);
  await act(async () => { tab.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush(600);
};

await act(async () => { root.render(React.createElement(Page, { t })); });
await flush(400);

const expected = {
  Overview: ['DESKTOP-8F3K2Q1', 'Windows 11'],
  Hardware: ['Processor', '12th Gen Intel'],
  System: ['Startup items', 'DESKTOP-8F3K2Q1'],
  Software: ['7-Zip 23.01 (x64)', 'winget'],
  Network: ['Wi-Fi', '192.168.1.87'],
  Security: ['BitLocker', 'Secure Boot', 'Windows Defender'],
  Processes: ['chrome'],
  Actions: ['Uninstall winget package', 'Actions'],
};
for (const [label, needles] of Object.entries(expected)) {
  await clickTab(label);
  const text = bodyText();
  const guardHit = text.includes(t('guard.title'));
  const missing = needles.filter((needle) => !text.includes(needle));
  check(!guardHit, `${label}: no error-boundary fallback`);
  check(missing.length === 0, `${label}: expected content present`, 'missing: ' + missing.join(', '));
  check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 2).join(' | ').slice(0, 300));
  if (guardHit || missing.length) console.log('    text sample:', text.slice(0, 260));
}

// Windows has no FileVault pane. The Security pane card used to render a
// FileVault button here that fell back to the same `privacy` target as the TCC
// card above, so the page showed two identical "Open privacy settings" buttons.
await clickTab('Security');
const privacyLabel = t('sec.openPrivacyWin');
const privacyButtons = [...container.querySelectorAll('button')].filter(
  (node) => (node.textContent || '').trim() === privacyLabel,
);
check(privacyButtons.length === 1, 'Security: exactly one privacy settings button on Windows', 'found ' + privacyButtons.length);
check(!bodyText().includes(t('sec.openFileVault')), 'Security: no FileVault button on Windows');
check(consoleErrors.length === 0, 'Security: no console errors after the pane-button check', consoleErrors.slice(0, 2).join(' | ').slice(0, 300));

console.log('\nconsole errors:', consoleErrors.length);
for (const e of consoleErrors.slice(0, 6)) console.log('  ', e.slice(0, 300));
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'WINDOWS RENDER SCENARIO PASSED' : failed.length + ' FAILED'} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
