// Deterministic headless-Chrome screenshots through the DevTools protocol.
//
//   node promo/shot-cdp.mjs <file-or-url> <out.png> [width=1440] [height=900] [scale=2]
//
// The CLI `--screenshot` captures the outer window (which keeps a slice of
// window chrome below the page) and, when the page is taller than the viewport,
// stitches a full-page image — duplicated composited layers (the blurred
// header) ended up at the bottom. A CDP viewport override + Page.captureScreenshot
// gives exactly width*scale × height*scale pixels of the page viewport.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const CHROME = path.join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const FALLBACK_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function readPort(userDataDir) {
  const file = path.join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(file)) {
      const [port, wsPath] = fs.readFileSync(file, "utf8").split("\n");
      if (port && wsPath) return { port: Number(port), wsPath: wsPath.trim() };
    }
    await delay(100);
  }
  throw new Error("Chrome did not expose a DevTools port");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    const events = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((done, fail) => {
          const id = (nextId += 1);
          pending.set(id, { done, fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      once(name) {
        return new Promise((done) => {
          const queue = events.get(name) || [];
          queue.push(done);
          events.set(name, queue);
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data);
      if (payload.id && pending.has(payload.id)) {
        const entry = pending.get(payload.id);
        pending.delete(payload.id);
        if (payload.error) entry.fail(new Error(payload.error.message));
        else entry.done(payload.result);
        return;
      }
      if (payload.method) {
        const queue = events.get(payload.method);
        if (queue && queue.length > 0) queue.shift()(payload.params);
      }
    });
  });
}

export async function capturePanel(source, outFile, width = 1440, height = 900, scale = 2) {
  const url = /^[a-z]+:\/\//i.test(source) ? source : pathToFileURL(path.resolve(source)).href;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dx-shot-"));
  const binary = fs.existsSync(CHROME) ? CHROME : FALLBACK_CHROME;
  const chrome = spawn(binary, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--disable-extensions", "--remote-debugging-port=0", "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    const { port } = await readPort(userDataDir);
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const session = await connect(page.webSocketDebuggerUrl);
    try {
      await session.send("Page.enable");
      await session.send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: scale, mobile: false,
      });
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url });
      await loaded;
      // Web fonts and the injected stylesheet settle after load.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const status = await session.send("Runtime.evaluate", {
          expression: "document.fonts ? document.fonts.status : 'loaded'",
          returnByValue: true,
        });
        if (status.result && status.result.value === "loaded") break;
        await delay(100);
      }
      await delay(400);
      const shot = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
    } finally {
      session.close();
    }
  } finally {
    chrome.kill("SIGKILL");
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, out, width, height, scale] = process.argv.slice(2);
  if (!source || !out) {
    console.error("usage: node promo/shot-cdp.mjs <file-or-url> <out.png> [width] [height] [scale]");
    process.exit(1);
  }
  await capturePanel(source, out, Number(width) || 1440, Number(height) || 900, Number(scale) || 2);
  console.log("wrote", out);
}
