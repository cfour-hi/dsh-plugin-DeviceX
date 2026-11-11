// Build the social-media cards and README screenshots.
//
//   node promo/build-promo.mjs            # capture + cards
//   node promo/build-promo.mjs --cards     # cards only (reuse promo/capture/*.png)
//
// All screenshots are rendered from the plugin's real UI with synthetic demo data
// (see capture-ui.mjs); hostname, account, serials, MACs and LAN addresses are
// replaced before the pixels are produced.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const buildDir = path.join(here, "build");
const shotDir = path.join(here, "capture");
const outDir = path.join(root, "docs/promo");
const readmeDir = path.join(root, "docs/images");
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(readmeDir, { recursive: true });

const CHROME = path.join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

const iconSvg = fs.readFileSync(path.join(root, "plugin/icon.svg"), "utf8")
  .replace(/<\?xml[^>]*\?>/g, "")
  .replace(/<svg /, '<svg class="mark" ');
const iconData = "data:image/svg+xml;base64," + Buffer.from(iconSvg).toString("base64");
const shot = (name) => "data:image/png;base64," + fs.readFileSync(path.join(shotDir, name + ".png")).toString("base64");

const SHOTS = { overview: shot("overview"), hardware: shot("hardware"), cleanup: shot("cleanup"), network: shot("network") };

const FONT = `-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","PingFang SC","Hiragino Sans GB","Helvetica Neue",Arial,sans-serif`;
const MONO = `"SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

function card({ id, width, height, css, body, image }) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Device X · ${id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:#05070f}
body{font-family:${FONT};color:#f2f5ff;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.card{position:relative;width:${width}px;height:${height}px;overflow:hidden;isolation:isolate;
  background:
    radial-gradient(900px 620px at 82% 12%, rgba(86,134,254,.22), transparent 62%),
    radial-gradient(760px 560px at 8% 92%, rgba(122,77,255,.20), transparent 64%),
    linear-gradient(145deg,#070b18 0%,#0a1024 52%,#060912 100%);
}
.card::after{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);
  background-size:52px 52px;
  -webkit-mask-image:radial-gradient(120% 90% at 60% 30%,#000 0%,transparent 78%);
  mask-image:radial-gradient(120% 90% at 60% 30%,#000 0%,transparent 78%);
  opacity:.55;
}
.grain{position:absolute;inset:0;pointer-events:none;z-index:9;opacity:.06;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>")}
.brand{display:flex;align-items:center;gap:14px}
.mark{width:52px;height:52px;filter:drop-shadow(0 8px 22px rgba(86,134,254,.35))}
.wordmark{font-size:26px;font-weight:750;letter-spacing:-.02em;line-height:1}
.brandSub{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:#8fa1c7;margin-top:5px;font-weight:600}
.eyebrow{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#7fd7ff;font-weight:650}
.h1{font-weight:800;letter-spacing:-.035em;line-height:1.06}
.h1 .grad{background:linear-gradient(92deg,#6ea8ff 0%,#9d7bff 55%,#63e6ff 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#aab6d2;font-weight:450}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;height:36px;padding:0 15px;border-radius:999px;font-size:14px;font-weight:600;color:#dbe4ff;
  background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(6px)}
.chip b{color:#fff}
.pill{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:999px;font-size:12.5px;font-weight:600;color:#c9d6ff;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}
.dot{width:7px;height:7px;border-radius:50%;background:#63e6ff;box-shadow:0 0 0 4px rgba(99,230,255,.16)}
.footer{position:absolute;left:64px;right:64px;bottom:30px;display:flex;align-items:center;justify-content:space-between;color:#8190b3;font-size:13px;z-index:5}
.footer .repo{font-family:${MONO};font-size:12.5px;color:#9fb2de}
.footer .demoNote{color:#9fb0d4;font-size:12px;letter-spacing:.02em;padding:5px 10px;border-radius:999px;background:rgba(6,10,20,.62);border:1px solid rgba(255,255,255,.09)}
.win{border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:#0a0d15;
  box-shadow:0 40px 100px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.03) inset}
.winBar{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#111523;border-bottom:1px solid rgba(255,255,255,.07)}
.winBar i{width:9px;height:9px;border-radius:50%;background:#3a4258}
.winBar i:nth-child(1){background:#ff5f57}.winBar i:nth-child(2){background:#febc2e}.winBar i:nth-child(3){background:#28c840}
.winName{margin-left:8px;font-size:11px;color:#93a1c2;font-family:${MONO}}
.winTag{margin-left:auto;font-size:11px;color:#8190b3;letter-spacing:.02em}
.win img{display:block;width:100%;height:auto}
${css}
</style></head><body><div class="card">${body}<div class="grain"></div></div></body></html>`;
  const htmlPath = path.join(buildDir, id + ".html");
  fs.writeFileSync(htmlPath, html);
  const pngPath = path.join(buildDir, id + ".png");
  const jpgPath = path.join(outDir, id + ".jpg");
  try {
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
      "--force-device-scale-factor=2", `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`, `--user-data-dir=/tmp/dx-promo-${process.pid}`,
      "file://" + htmlPath,
    ], { stdio: "ignore" });
  } catch (error) {
    // Chrome for Testing exits 2 after writing a valid screenshot on some macOS
    // builds ("teardown watchdog expired"); only a missing file is fatal.
    if (!fs.existsSync(pngPath)) throw error;
  }
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", pngPath, "--out", jpgPath], { stdio: "ignore" });
  console.log("card", path.relative(root, jpgPath));
}

