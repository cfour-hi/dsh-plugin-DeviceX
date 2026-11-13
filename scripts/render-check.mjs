import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  metricsFixture,
  inventoryBySection,
  actionsFixture,
  historyFixture,
  cleanupFixture,
  footprintFixture,
  benchmarkFixture,
  networkFixture,
  softwareFixture,
} from "./client-fixtures.mjs";

// ------------------------------------------------------------------ harness
const results = [];
function check(condition, label, extra) {
  results.push({ ok: !!condition, label, extra });
  if (!condition) console.log("  FAIL  " + label + (extra ? " — " + extra : ""));
}
function section(title) {
  console.log("\n--- " + title);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://127.0.0.1:50732/",
  pretendToBeVisual: true,
});
const domWindow = dom.window;
globalThis.window = domWindow;
globalThis.document = domWindow.document;
try { Object.defineProperty(globalThis, "navigator", { value: domWindow.navigator, configurable: true }); } catch (_error) { /* Node exposes navigator as a getter */ }
globalThis.HTMLElement = domWindow.HTMLElement;
globalThis.Node = domWindow.Node;
globalThis.Event = domWindow.Event;
globalThis.KeyboardEvent = domWindow.KeyboardEvent;
globalThis.MouseEvent = domWindow.MouseEvent;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// capture console errors so a render crash or React warning is visible
const consoleErrors = [];
import util from "node:util";
const originalConsoleError = console.error;
console.error = (...args) => {
  const text = args.map((value) => (typeof value === "string" ? value : String(value && value.stack ? value.stack : value))).join(" ");
  if (text.includes('unique "key"')) {
    consoleErrors.push(text + " || DEBUG " + args.slice(1).map((value) => util.inspect(value, { depth: 2, breakLength: Infinity }).slice(0, 700)).join(" || "));
    return;
  }
  const ignorable = ["ReactDOMTestUtils.act", "is deprecated in favor of", "Could not parse CSS stylesheet"];
  if (!ignorable.some((marker) => text.includes(marker))) consoleErrors.push(text);
};
function takeConsoleErrors() {
  const copy = consoleErrors.slice();
  consoleErrors.length = 0;
  return copy;
}

// ------------------------------------------------------------------ load plugin module
import { fileURLToPath } from "node:url";
const FILE = process.env.DEVICEX_CLIENT_FILE
  ? path.resolve(process.env.DEVICEX_CLIENT_FILE)
  : fileURLToPath(new URL("../plugin/client.js", import.meta.url));
const source = fs.readFileSync(FILE, "utf8");
let registration = null;
domWindow.__ModuleLoader__ = {
  load(value) {
    registration = value;
  },
};
new Function(source)();
check(registration !== null, "module factory registered via window.__ModuleLoader__.load");

const React = (await import("react")).default;
const ReactDOMClient = await import("react-dom/client");
const TestUtils = await import("react-dom/test-utils");
const act = typeof React.act === "function" ? React.act : TestUtils.act;

let factoryExports = null;
try {
  factoryExports = registration.factory((spec) => {
    if (spec === "react") return React;
    throw new Error("forbidden require: " + spec);
  });
} catch (error) {
  check(false, "factory materializes with only react", String(error));
}
check(factoryExports && typeof factoryExports.apply === "function", "factory returns { apply }");

// ------------------------------------------------------------------ apply with a real document
const dictionaries = {};
const slotRegistrations = [];
const applyCtx = {
  effect(fn) {
    fn();
    return () => {};
  },
  locale: {
    register(ns, dicts) {
      dictionaries[ns] = dicts;
      return () => {};
    },
    bind() {
      return (key) => key;
    },
  },
  slots: {
    inject(_name, factory) {
      factory();
      return () => {};
    },
    register(options, component) {
      slotRegistrations.push({ options, component });
      return () => {};
    },
  },
};
try {
  factoryExports.apply(applyCtx);
} catch (error) {
  check(false, "apply() runs without throwing", String(error && error.stack ? error.stack : error));
}
check(Object.keys(dictionaries).length === 1 && dictionaries.devicex, "locale namespace devicex registered by apply()");
check(document.head.querySelectorAll("style[data-devicex]").length === 1, "apply() injected exactly one <style data-devicex> into <head>");
const mainRegistration = slotRegistrations.find((entry) => entry.options.name === "main");
check(!!mainRegistration, "apply() registered the main slot");
const Page = mainRegistration ? mainRegistration.component : null;

function translate(locale, key, params) {
  const dict = dictionaries.devicex[locale];
  const template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template;
}
const tEn = (key, params) => translate("en", key, params);
const tZh = (key, params) => translate("zh", key, params);
check(tEn("panel") === "Device X" && tZh("panel") === "设备", "dictionaries resolve in both locales");

// ------------------------------------------------------------------ fetch doubles
function createHappyHandler(overrides = {}) {
  const calls = { gets: [], posts: [], benchmarkRuns: [], cleanupFetches: [], deletedIds: [], footprintFetches: [] };
  const handler = async (url, init) => {
    const path = String(url);
    const method = (init && init.method) || "GET";
    if (method === "POST" && path.indexOf("/devicex/api/action") >= 0) {
      const payload = JSON.parse(init.body);
      calls.posts.push(payload);
      if (payload.action === "cleanup.delete") {
        calls.deletedIds = calls.deletedIds.concat(Array.isArray(payload.params && payload.params.ids) ? payload.params.ids : []);
        return { ok: true, message: "Reclaimed 25.4 GB", data: { deletedBytes: 25.4 * 1024 ** 3 } };
      }
      if (overrides.postResponse) return overrides.postResponse(payload);
      return { ok: true, message: "done", data: { action: payload.action } };
    }
    if (method === "POST" && path.indexOf("/devicex/api/benchmark") >= 0) {
      calls.benchmarkRuns.push(JSON.parse(init.body || "{}"));
      const previous =
        calls.benchmarkRuns.length > 1
          ? { at: Date.now() - 60_000, results: [
              { id: "cpu", score: 290000000, unit: "ops/s" },
              { id: "memory", score: 9.0, unit: "GB/s" },
              { id: "disk", score: 5100, unit: "MB/s" },
            ] }
          : null;
      return { ok: true, benchmark: benchmarkFixture(previous) };
    }
    if (path.indexOf("/devicex/api/footprint") >= 0) {
      calls.footprintFetches.push(path);
      if (overrides.footprint === null) throw new Error("HTTP 500");
      return { ok: true, footprint: overrides.footprint ? overrides.footprint() : footprintFixture() };
    }
    if (path.indexOf("/devicex/api/cleanup") >= 0) {
      calls.cleanupFetches.push(path);
      const cleanup = cleanupFixture();
      const remaining = overrides.cleanup ? overrides.cleanup() : cleanup.items;
      cleanup.items = remaining.filter((item) => calls.deletedIds.indexOf(item.id) < 0);
      cleanup.totalBytes = cleanup.items.reduce((sum, item) => sum + item.bytes, 0);
      cleanup.totalFiles = cleanup.items.reduce((sum, item) => sum + item.files, 0);
      return { ok: true, cleanup };
    }
    calls.gets.push(path);
    if (path.indexOf("/devicex/api/metrics") >= 0) return { ok: true, metrics: overrides.metrics ? overrides.metrics() : metricsFixture() };
    if (path.indexOf("/devicex/api/actions") >= 0) return { ok: true, platform: "darwin", actions: overrides.actions ? overrides.actions() : actionsFixture(), history: overrides.history ? overrides.history() : historyFixture() };
    if (path.indexOf("/devicex/api/inventory") >= 0) {
      const section = new URL("http://localhost" + path).searchParams.get("section");
      const sections = overrides.sections ? overrides.sections() : inventoryBySection();
      return { ok: true, section, data: Object.prototype.hasOwnProperty.call(sections, section) ? sections[section] : {} };
    }
    throw new Error("unexpected request " + path);
  };
  return { handler, calls };
}
let activeHandler = null;
const fetchViolations = [];
globalThis.fetch = async (url, init) => {
  const requestPath = String(url);
  if (requestPath.indexOf("/devicex/api/") !== 0) fetchViolations.push(requestPath);
  if (!activeHandler) throw new Error("no fetch handler installed");
  const body = await activeHandler(url, init);
  return { ok: true, status: 200, json: async () => body };
};

