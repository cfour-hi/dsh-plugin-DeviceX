// Render the real Device X panel in jsdom with sanitized demo data, then save
// standalone HTML pages that a headless browser can screenshot.
//
//   node promo/capture-ui.mjs
//
// Output: promo/capture/*.html (plus a shared style file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
  metricsFixture,
  inventoryBySection,
  actionsFixture,
  historyFixture,
  cleanupFixture,
  benchmarkFixture,
} from "../scripts/client-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, "capture");
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- privacy scrub
// Every value shown in a screenshot is demo data. These replacements remove the
// real machine's hostname, account name, serials, MACs and LAN addresses.
const TEXT_REPLACEMENTS = [
  [/\/Users\/qaxc84/g, "/Users/demo"],
  [/qaxc84/g, "demo"],
  [/Qax C84/g, "Demo User"],
  [/MacBook-Pro\.local/g, "Demo-Mac.local"],
  [/MacBook-Pro/g, "Demo-Mac"],
  [/C02XYZ123/g, "C02DEMO123"],
  [/UUID-1234/g, "UUID-DEMO"],
  [/192\.168\.1\.8/g, "10.0.0.12"],
  [/192\.168\.1\.1/g, "10.0.0.1"],
  [/192\.168\.1\./g, "10.0.0."],
  [/AA:BB:CC:DD:EE:FF/g, "02:00:00:00:00:01"],
  [/11:22:33:44:55:66/g, "02:00:00:00:00:02"],
  [/MyWiFi/g, "Home-5G"],
  [/ABC123/g, "DEMO123"],
  [/\/tmp\/dshx\/asar\/index\.js/g, "/opt/tools/agent.js"],
];

function scrub(value) {
  if (typeof value === "string") {
    let out = value;
    for (const [pattern, replacement] of TEXT_REPLACEMENTS) out = out.replace(pattern, replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = scrub(inner);
    return out;
  }
  return value;
}

function scrubHtml(html) {
  let out = html;
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

// ------------------------------------------------------------------ jsdom harness
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://127.0.0.1:50732/",
  pretendToBeVisual: true,
});
const domWindow = dom.window;
globalThis.window = domWindow;
globalThis.document = domWindow.document;
try {
  Object.defineProperty(globalThis, "navigator", { value: domWindow.navigator, configurable: true });
} catch {
  /* Node exposes navigator as a getter */
}
globalThis.HTMLElement = domWindow.HTMLElement;
globalThis.Node = domWindow.Node;
globalThis.Event = domWindow.Event;
globalThis.KeyboardEvent = domWindow.KeyboardEvent;
globalThis.MouseEvent = domWindow.MouseEvent;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(path.join(root, "plugin/client.js"), "utf8");
let registration = null;
domWindow.__ModuleLoader__ = { load(value) { registration = value; } };
new Function(source)();

const React = (await import("react")).default;
const ReactDOMClient = await import("react-dom/client");
const TestUtils = await import("react-dom/test-utils");
const act = typeof React.act === "function" ? React.act : TestUtils.act;

const dictionaries = {};
const slotRegistrations = [];
const applyCtx = {
  effect(fn) { fn(); return () => {}; },
  locale: {
    register(ns, dicts) { dictionaries[ns] = dicts; return () => {}; },
    bind() { return (key) => key; },
  },
  slots: {
    inject(_name, factory) { factory(); return () => {}; },
    register(options, component) { slotRegistrations.push({ options, component }); return () => {}; },
  },
};
registration.factory((spec) => {
  if (spec === "react") return React;
  throw new Error("forbidden require: " + spec);
}).apply(applyCtx);