// ------------------------------------------------------------------ 1. hero zh
card({
  id: "hero-zh-1200x630", width: 1200, height: 630,
  css: `
.heroShot{position:absolute;inset:-12% -10% -18% 26%;background:url(${SHOTS.overview}) center 12%/cover no-repeat;
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.35) 18%,#000 46%);mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.35) 18%,#000 46%)}
.heroVeil{position:absolute;inset:0;background:linear-gradient(90deg,#060a14 0%,rgba(6,10,20,.96) 30%,rgba(6,10,20,.72) 46%,rgba(6,10,20,.18) 68%,rgba(6,10,20,.38) 100%),linear-gradient(180deg,rgba(6,10,20,.45),transparent 26%,transparent 70%,rgba(6,10,20,.8))}
.top{position:absolute;top:44px;left:64px;right:64px;display:flex;align-items:flex-start;justify-content:space-between;z-index:3}
.copy{position:absolute;left:64px;top:150px;width:640px;z-index:4}
.copy .h1{font-size:74px;margin:16px 0 18px}
.copy .sub{font-size:18.5px;line-height:1.55;max-width:560px}
.copy .chips{margin-top:24px}
.footer{bottom:26px}
`,
  body: `
<div class="heroShot"></div><div class="heroVeil"></div>
<div class="top">
  <div class="brand"><img class="mark" src="${iconData}"><div><div class="wordmark">Device X</div><div class="brandSub">DSH Plugin · 设备智能</div></div></div>
  <div class="pill"><span class="dot"></span>v1.5.0 · macOS / Windows</div>
</div>
<div class="copy">
  <div class="eyebrow">See everything · Control anything</div>
  <div class="h1">把整台电脑<br><span class="grad">装进一页面板</span></div>
  <div class="sub">硬件、系统、软件、网络、安全、进程、清理与跑分。<br>看得到，也改得动。</div>
  <div class="chips"><span class="chip"><b>10</b> 个面板</span><span class="chip"><b>19</b> 个白名单动作</span><span class="chip"><b>3</b> 个 Agent 工具</span></div>
</div>
<div class="footer"><span class="repo">github.com/cfour-hi/dsh-plugin-devicex</span><span class="demoNote">真实界面渲染 · 演示数据</span></div>
`,
});