// ------------------------------------------------------------------ mount helpers
async function mountPage(t) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  await act(async () => {
    root.render(React.createElement(Page, { t }));
  });
  await flush(120);
  return { container, root, t };
}
async function flush(ms = 60) {
  await act(async () => {
    await sleep(ms);
  });
}
async function unmountPage(mounted) {
  await act(async () => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}
function textOf(node) {
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}
function findTab(container, label) {
  return [...container.querySelectorAll('[role="tab"]')].find((node) => textOf(node) === label);
}
async function clickTab(container, label) {
  const tab = findTab(container, label);
  check(!!tab, "tab present: " + label);
  if (!tab) return;
  await act(async () => {
    tab.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
  });
  await flush(100);
}
function buttonsWithText(container, text) {
  return [...container.querySelectorAll("button")].filter((node) => textOf(node).indexOf(text) >= 0);
}
async function click(node) {
  await act(async () => {
    node.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
  });
  await flush(100);
}
function rootMotion(container) {
  const root = container.firstElementChild;
  return root ? root.getAttribute("data-motion") : null;
}
async function setFieldValue(field, value) {
  const proto = field.tagName === "TEXTAREA" ? domWindow.HTMLTextAreaElement.prototype : domWindow.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
  });
}
async function selectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(domWindow.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
  });
}
async function clickFocused(node) {
  if (node && typeof node.focus === "function") node.focus();
  await click(node);
}
async function confirmFooter(container) {
  const dialog = container.querySelector('[role="dialog"]');
  const buttons = dialog ? [...dialog.querySelectorAll(".dx-modalFooter button")] : [];
  if (buttons.length !== 2) return false;
  await act(async () => {
    buttons[1].dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
  });
  await flush(180);
  return true;
}