const Page = slotRegistrations.find((entry) => entry.options.name === "main").component;
const dictZh = dictionaries.devicex.zh;
const tZh = (key, params) => {
  const template = Object.prototype.hasOwnProperty.call(dictZh, key) ? dictZh[key] : key;
  return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush(ms = 80) {
  await act(async () => { await sleep(ms); });
}

// ------------------------------------------------------------------ fetch double
const metrics = scrub(metricsFixture());
const sections = scrub(inventoryBySection());
const actions = scrub(actionsFixture());
const history = scrub(historyFixture());
const cleanup = scrub(cleanupFixture());

function handlerFor(url, init) {
  const requestPath = String(url);
  const method = (init && init.method) || "GET";
  if (method === "POST" && requestPath.includes("/devicex/api/action")) return { ok: true, message: "done", data: {} };
  if (method === "POST" && requestPath.includes("/devicex/api/benchmark")) return { ok: true, benchmark: benchmarkFixture(null) };
  if (requestPath.includes("/devicex/api/cleanup")) return { ok: true, cleanup };
  if (requestPath.includes("/devicex/api/metrics")) return { ok: true, metrics };
  if (requestPath.includes("/devicex/api/actions")) return { ok: true, platform: "darwin", actions, history };
  if (requestPath.includes("/devicex/api/inventory")) {
    const section = new URL("http://localhost" + requestPath).searchParams.get("section");
    return { ok: true, section, data: Object.prototype.hasOwnProperty.call(sections, section) ? sections[section] : {} };
  }
  throw new Error("unexpected request " + requestPath);
}

globalThis.fetch = async (url, init) => ({ ok: true, status: 200, json: async () => handlerFor(url, init) });

// ------------------------------------------------------------------ render
async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const reactRoot = ReactDOMClient.createRoot(container);
  await act(async () => { reactRoot.render(React.createElement(Page, { t: tZh })); });
  await flush(2800); // second poll fills sparkline ring buffers
  return { container, reactRoot };
}

function clickTab(container, label) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === label);
  if (!tab) throw new Error("tab not found: " + label);
  tab.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
}

const styleText = document.head.querySelector("style[data-devicex]").textContent;

const TOKENS = `
:root{color-scheme:dark;}
html,body{margin:0;padding:0;overflow:hidden;background:#0b0c0e;}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;}
.panel-viewport{width:1440px;height:900px;overflow:hidden;background:#151517;position:relative;}
.panel-viewport > div{height:100%;}
.dx-theme{
--dsw-alias-bg-base:#151517;
--dsw-alias-bg-layer-1:#1b1b1c;
--dsw-alias-bg-layer-2:#232325;
--dsw-alias-bg-overlay:#0e0e10;
--dsw-alias-border-l1:rgba(255,255,255,.075);
--dsw-alias-border-l2:rgba(255,255,255,.14);
--dsw-alias-border-l3:rgba(255,255,255,.22);
--dsw-alias-label-primary:#f4f5f7;
--dsw-alias-label-secondary:#a3a8ad;
--dsw-alias-label-primary-foreground:#101114;
--dsw-alias-brand-primary:#5686fe;
--dsw-alias-state-success-primary:#4ed17e;
--dsw-alias-state-warn-primary:#f7ad31;
--dsw-alias-state-error-primary:#ff6b6b;
--dsw-alias-switch-thumb:#ffffff;
--dsh-frame-top-clearance:0px;
}
`;

const CAPTURE_PLAN = [
  { id: "overview", tab: null },
  { id: "hardware", tab: "硬件" },
  { id: "network", tab: "网络" },
  { id: "actions", tab: "操作" },
  { id: "cleanup", tab: "清理" },
  { id: "benchmark", tab: "性能" },
];

const mounted = await mount();
for (const item of CAPTURE_PLAN) {
  if (item.tab) {
    clickTab(mounted.container, item.tab);
    await flush(700);
  }
  if (item.id === "benchmark") {
    const run = [...mounted.container.querySelectorAll("button")].find((node) => (node.textContent || "").includes("运行全部测试"));
    if (run) {
      run.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
      await flush(900);
    }
  }
  const html = scrubHtml(mounted.container.innerHTML);
  const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Device X — ${item.id}</title>
<style>${TOKENS}</style>
<style data-devicex>${styleText}</style>
<style id="promo-static">*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
</head><body><div class="panel-viewport"><div class="dx-theme">${html}</div></div></body></html>`;
  const file = path.join(outDir, item.id + ".html");
  fs.writeFileSync(file, page);
  console.log("wrote", path.relative(root, file), (page.length / 1024).toFixed(0) + " KB");
}

// safety net: report anything that still looks like the real machine identity
const joined = fs.readdirSync(outDir).map((name) => fs.readFileSync(path.join(outDir, name), "utf8")).join("\n");
const leftovers = ["qaxc84", "C02XYZ123", "192.168.1.8", "AA:BB:CC", "MyWiFi"].filter((needle) => joined.includes(needle));
if (leftovers.length) {
  console.error("PRIVACY CHECK FAILED, found:", leftovers.join(", "));
  process.exitCode = 1;
} else {
  console.log("privacy check: no real hostname/account/serial/MAC/SSID/IP left in captures");
}

await act(async () => { mounted.reactRoot.unmount(); });
mounted.container.remove();
domWindow.close();