// ------------------------------------------------------------------ 2. hero en
card({
  id: "hero-en-1200x630", width: 1200, height: 630,
  css: `
.heroShot{position:absolute;inset:-12% -10% -18% 28%;background:url(${SHOTS.hardware}) center 10%/cover no-repeat;
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.35) 18%,#000 46%);mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.35) 18%,#000 46%)}
.heroVeil{position:absolute;inset:0;background:linear-gradient(90deg,#060a14 0%,rgba(6,10,20,.96) 30%,rgba(6,10,20,.72) 47%,rgba(6,10,20,.16) 70%,rgba(6,10,20,.4) 100%),linear-gradient(180deg,rgba(6,10,20,.45),transparent 26%,transparent 70%,rgba(6,10,20,.82))}
.top{position:absolute;top:44px;left:64px;right:64px;display:flex;align-items:flex-start;justify-content:space-between;z-index:3}
.copy{position:absolute;left:64px;top:150px;width:660px;z-index:4}
.copy .h1{font-size:76px;margin:16px 0 18px;letter-spacing:-.045em}
.copy .sub{font-size:18px;line-height:1.55;max-width:590px}
.copy .chips{margin-top:24px}
.footer{bottom:26px}
`,
  body: `
<div class="heroShot"></div><div class="heroVeil"></div>
<div class="top">
  <div class="brand"><img class="mark" src="${iconData}"><div><div class="wordmark">Device X</div><div class="brandSub">DSH Plugin · Device Intelligence</div></div></div>
  <div class="pill"><span class="dot"></span>v1.5.0 · macOS / Windows</div>
</div>
<div class="copy">
  <div class="eyebrow">Inspect · Understand · Control</div>
  <div class="h1">Your whole Mac.<br><span class="grad">One panel.</span></div>
  <div class="sub">Hardware, network, security, processes, cleanup and benchmarks — readable in one place, and controllable from the same place.</div>
  <div class="chips"><span class="chip"><b>10</b> panels</span><span class="chip"><b>19</b> guarded actions</span><span class="chip"><b>3</b> agent tools</span></div>
</div>
<div class="footer"><span class="repo">github.com/cfour-hi/dsh-plugin-devicex</span><span class="demoNote">real UI · demo data</span></div>
`,
});

// ------------------------------------------------------------------ 3. square zh
card({
  id: "square-zh-1080x1080", width: 1080, height: 1080,
  css: `
.glow{position:absolute;width:560px;height:560px;border-radius:50%;filter:blur(90px);z-index:0}
.g1{left:-160px;top:-180px;background:rgba(47,107,255,.35)}
.g2{right:-180px;top:180px;background:rgba(122,77,255,.28)}
.wrap{position:relative;z-index:3;padding:56px 56px 0}
.head{display:flex;align-items:center;justify-content:space-between}
.h1{font-size:86px;margin-top:58px;letter-spacing:-.045em;line-height:1.04}
.sub{font-size:20.5px;color:#a9b6d3;margin-top:18px;line-height:1.5}
.stats{display:flex;gap:14px;margin-top:30px}
.stat{flex:1;padding:17px 20px;border-radius:16px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.11)}
.stat b{display:block;font-size:32px;letter-spacing:-.03em;background:linear-gradient(92deg,#8ab4ff,#c3a6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{font-size:12.5px;color:#93a2c4;letter-spacing:.06em}
.repoLine{margin-top:16px;font-family:${MONO};font-size:12px;color:#7f8fb4}
.shot{position:absolute;left:56px;right:56px;top:604px;height:476px;border-radius:18px 18px 0 0;overflow:hidden;
  border:1px solid rgba(255,255,255,.16);border-bottom:0;background:#0a0d15;
  box-shadow:0 -20px 70px rgba(0,0,0,.35),0 30px 90px rgba(0,0,0,.6)}
.shot::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 62%,rgba(6,9,18,.4) 100%)}
.shot img{width:100%;display:block}
`,
  body: `
<div class="glow g1"></div><div class="glow g2"></div>
<div class="wrap">
  <div class="head">
    <div class="brand"><img class="mark" src="${iconData}"><div><div class="wordmark">Device X</div><div class="brandSub">DSH Plugin</div></div></div>
    <div class="pill"><span class="dot"></span>macOS + Windows</div>
  </div>
  <div class="h1">一台电脑<br><span class="grad">十个面板</span></div>
  <div class="sub">从硬件温度到 DNS，从进程到废纸篓。<br>一页看尽，白名单内直接操作。</div>
  <div class="stats">
    <div class="stat"><b>10</b><span>标签页</span></div>
    <div class="stat"><b>19</b><span>白名单动作</span></div>
    <div class="stat"><b>3</b><span>Agent 工具</span></div>
  </div>
  <div class="repoLine">github.com/cfour-hi/dsh-plugin-devicex</div>
</div>
<div class="shot">
  <div class="winBar"><i></i><i></i><i></i><span class="winName">Device X — 硬件</span><span class="winTag">温度 · 驱动 · 电池 · 显示器</span></div>
  <img src="${SHOTS.hardware}">
</div>
`,
});