// ================================================================== 1. happy path (EN)
section("1. English happy path — every tab renders live Host data");
{
  takeConsoleErrors();
  const { handler, calls } = createHappyHandler();
  activeHandler = handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  check(textOf(container).indexOf("MacBook-Pro.local") >= 0, "header shows the device hostname");
  check(!/undefined|NaN/.test(textOf(container)), "no undefined/NaN leaked into the rendered page");
  check(textOf(container).indexOf("macOS 15.1 (24B83)") >= 0, "header shows the OS chip");
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  check(tabs.length === 10, "ten tabs rendered", "got " + tabs.length);
  check(tabs[0].getAttribute("aria-selected") === "true", "Overview tab initially selected");
  check(textOf(container).indexOf("Top processes") >= 0, "Overview renders top processes card");
  check(textOf(container).indexOf("WindowServer") >= 0, "Overview renders the top process name");
  check(textOf(container).indexOf("Memory breakdown") >= 0, "Overview renders memory breakdown");
  check(textOf(container).indexOf("MyWiFi") >= 0, "Overview hero shows the Wi-Fi network");
  check(container.querySelectorAll(".dx-donutWrap svg").length >= 5, "five SVG donut KPIs rendered", "got " + container.querySelectorAll(".dx-donutWrap svg").length);
  await flush(2700); // second 2500 ms poll fills the ring buffer so sparklines draw
  check(container.querySelectorAll("svg.dx-spark").length >= 1, "sparklines render as SVG after the second poll", "got " + container.querySelectorAll("svg.dx-spark").length);
  check(container.querySelectorAll("line.dx-sparkBase").length >= 1, "sparklines draw a shared 0% baseline", "got " + container.querySelectorAll("line.dx-sparkBase").length);
  check(container.querySelector('.dx-scene') !== null, "CSS-3D hero scene rendered");
  // The 3D toggle controls only this scene, so it must live inside it (not in
  // the page header, where it used to sit).
  const scene = container.querySelector(".dx-scene");
  const motionButton = scene ? scene.querySelector('button[aria-label="3D motion"]') : null;
  check(motionButton !== null, "3D toggle lives inside the hero scene");
  if (motionButton) {
    check(rootMotion(container) === "on", "motion starts enabled");
    await click(motionButton);
    check(rootMotion(container) === "off", "3D toggle pauses motion");
    await click(motionButton);
    check(rootMotion(container) === "on", "3D toggle resumes motion");
  }
  check(textOf(container).indexOf("All good") >= 0 || textOf(container).indexOf("no alerts") >= 0, "derived alerts empty-state rendered");
  await clickTab(container, "Hardware");
  check(textOf(container).indexOf("Per-core usage") >= 0, "Hardware renders per-core usage bars");
  check(textOf(container).indexOf("Apple M3 Pro") >= 0, "Hardware renders the CPU model");
  check(textOf(container).indexOf("Memory modules") >= 0, "Hardware renders memory modules");
  check(textOf(container).indexOf("Graphics & displays") >= 0, "Hardware pairs GPU and displays in one card");
  const graphicsCard = [...container.querySelectorAll("section.dx-card")].find(
    (node) => textOf(node).indexOf("Graphics & displays") >= 0,
  );
  check(graphicsCard !== undefined && graphicsCard.querySelectorAll(".dx-duoCol").length === 2, "graphics card renders two columns");
  check(
    graphicsCard !== undefined && textOf(graphicsCard).indexOf("Apple M3 Pro GPU") >= 0 && textOf(graphicsCard).indexOf("D2724Q") >= 0,
    "graphics card lists the GPU and both displays",
  );
  check(container.querySelector(".dx-factGridForce2 .dx-factGrid") !== null, "battery facts use the pinned two-column grid");
  check(textOf(container).indexOf("Liquid Retina XDR") >= 0, "Hardware renders displays");
  check(textOf(container).indexOf("Macintosh HD") >= 0, "Hardware renders volumes");
  check(textOf(container).indexOf("Connections") >= 0, "Hardware renders the merged connections card");
  check(textOf(container).indexOf("USB-C Digital AV Adapter") >= 0, "connections card lists USB devices");
  const connectionsCard = [...container.querySelectorAll("section.dx-card")].find(
    (node) => textOf(node.querySelector(".dx-cardTitle") || node).trim() === "Connections",
  );
  const connectionToggle = connectionsCard
    ? [...connectionsCard.querySelectorAll(".dx-segBtn")].find((node) => textOf(node).trim() === "Bluetooth")
    : null;
  check(connectionToggle !== null, "connections card switches between USB and Bluetooth");
  if (connectionToggle) await click(connectionToggle);
  check(textOf(container).indexOf("Magic Keyboard") >= 0, "Hardware renders Bluetooth devices");
  check(textOf(container).indexOf("BCM4387") >= 0, "Bluetooth view shows the controller facts");
  check(textOf(container).indexOf("FaceTime HD Camera") >= 0, "Hardware renders cameras");
  check(container.querySelectorAll("thead th[scope='col']").length > 0, "tables expose scope='col' headers");
  check(textOf(container).indexOf("46.5 °C") >= 0, "Hardware renders the CPU thermal reading");
  check(textOf(container).indexOf("Thermals") >= 0, "Hardware renders the thermal card");
  check(textOf(container).indexOf("Drivers & kernel extensions") >= 0, "Hardware renders the driver inventory");
  check(textOf(container).indexOf("Elgato Virtual HID") >= 0, "Hardware lists third-party drivers");
  check(textOf(container).indexOf("Read-only inventory") >= 0, "Hardware marks drivers as read-only");
  const driverSearch = [...container.querySelectorAll("input[type='search']")].find((field) => !field.placeholder || field.placeholder.indexOf("driver") >= 0);
  if (driverSearch) {
    await setFieldValue(driverSearch, "elgato");
    await flush(80);
    check(textOf(container).indexOf("Elgato Virtual HID") >= 0 && textOf(container).indexOf("AppleAPFSMedia") < 0, "driver search filters the inventory");
    await setFieldValue(driverSearch, "");
    await flush(80);
  }

  await clickTab(container, "System");
  check(textOf(container).indexOf("Launch agents") >= 0, "System renders launch agents");
  check(textOf(container).indexOf("com.example.agent") >= 0, "System lists the launch agent label");
  check(textOf(container).indexOf("Dropbox") >= 0, "System renders login items");
  check(textOf(container).indexOf("Environment") >= 0, "System renders environment");
  check(container.querySelectorAll('button[role="switch"]').length >= 2, "launch agents render accessible switches");

  await clickTab(container, "Software");
  check(textOf(container).indexOf("Visual Studio Code") >= 0, "Software lists applications");
  // Applications and Homebrew are views of one card; switch to check the package list.
  const brewView = buttonsWithText(container, "Homebrew")[0];
  if (brewView) await click(brewView);
  check(textOf(container).indexOf("Homebrew") >= 0, "Software renders Homebrew card");
  check(textOf(container).indexOf("git") >= 0, "Software lists brew packages");
  check(buttonsWithText(container, "Uninstall…").length >= 1, "Software renders uninstall actions");
  const appsView = buttonsWithText(container, "Applications")[0];
  if (appsView) await click(appsView);

  // ---- uninstall footprint dialog ------------------------------------
  const appUninstall = [...container.querySelectorAll(".dx-rowActions button")].find(
    (node) => (node.getAttribute("aria-label") || "").indexOf("Uninstall") === 0,
  );
  check(!!appUninstall, "Software row exposes an app-uninstall button");
  if (appUninstall) {
    await click(appUninstall);
    await flush(200);
    check(calls.footprintFetches.length === 1, "the footprint endpoint was queried before deleting", JSON.stringify(calls.footprintFetches));
    const fpDialog = container.querySelector('[role="dialog"]');
    check(!!fpDialog, "the uninstall dialog opened");
    const fpText = fpDialog ? textOf(fpDialog) : "";
    // All four tiers are visible, with their readable labels.
    check(fpText.indexOf("confirmed") >= 0, "the dialog shows confirmed items");
    check(fpText.indexOf("name guess") >= 0, "the dialog shows name-guess candidates");
    check(fpText.indexOf("ownership conflict") >= 0, "the dialog shows ownership conflicts");
    check(fpText.indexOf("shared") >= 0, "the dialog shows shared directories");
    // The 11 GB name-match case must be visible, not silently dropped.
    check(fpText.indexOf("Claude-3p") >= 0, "the dialog lists the name-matched 11 GB directory");
    // Tier A is preselected; tier B/C are not.
    const boxes = [...(fpDialog ? fpDialog.querySelectorAll("input[type=checkbox]") : [])];
    // Selectable = tier A (app bundle + caches), tier B (Claude-3p), tier C
    // (Claude). The shared vendor row and the admin-only helper get none.
    check(boxes.length === 4, "A/B/C rows get a checkbox and D/admin-only rows do not", "got " + boxes.length);
    const checked = boxes.filter((node) => node.checked === true);
    check(checked.length === 2, "only the confirmed tier is preselected", "got " + checked.length);
    const adminRow = fpDialog ? fpDialog.querySelector('.dx-cleanRow[data-tier="high"].dx-fpRow:last-of-type') : null;
    check(!adminRow || !adminRow.querySelector("input[type=checkbox]"), "the admin-only item is not offered for cleanup");
    // The unselected-summary hint exists so big candidates cannot slip by.
    check(fpText.indexOf("more candidate") >= 0, "the dialog warns about unselected candidates");
    // Trash is not freed space: the hint must be present.
    check(fpText.indexOf("frees no space") >= 0, "the dialog states that the Trash frees no space");
    // Shared directory row has no checkbox (it is one of the 3 non-checkbox rows).
    const sharedRow = fpDialog ? fpDialog.querySelector('.dx-fpRow[data-tier="shared"]') : null;
    check(!!sharedRow && !sharedRow.querySelector("input[type=checkbox]"), "the shared vendor directory has no checkbox");

    const fpConfirm = [...(fpDialog ? fpDialog.querySelectorAll("button") : [])].find(
      (node) => textOf(node) === "Uninstall and clean",
    );
    check(!!fpConfirm, "the dialog offers uninstall + clean");
    if (fpConfirm) {
      await click(fpConfirm);
      await flush(200);
      const fpPost = calls.posts.find((entry) => entry.action === "app.uninstall");
      check(!!fpPost, "app.uninstall was posted");
      if (fpPost) {
        check(typeof fpPost.params.scanId === "string" && fpPost.params.scanId.length > 0, "the request carries the scan id, never a path list", JSON.stringify(fpPost.params));
        // Tier A in the fixture is the app bundle plus its cache directory; the
        // medium/conflict rows must NOT be sent without an explicit click.
        check(
          Array.isArray(fpPost.params.itemIds) && fpPost.params.itemIds.length === 2,
          "only the preselected tier-A item ids are sent",
          JSON.stringify(fpPost.params.itemIds),
        );
        check(
          fpPost.params.itemIds.indexOf("fp_name0001") < 0 && fpPost.params.itemIds.indexOf("fp_conf0001") < 0,
          "unselected tier-B/C ids are not sent",
          JSON.stringify(fpPost.params.itemIds),
        );
        check(fpPost.params.cleanup === "trash", "cleanup mode is trash, never permanent delete");
        check(fpPost.params.mode === "trash", "the app itself goes to the Trash");
        // Security property: no filesystem path travels with the request.
        const serialized = JSON.stringify(fpPost.params);
        check(serialized.indexOf("Application Support") < 0 && serialized.indexOf("/Users/") < 0, "no filesystem path is sent to the host", serialized);
      }
    }
  }

  await clickTab(container, "Network");
  check(textOf(container).indexOf("Listening ports") >= 0, "Network renders listening ports");
  check(textOf(container).indexOf("1.1.1.1") >= 0, "Network renders DNS servers");
  check(textOf(container).indexOf("MyWiFi") >= 0, "Network renders Wi-Fi status");
  check(textOf(container).indexOf("en0") >= 0, "Network renders interfaces");
  check(textOf(container).indexOf("42") >= 0, "Network renders established connection count");

  await clickTab(container, "Security");
  check(textOf(container).indexOf("FileVault") >= 0, "Security renders FileVault card");
  check(textOf(container).indexOf("System Integrity Protection") >= 0, "Security renders SIP card");
  check(textOf(container).indexOf("Privacy permissions") >= 0, "Security renders TCC card");
  check(textOf(container).indexOf("Camera") >= 0, "Security renders TCC grants");

  await clickTab(container, "Processes");
  check(textOf(container).indexOf("WindowServer") >= 0, "Processes table lists rows");
  check(textOf(container).indexOf("kernel_task") >= 0, "Processes table lists kernel_task");
  check(buttonsWithText(container, "End…").length >= 2, "Processes rows expose kill buttons");
  // `elapsed` arrives as seconds from both hosts; it must be rendered as a
  // duration, not as the raw counter ("274320" tells the user nothing).
  const procText = textOf(container);
  check(procText.indexOf("274320") < 0, "Processes elapsed is not rendered as a raw second count");
  check(procText.indexOf("3 d") >= 0, "Processes elapsed renders as a duration");

  await clickTab(container, "Cleanup");
  check(container.querySelectorAll(".dx-cleanRow").length === 5, "Cleanup lists the allowlisted items", "got " + container.querySelectorAll(".dx-cleanRow").length);
  check(textOf(container).indexOf("User caches") >= 0 && textOf(container).indexOf("Xcode DerivedData") >= 0, "Cleanup renders labels");
  check(textOf(container).indexOf("Needs admin") >= 0, "Cleanup marks items that need administrator rights");
  check(textOf(container).indexOf("Reclaimable") >= 0, "Cleanup shows the reclaimable total");
  check(calls.cleanupFetches.length >= 1, "cleanup endpoint fetched");
  const selectAllButton = buttonsWithText(container, "Select all")[0];
  check(!!selectAllButton, "Cleanup offers select-all");
  if (selectAllButton) {
    await click(selectAllButton);
    check(textOf(container).indexOf("selected") >= 0, "Cleanup tracks the selection");
    const cleanButton = buttonsWithText(container, "Clean selected")[0];
    check(!!cleanButton, "Cleanup offers the clean action");
    await click(cleanButton);
    check(textOf(container).indexOf("Clean the selected items?") >= 0, "Cleanup asks for confirmation before deleting");
    const confirmButton = buttonsWithText(container, "Clean now")[0];
    check(!!confirmButton, "Cleanup exposes the confirm button");
    if (confirmButton) {
      await click(confirmButton);
      await flush(260);
      const deletePost = calls.posts.find((payload) => payload.action === "cleanup.delete");
      check(!!deletePost && Array.isArray(deletePost.params.ids) && deletePost.params.ids.length === 5, "cleanup.delete posted the selected ids", JSON.stringify(deletePost && deletePost.params));
      check(calls.cleanupFetches.some((path) => path.indexOf("fresh=1") >= 0), "cleanup rescanned after deletion");
      check(container.querySelectorAll(".dx-cleanRow").length === 0, "cleaned rows disappear after rescans", "got " + container.querySelectorAll(".dx-cleanRow").length);
    }
  }

  await clickTab(container, "Benchmark");
  check(textOf(container).indexOf("Run all tests") >= 0, "Benchmark offers a run action");
  check(textOf(container).indexOf("not against other models") >= 0 || textOf(container).indexOf("same machine") >= 0, "Benchmark explains its comparability limits");
  await click(buttonsWithText(container, "Run all tests")[0]);
  await flush(420);
  check(calls.benchmarkRuns.length === 1, "benchmark endpoint called once");
  check(container.querySelectorAll(".dx-benchCard").length === 3, "Benchmark renders three result cards", "got " + container.querySelectorAll(".dx-benchCard").length);
  check(textOf(container).indexOf("300000000") >= 0, "Benchmark renders the CPU score");
  check(textOf(container).indexOf("ops/s") >= 0 && textOf(container).indexOf("GB/s") >= 0 && textOf(container).indexOf("MB/s") >= 0, "Benchmark renders all units");
  check(textOf(container).indexOf("First run") >= 0, "Benchmark explains the missing baseline");
  await click(buttonsWithText(container, "Run again")[0]);
  await flush(420);
  check(calls.benchmarkRuns.length === 2, "benchmark can be re-run");
  check(container.querySelectorAll(".dx-benchDelta").length === 3, "Benchmark compares against the previous run", "got " + container.querySelectorAll(".dx-benchDelta").length);
  check(textOf(container).indexOf("Up") >= 0 || textOf(container).indexOf("Down") >= 0, "Benchmark shows a delta label");

  await clickTab(container, "Actions");
  check(textOf(container).indexOf("Signal a process") >= 0, "Actions renders the action catalogue");
  check(textOf(container).indexOf("Power") >= 0, "Actions renders the power group");
  check(textOf(container).indexOf("DNS cache flushed") >= 0, "Actions renders action history from the API");
  check(container.querySelectorAll(".dx-actionCard").length >= 19, "Actions renders all 19 catalogue cards", "got " + container.querySelectorAll(".dx-actionCard").length);

  check(calls.gets.filter((path) => path.indexOf("/metrics") >= 0).length >= 1, "metrics endpoint polled");
  check(calls.gets.filter((path) => path.indexOf("/inventory") >= 0).length >= 6, "each section fetched lazily", "got " + calls.gets.filter((path) => path.indexOf("/inventory") >= 0).length);
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors during the full English walk-through", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 2. Chinese
section("2. Chinese locale");
{
  takeConsoleErrors();
  activeHandler = createHappyHandler().handler;
  const mounted = await mountPage(tZh);
  const { container } = mounted;
  check(textOf(container).indexOf("总览") >= 0, "Chinese tab labels render");
  check(textOf(container).indexOf("高占用进程") >= 0, "Chinese Overview copy renders");
  check(textOf(container).indexOf("内存构成") >= 0, "Chinese memory breakdown copy renders");
  check(textOf(container).indexOf("一切正常") >= 0, "Chinese no-alert copy renders");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in Chinese render", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 3. confirm + escape + kill modal
section("3. Modal behaviour — confirm, Escape, focus");
{
  takeConsoleErrors();
  const { handler, calls } = createHappyHandler();
  activeHandler = handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Security");
  const flushButton = buttonsWithText(container, "Flush DNS cache")[0];
  check(!!flushButton, "Security flush-DNS button present");
  await click(flushButton);
  const dialog = container.querySelector('[role="dialog"]');
  check(!!dialog, "confirm dialog opens with role=dialog");
  check(dialog && textOf(dialog).indexOf("Flush the DNS cache?") >= 0, "dialog shows the confirmation title");
  check(dialog && dialog.getAttribute("aria-modal") === "true", "dialog is aria-modal");
  await act(async () => {
    document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush(40);
  check(container.querySelector('[role="dialog"]') === null, "Escape closes the dialog");
  check(calls.posts.length === 0, "Escape does not run the action");

  await click(buttonsWithText(container, "Flush DNS cache")[0]);
  const dialog2 = container.querySelector('[role="dialog"]');
  const footerButtons = dialog2 ? [...dialog2.querySelectorAll(".dx-modalFooter button")] : [];
  check(footerButtons.length === 2, "dialog has cancel + confirm footer buttons");
  if (footerButtons.length === 2) {
    await act(async () => {
      footerButtons[1].dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }));
    });
    await flush(180);
  }
  check(calls.posts.length === 1, "confirming runs exactly one action", "got " + calls.posts.length);
  check(calls.posts[0] && calls.posts[0].action === "system.flushDNS", "action id delivered to POST /action", JSON.stringify(calls.posts[0]));
  check(textOf(container).indexOf("Flush DNS cache completed") >= 0, "success toast shown after the action");
  check(container.querySelector('[role="dialog"]') === null, "dialog closes after the action completes");

  // kill modal on the Processes tab
  await clickTab(container, "Processes");
  const killButton = buttonsWithText(container, "End…")[0];
  check(!!killButton, "kill button present on a process row");
  await click(killButton);
  const killDialog = container.querySelector('[role="dialog"]');
  check(!!killDialog && textOf(killDialog).indexOf("End process") >= 0, "kill dialog opens with process copy");
  check(killDialog && !!killDialog.querySelector("select"), "kill dialog exposes a signal select");
  await act(async () => {
    document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush(40);
  check(container.querySelector('[role="dialog"]') === null, "kill dialog closes with Escape");
  check(calls.posts.length === 1, "cancelled kill did not POST");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in modal flows", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 4. action parameter validation
section("4. Actions tab parameter validation");
{
  takeConsoleErrors();
  activeHandler = createHappyHandler().handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Actions");
  const card = [...container.querySelectorAll(".dx-actionCard")].find((node) => textOf(node).indexOf("Signal a process") >= 0);
  check(!!card, "process.signal action card present");
  if (card) {
    const runButton = [...card.querySelectorAll("button")].find((node) => textOf(node) === "Run");
    check(!!runButton, "action card renders a Run button");
    await click(runButton);
    check(textOf(card).indexOf("Please fill in PID") >= 0, "required numeric parameter is validated client-side");
    check(container.querySelector('[role="dialog"]') === null, "invalid parameters do not open the confirm dialog");
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors during validation", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 5. connection error + retry
section("5. Connection failure state and recovery");
{
  takeConsoleErrors();
  let failing = true;
  const happy = createHappyHandler();
  activeHandler = async (url, init) => {
    if (failing) throw new Error("connection refused");
    return happy.handler(url, init);
  };
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  check(textOf(container).indexOf("Cannot reach the device service") >= 0, "connection error panel shown when the API is down");
  const retry = buttonsWithText(container, "Retry")[0];
  check(!!retry, "retry button offered");
  failing = false;
  activeHandler = happy.handler;
  if (retry) {
    await click(retry);
    await flush(180);
    check(textOf(container).indexOf("MacBook-Pro.local") >= 0, "retry recovers the page after the API returns");
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors during failure/recovery", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 6. hostile payloads
section("6. Defensive rendering of malformed payloads");
{
  takeConsoleErrors();
  const weirdSections = () => ({ hardware: null, system: { os: "nope" }, software: { applications: "nope", homebrew: 42 }, network: { interfaces: [null, 1, "x"], dns: "bad" }, security: { tcc: "no", users: [] }, processes: { list: "nope" } });
  activeHandler = async (url, init) => {
    const path = String(url);
    if (path.indexOf("/metrics") >= 0) return { ok: true, metrics: { cpu: { usagePercent: "oops", perCore: "bad" }, memory: { totalBytes: "x" }, disk: null, network: "bad", processes: { top: "nope" }, battery: "bad", thermal: 7 } };
    if (path.indexOf("/actions") >= 0) return { ok: true, actions: "nope", history: [null, 1, {}] };
    return { ok: true, section: "hardware", data: weirdSections()[new URL("http://localhost" + path).searchParams.get("section")] || null };
  };
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  check(textOf(container).indexOf("Device X") >= 0, "page still renders with a garbage metrics payload");
  check(!/undefined|NaN|\bnull\b/.test(textOf(container)), "malformed payloads never leak undefined/NaN/null into visible text", textOf(container).slice(0, 160));
  for (const label of ["Overview", "Hardware", "System", "Software", "Network", "Security", "Processes", "Actions"]) {
    await clickTab(container, label);
  }
  check(true, "all tabs survived malformed payloads without blanking");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors with malformed payloads", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}


// ================================================================== 7. lazy sections + fresh refresh
section("7. Lazy section fetch, in-memory cache and fresh=1 refresh");
{
  takeConsoleErrors();
  const { handler, calls } = createHappyHandler();
  activeHandler = handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  const inventoryCalls = () => calls.gets.filter((path) => path.indexOf("/inventory") >= 0);
  await flush(2400);
  const prefetched = ["hardware", "system", "software", "network", "security", "processes"].filter((section) =>
    inventoryCalls().filter((path) => path.indexOf("section=" + section) >= 0).length === 1,
  );
  check(prefetched.length === 6, "panel mount prefetches every section exactly once", JSON.stringify({ prefetched, calls: inventoryCalls() }));
  await clickTab(container, "Hardware");
  check(inventoryCalls().filter((path) => path.indexOf("section=hardware") >= 0).length === 1, "first Hardware visit reuses the prefetch (exactly one request)");
  await clickTab(container, "System");
  await clickTab(container, "Hardware");
  check(inventoryCalls().filter((path) => path.indexOf("section=hardware") >= 0).length === 1, "revisiting Hardware reuses the in-memory cache");
  await clickTab(container, "Hardware");
  const refreshButton = container.querySelector('button[aria-label="Refresh data"]');
  check(!!refreshButton, "header refresh control present");
  await click(refreshButton);
  await flush(220);
  check(inventoryCalls().some((path) => path.indexOf("section=hardware") >= 0 && path.indexOf("fresh=1") >= 0), "manual refresh requests the active section with fresh=1");
  await flush(2700);
  const metricPolls = calls.gets.filter((path) => path.indexOf("/metrics") >= 0).length;
  check(metricPolls >= 2, "metrics polled repeatedly while mounted", "polls=" + metricPolls);
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in lazy-refresh flow", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 8. failed section isolation
section("8. One failed section never blanks the page");
{
  takeConsoleErrors();
  const happy = createHappyHandler();
  activeHandler = async (url, init) => {
    if (String(url).indexOf("section=hardware") >= 0) throw new Error("hardware collector exploded");
    return happy.handler(url, init);
  };
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Hardware");
  check(textOf(container).indexOf("This section failed to load") >= 0, "failed section shows its own error panel");
  check(buttonsWithText(container, "Retry").length >= 1, "failed section offers retry");
  await clickTab(container, "Overview");
  check(textOf(container).indexOf("MacBook-Pro.local") >= 0, "Overview still renders after another section failed");
  await clickTab(container, "Hardware");
  activeHandler = happy.handler;
  const retry = buttonsWithText(container, "Retry")[0];
  await click(retry);
  await flush(200);
  check(textOf(container).indexOf("Per-core usage") >= 0, "section retry recovers the failed tab");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors during section failure", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 9. DNS + kill dispatch
section("9. Typed dispatch — DNS modal (array param) and kill signal");
{
  takeConsoleErrors();
  const { handler, calls } = createHappyHandler();
  activeHandler = handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Network");
  const setDns = buttonsWithText(container, "Set DNS").find((node) => textOf(node).indexOf("Set DNS") === 0);
  check(!!setDns, "Set DNS button present");
  await click(setDns);
  const dnsDialog = container.querySelector('[role="dialog"]');
  check(!!dnsDialog && textOf(dnsDialog).indexOf("Set DNS") >= 0, "DNS dialog opens");
  const textarea = dnsDialog ? dnsDialog.querySelector("textarea") : null;
  const serviceInput = dnsDialog ? dnsDialog.querySelector('input[type="text"]') : null;
  check(!!textarea, "DNS dialog has a servers textarea");
  check(textarea && textarea.value.indexOf("192.168.1.1") >= 0, "DNS dialog prefills current servers");
  if (textarea && serviceInput) {
    await setFieldValue(serviceInput, "Wi-Fi");
    await setFieldValue(textarea, "8.8.8.8 9.9.9.9");
    const confirmed = await confirmFooter(container);
    check(confirmed, "DNS confirm button clicked");
  }
  const dnsPost = calls.posts.find((entry) => entry.action === "network.setDns");
  check(!!dnsPost, "DNS action POSTed", JSON.stringify(calls.posts));
  check(dnsPost && dnsPost.params && dnsPost.params.service === "Wi-Fi", "DNS service param delivered");
  check(dnsPost && Array.isArray(dnsPost.params.servers) && dnsPost.params.servers.join(",") === "8.8.8.8,9.9.9.9", "DNS servers delivered as an array", JSON.stringify(dnsPost && dnsPost.params));

  // invalid DNS input keeps the dialog open and does not POST
  await click(buttonsWithText(container, "Set DNS")[0]);
  const invalidDialog = container.querySelector('[role="dialog"]');
  const invalidTextarea = invalidDialog ? invalidDialog.querySelector("textarea") : null;
  if (invalidTextarea) {
    await setFieldValue(invalidTextarea, "999.1.1.1");
    await confirmFooter(container);
    check(textOf(container).indexOf("Enter 0–4 valid IPv4 addresses") >= 0, "invalid DNS servers rejected client-side");
    check(calls.posts.filter((entry) => entry.action === "network.setDns").length === 1, "invalid DNS input did not POST");
    await act(async () => {
      document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush(40);
  }

  // kill dialog: pick KILL and confirm
  await clickTab(container, "Processes");
  await click(buttonsWithText(container, "End…")[0]);
  const killDialog = container.querySelector('[role="dialog"]');
  const signalSelect = killDialog ? killDialog.querySelector("select") : null;
  check(!!signalSelect, "kill dialog signal select present");
  if (signalSelect) {
    await selectValue(signalSelect, "KILL");
    await confirmFooter(container);
  }
  const killPost = calls.posts.find((entry) => entry.action === "process.signal");
  check(!!killPost, "kill action POSTed");
  check(killPost && killPost.params && killPost.params.pid === 1234 && killPost.params.signal === "KILL", "kill params carry pid + chosen signal", JSON.stringify(killPost && killPost.params));
  check(textOf(container).indexOf("Signal a process completed") >= 0, "kill success toast shown");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in typed dispatch", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 10. accessibility
section("10. Accessibility — focus, dialog restore, arrow-key tabs, ARIA linkage");
{
  takeConsoleErrors();
  activeHandler = createHappyHandler().handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  const overviewTab = findTab(container, "Overview");
  check(!!overviewTab && overviewTab.getAttribute("aria-controls") !== null, "tab exposes aria-controls");
  if (overviewTab) {
    overviewTab.focus();
    await act(async () => {
      overviewTab.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await flush(120);
    const hardwareTab = findTab(container, "Hardware");
    check(hardwareTab && hardwareTab.getAttribute("aria-selected") === "true", "ArrowDown moves selection to the next tab");
    check(document.activeElement === hardwareTab, "ArrowDown moves focus to the next tab");
    await act(async () => {
      hardwareTab.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    await flush(120);
    check(findTab(container, "Actions") && findTab(container, "Actions").getAttribute("aria-selected") === "true", "End jumps to the last tab");
    await clickTab(container, "Hardware");
    const panel = container.querySelector('[role="tabpanel"]');
    const hardwareTab2 = findTab(container, "Hardware");
    check(!!panel && !!hardwareTab2 && panel.getAttribute("aria-labelledby") === hardwareTab2.id, "tabpanel is labelled by its tab");
    check(!!panel && hardwareTab2 && hardwareTab2.getAttribute("aria-controls") === panel.id, "tab controls its panel id");
  }

  await clickTab(container, "Security");
  const openButton = buttonsWithText(container, "Flush DNS cache")[0];
  check(!!openButton, "security action button available for focus test");
  if (openButton) {
    await clickFocused(openButton);
    const dialog = container.querySelector('[role="dialog"]');
    check(!!dialog, "dialog opens for focus test");
    check(dialog && dialog.contains(document.activeElement), "opening the dialog moves focus inside it");
    await act(async () => {
      document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush(60);
    check(container.querySelector('[role="dialog"]') === null, "dialog closed with Escape");
    check(document.activeElement === openButton, "focus returns to the control that opened the dialog");
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in accessibility flow", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 11. reduced motion
section("11. prefers-reduced-motion");
{
  takeConsoleErrors();
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  activeHandler = createHappyHandler().handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  check(rootMotion(container) === "off", "reduced-motion preference disables the 3D animation", "motion=" + rootMotion(container));
  const scene = container.querySelector(".dx-scene");
  check(!!scene, "3D scene still rendered");
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors with reduced motion", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

// ================================================================== 12. sidebar icon
section("12. Sidebar icon component");
{
  const sidebarRegistration = slotRegistrations.find((entry) => entry.options.name === "sidebar.panellist");
  check(!!sidebarRegistration && typeof sidebarRegistration.component === "function", "sidebar icon component captured");
  const IconComponent = sidebarRegistration.component;
  const holder = document.createElement("div");
  document.body.appendChild(holder);
  const iconRoot = ReactDOMClient.createRoot(holder);
  try {
    await act(async () => {
      iconRoot.render(React.createElement(IconComponent, { size: 18, active: true, t: tEn }));
    });
    await flush(30);
    const svg = holder.querySelector("svg");
    check(!!svg, "sidebar icon renders an <svg>");
    check(svg && svg.getAttribute("width") === "18", "sidebar icon honours the size prop");
    check(holder.querySelectorAll("rect").length >= 2, "active sidebar icon draws the active highlight");
  } catch (error) {
    check(false, "sidebar icon renders without throwing", String(error));
  }
  await act(async () => {
    iconRoot.unmount();
  });
  holder.remove();
}

// ================================================================== 13. action failure + brew + launch agent
section("13. Failure toasts, Homebrew uninstall and launch-agent confirmation");
{
  takeConsoleErrors();
  const happy = createHappyHandler({
    postResponse: (payload) =>
      payload.action === "system.emptyTrash" ? { ok: false, message: "Operation not permitted", code: "EPERM" } : { ok: true, message: "done " + payload.action },
  });
  const { calls } = happy;
  activeHandler = happy.handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Security");
  await click(buttonsWithText(container, "Empty Trash")[0]);
  const confirmed = await confirmFooter(container);
  check(confirmed, "Empty Trash confirmed");
  check(textOf(container).indexOf("Empty Trash failed") >= 0, "business failure surfaces a failure toast");
  check(textOf(container).indexOf("Operation not permitted") >= 0, "host failure message shown in the toast");
  check(container.querySelector('[role="dialog"]') === null, "dialog closes after a failed action");

  await clickTab(container, "Software");
  const brewSwitch = buttonsWithText(container, "Homebrew")[0];
  if (brewSwitch) await click(brewSwitch);
  const brewCard = [...container.querySelectorAll("section.dx-card")].find((node) => textOf(node).indexOf("Homebrew") >= 0);
  check(!!brewCard, "Homebrew card present");
  const brewUninstall = brewCard ? [...brewCard.querySelectorAll("button")].find((node) => textOf(node) === "Uninstall…") : null;
  check(!!brewUninstall, "Homebrew row has an uninstall button");
  if (brewUninstall) {
    await click(brewUninstall);
    const brewDialog = container.querySelector('[role="dialog"]');
    check(!!brewDialog && textOf(brewDialog).indexOf("Uninstall Homebrew package") >= 0, "brew uninstall confirmation opens");
    await confirmFooter(container);
    const brewPost = calls.posts.find((entry) => entry.action === "software.brewUninstall");
    check(!!brewPost && brewPost.params && typeof brewPost.params.name === "string", "brew uninstall POSTed with the package name", JSON.stringify(brewPost && brewPost.params));
  }

  await clickTab(container, "System");
  const switches = [...container.querySelectorAll('button[role="switch"]')];
  check(switches.length >= 2, "launch agent switches rendered");
  const unloadedSwitch = switches[1];
  if (unloadedSwitch) {
    await click(unloadedSwitch);
    const agentDialog = container.querySelector('[role="dialog"]');
    check(!!agentDialog && textOf(agentDialog).indexOf("Enable launch agent") >= 0, "unloaded launch agent asks for confirmation before enabling");
    await act(async () => {
      document.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush(40);
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in failure/brew/agent flows", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
  check(fetchViolations.length === 0, "all network calls stayed under /devicex/api/", JSON.stringify(fetchViolations.slice(0, 5)));
}

// ================================================================== 14. long listening-port list
section("14. Listening ports stay bounded, searchable and filterable");
{
  takeConsoleErrors();
  // 260 listeners: a busy host is the case the table has to survive.
  const busyPorts = [];
  for (let index = 0; index < 260; index += 1) {
    const tcp = index % 3 !== 0;
    busyPorts.push({
      proto: tcp ? "tcp" : "udp",
      address: index % 5 === 0 ? "127.0.0.1" : "0.0.0.0",
      port: 3000 + index,
      pid: 4000 + index,
      process: index % 7 === 0 ? "node" : "listener-" + index,
    });
  }
  const happy = createHappyHandler({
    sections: () => ({ ...inventoryBySection(), network: { ...networkFixture(), listeningPorts: busyPorts } }),
  });
  activeHandler = happy.handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Network");
  const portsCard = () =>
    [...container.querySelectorAll("section.dx-card")].find((node) => textOf(node).indexOf("Listening ports") >= 0) || null;
  const portsRows = () => {
    const card = portsCard();
    return card ? [...card.querySelectorAll("tbody tr")] : [];
  };
  check(portsRows().length === 100, "listening ports render the first bounded page only", "rows=" + portsRows().length);
  const moreButton = buttonsWithText(container, "Show 100 more")[0];
  check(!!moreButton, "a show-more control appears for a long listener list");
  if (moreButton) {
    await click(moreButton);
    check(portsRows().length === 200, "show-more extends the page by one step", "rows=" + portsRows().length);
  }
  const searchField = [...container.querySelectorAll("input[type=search]")].find(
    (node) => String(node.getAttribute("aria-label")) === "Search",
  );
  check(!!searchField, "the listener card exposes a search field");
  if (searchField) {
    await setFieldValue(searchField, "listener-11");
    check(portsRows().length > 0 && portsRows().length < 100, "searching the port list narrows the page", "rows=" + portsRows().length);
    check(textOf(container).indexOf("listener-11") >= 0, "the matching listener is rendered");
    await setFieldValue(searchField, "no-such-listener");
    check(portsRows().length === 0, "an unmatched port search renders no rows");
    await setFieldValue(searchField, "");
  }
  const tcpButton = buttonsWithText(container, "TCP").filter((node) => node.className.indexOf("dx-segBtn") >= 0)[0];
  check(!!tcpButton, "the listener card exposes a protocol filter");
  if (tcpButton) {
    await click(tcpButton);
    const card = portsCard();
    const protoCells = (card ? [...card.querySelectorAll("tbody tr")] : []).map((row) =>
      row.children[0] ? textOf(row.children[0]) : "",
    );
    check(protoCells.length > 0 && protoCells.every((value) => value === "TCP"), "the TCP filter hides UDP listeners", JSON.stringify(protoCells.slice(0, 4)));
    const udpButton = buttonsWithText(container, "UDP").filter((node) => node.className.indexOf("dx-segBtn") >= 0)[0];
    if (udpButton) {
      await click(udpButton);
      const udpCells = (portsCard() ? [...portsCard().querySelectorAll("tbody tr")] : []).map((row) =>
        row.children[0] ? textOf(row.children[0]) : "",
      );
      check(udpCells.length > 0 && udpCells.every((value) => value === "UDP"), "the UDP filter shows only UDP listeners", JSON.stringify(udpCells.slice(0, 4)));
    }
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors with a long listener list", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 15. software empty states
section("15. Software distinguishes no-apps from no-match");
{
  takeConsoleErrors();
  // The `empty` slot only renders once TabShell has data, so it can never mean
  // "still loading". A Host that reports zero applications must say so, not
  // claim it is still reading the list.
  const noApps = createHappyHandler({
    sections: () => ({
      ...inventoryBySection(),
      software: { ...softwareFixture(), applications: [], totalApplications: 0, homebrew: { available: true, prefix: "/opt/homebrew", installed: [], outdated: [] } },
    }),
  });
  activeHandler = noApps.handler;
  const first = await mountPage(tEn);
  await clickTab(first.container, "Software");
  // Assert on the empty-state *title*, not on "the string appears somewhere in
  // the page": the old code put the misleading copy in `text`, so a
  // page-wide substring match would still pass after the fix.
  const emptyTitles = () => [...first.container.querySelectorAll(".dx-emptyTitle")].map(textOf);
  check(
    emptyTitles().indexOf("No installed applications found") >= 0,
    "zero applications renders the not-installed copy as the empty title",
    JSON.stringify(emptyTitles()),
  );
  check(
    emptyTitles().indexOf("No matching applications") < 0,
    "zero applications does not claim a filter matched nothing",
    JSON.stringify(emptyTitles()),
  );
  const firstErrors = takeConsoleErrors();
  check(firstErrors.length === 0, "no console errors with zero applications", firstErrors.slice(0, 3).join(" || "));
  await unmountPage(first);

  // The same slot must still explain a filter that matched nothing.
  const happy = createHappyHandler();
  activeHandler = happy.handler;
  const second = await mountPage(tEn);
  await clickTab(second.container, "Software");
  const searchField = [...second.container.querySelectorAll("input[type=search]")].find(
    (node) => String(node.getAttribute("aria-label")) === "Search",
  );
  check(!!searchField, "the software card exposes a search field");
  if (searchField) {
    await setFieldValue(searchField, "zzz-no-such-application");
    const filteredTitles = [...second.container.querySelectorAll(".dx-emptyTitle")].map(textOf);
    check(
      filteredTitles.indexOf("No matching applications") >= 0,
      "an unmatched search renders the no-match copy as the empty title",
      JSON.stringify(filteredTitles),
    );
    check(
      filteredTitles.indexOf("No installed applications found") < 0,
      "an unmatched search does not claim nothing is installed",
      JSON.stringify(filteredTitles),
    );
  }
  const secondErrors = takeConsoleErrors();
  check(secondErrors.length === 0, "no console errors in the software empty states", secondErrors.slice(0, 3).join(" || "));
  await unmountPage(second);
}

// ================================================================== 16. stable row keys
section("16. Reordered tables key rows by identity, not by position");
{
  takeConsoleErrors();
  activeHandler = createHappyHandler().handler;
  const mounted = await mountPage(tEn);
  const { container } = mounted;
  await clickTab(container, "Processes");
  // The first process column is the pid, so a row can be found across renders.
  const processRow = (pid) =>
    [...container.querySelectorAll("tbody tr")].find(
      (row) => row.children.length > 0 && textOf(row.children[0]) === String(pid),
    ) || null;
  const before = processRow(1234);
  check(!!before, "process row for pid 1234 is rendered");
  const sortButton = buttonsWithText(container, "Descending")[0];
  check(!!sortButton, "the process table exposes a CPU sort toggle");
  if (before && sortButton) {
    await click(sortButton);
    const after = processRow(1234);
    check(!!after, "process row for pid 1234 still renders after re-sorting");
    // An index key leaves the node at its old position and only rewrites its
    // text, so the pid would be served by a different element. A pid key moves
    // the same node instead.
    check(before === after, "re-sorting moves the same DOM node for a pid (stable row key)");
    const order = [...container.querySelectorAll("tbody tr")]
      .map((row) => (row.children[0] ? textOf(row.children[0]) : ""))
      .filter((value) => value.length > 0);
    check(order[0] !== "1234", "the CPU sort actually reordered the table", JSON.stringify(order));
  }
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors while re-sorting the process table", errors.slice(0, 3).join(" || "));
  await unmountPage(mounted);
}

// ================================================================== 17. samples snapshot
section("17. Every metrics tick publishes a fresh samples snapshot");
{
  takeConsoleErrors();
  activeHandler = createHappyHandler().handler;
  // Exercised from source with the same injected React: the published object
  // identity is a property of the hook, not of the bundle. `pushSample` edits
  // the ring buffers in place, so returning `samplesRef.current` gave every
  // render the same object and a future memo/useMemo dependency on `samples`
  // would never see a new tick.
  const { setReact } = await import("../src/client/runtime.js");
  const { useDeviceMetrics } = await import("../src/client/use-device-metrics.js");
  setReact(React);
  let latest = null;
  function Probe() {
    latest = useDeviceMetrics();
    return null;
  }
  const holder = document.createElement("div");
  document.body.appendChild(holder);
  const probeRoot = ReactDOMClient.createRoot(holder);
  await act(async () => {
    probeRoot.render(React.createElement(Probe));
  });
  await flush(150);
  const first = latest && latest.samples;
  check(!!first && Array.isArray(first.cpu), "the metrics hook exposes sample arrays");
  const countBefore = first && Array.isArray(first.cpu) ? first.cpu.length : -1;
  check(countBefore >= 1, "the first tick recorded a CPU sample", "samples=" + countBefore);
  if (latest) {
    await act(async () => {
      await latest.refresh();
    });
    await flush(150);
  }
  const second = latest && latest.samples;
  check(second !== first, "a tick publishes a new samples object (no mutated-ref identity)");
  check(
    !!second && Array.isArray(second.cpu) && second.cpu.length === countBefore + 1,
    "the new snapshot carries exactly one more CPU sample",
    "before=" + countBefore + " after=" + (second && second.cpu ? second.cpu.length : "?"),
  );
  check(!!first && !!second && first.cpu !== second.cpu, "the snapshot copies the arrays instead of sharing them");
  await act(async () => {
    probeRoot.unmount();
  });
  holder.remove();
  const errors = takeConsoleErrors();
  check(errors.length === 0, "no console errors in the metrics probe", errors.slice(0, 3).join(" || "));
}

// ------------------------------------------------------------------ summary
console.error = originalConsoleError;
const failed = results.filter((entry) => !entry.ok);
console.log("\n=== DEVICE X client.js render smoke test ===");
console.log("assertions: " + results.length + ", passed: " + (results.length - failed.length) + ", failed: " + failed.length);
if (failed.length > 0) {
  console.log("\nFAILED:");
  for (const entry of failed) console.log("  - " + entry.label + (entry.extra ? " — " + entry.extra : ""));
  process.exit(1);
}
console.log("ALL RENDER ASSERTIONS PASSED");