// ------------------------------------------------------------------ 4. story zh
card({
  id: "story-zh-1080x1440", width: 1080, height: 1440,
  css: `
.glow{position:absolute;border-radius:50%;filter:blur(100px);z-index:0}
.g1{width:620px;height:620px;left:-220px;top:-220px;background:rgba(47,107,255,.32)}
.g2{width:540px;height:540px;right:-200px;top:340px;background:rgba(122,77,255,.3)}
.top{position:relative;z-index:3;padding:56px 56px 0}
.h1{font-size:80px;margin-top:52px;letter-spacing:-.045em;line-height:1.05}
.sub{font-size:20px;color:#a9b6d3;margin-top:16px;line-height:1.55;max-width:760px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:11px 10px;margin-top:28px;max-width:660px}
.tab{display:flex;align-items:center;gap:10px;font-size:16px;color:#cdd8f2}
.tab i{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,#6ea8ff,#9d7bff);box-shadow:0 0 10px rgba(110,168,255,.6)}
.shot{position:absolute;left:56px;right:56px;top:648px;height:642px;border-radius:18px;overflow:hidden;
  border:1px solid rgba(255,255,255,.16);box-shadow:0 40px 110px rgba(0,0,0,.7)}
.shot img{width:100%;display:block}
.shot::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 58%,rgba(6,9,18,.62) 100%)}
.footer{left:56px;right:56px;bottom:34px}
.footer .big{font-size:14px;color:#d7e1fb;font-weight:600;letter-spacing:.01em}
.footer .repo{font-size:12px}
`,
  body: `
<div class="glow g1"></div><div class="glow g2"></div>
<div class="top">
  <div class="head" style="display:flex;align-items:center;justify-content:space-between">
    <div class="brand"><img class="mark" src="${iconData}"><div><div class="wordmark">Device X</div><div class="brandSub">DSH Plugin · v1.5.0</div></div></div>
    <div class="pill"><span class="dot"></span>开源 MIT</div>
  </div>
  <div class="h1">你的设备，<br><span class="grad">一眼看尽</span></div>
  <div class="sub">硬件、系统、软件、网络、安全、进程、清理、跑分，十个标签页收进一个面板。</div>
  <div class="tabs">
    <div class="tab"><i></i>总览 Overview</div><div class="tab"><i></i>硬件 Hardware</div>
    <div class="tab"><i></i>系统 System</div><div class="tab"><i></i>软件 Software</div>
    <div class="tab"><i></i>网络 Network</div><div class="tab"><i></i>安全 Security</div>
    <div class="tab"><i></i>进程 Processes</div><div class="tab"><i></i>清理 Cleanup</div>
    <div class="tab"><i></i>性能 Benchmark</div><div class="tab"><i></i>操作 Actions</div>
  </div>
</div>
<div class="shot">
  <div class="winBar"><i></i><i></i><i></i><span class="winName">Device X — 总览</span><span class="winTag">真实界面渲染 · 演示数据</span></div>
  <img src="${SHOTS.overview}">
</div>
<div class="footer"><span class="big">19 个白名单动作 · 危险操作二次确认</span><span class="repo">github.com/cfour-hi/dsh-plugin-devicex</span></div>
`,
});

// ------------------------------------------------------------------ README stills
// Full-bleed panels without marketing copy, downsized to a sane repo footprint.
for (const [src, dest, width] of [
  ["overview", "overview", 2400],
  ["hardware", "hardware", 2400],
  ["cleanup", "cleanup", 2400],
  ["network", "network", 2400],
]) {
  const target = path.join(readmeDir, dest + ".png");
  execFileSync("sips", ["-Z", String(width), path.join(shotDir, src + ".png"), "--out", target], { stdio: "ignore" });
  console.log("readme", path.relative(root, target));
}

console.log("done");
