# Device X 社交发布素材

本目录的图片由 `promo/build-promo.mjs` 生成（`banner-*.jpg` 是单独制作的设计稿，不在该流水线内），截图来自
插件的真实界面（jsdom 挂载 + 无头 Chrome 渲染），
数据为合成演示数据：**主机名、账号、序列号、MAC、SSID、内网地址均在生成前替换**（`promo/capture-ui.mjs`
里的 privacy scrub 会做最后一道检查，缺一项就构建失败）。因此图片可以直接公开发布。

## 图片清单

| 文件 | 尺寸 | 建议用途 |
|---|---|---|
| `banner-zh-1280x640.jpg` · `banner-en-1280x640.jpg` | 1280×640 | 仓库 README 顶部横幅、GitHub Social Preview |
| `banner-zh-2172x1086.jpg` · `banner-en-2172x1086.jpg` | 2172×1086 | 同款横幅的 2× 版（大尺寸头图、文章配图） |
| `hero-zh-1200x630.jpg` | 2400×1260（2×） | 微博头图、公众号封面、GitHub Social Preview、横版信息流 |
| `hero-en-1200x630.jpg` | 2400×1260（2×） | X / Twitter、Product Hunt、英文社区 |
| `square-zh-1080x1080.jpg` | 2160×2160（2×） | 朋友圈、小红书方图、微博配图 |
| `story-zh-1080x1440.jpg` | 2160×2880（2×） | 小红书 3:4 首图/内页、抖音图文 |
| `../images/overview.png` | 2400×1500 | 文章/README 内的总览截图 |
| `../images/hardware.png` | 2400×1500 | 文章内的硬件/温度/驱动截图 |
| `../images/network.png` | 2400×1500 | 文章内的网络/DNS 截图 |
| `../images/cleanup.png` | 2400×1500 | 文章内的清理截图 |

> 社交卡片是 2× 导出，上传后由平台自行压缩；如果平台限制单图大小，用 `sips -Z 1600` 缩小即可。
> 重新生成：`node promo/capture-ui.mjs && node promo/build-promo.mjs`（需要 Node、jsdom 与本机 Chrome）。

## 一句话介绍

- **中文**：Device X 是一个 DSH 插件，把整台电脑的硬件、系统、网络、安全、进程、清理和跑分收进一页面板，并提供 19 个白名单动作与 3 个 Agent 工具。
- **English**: Device X is a DSH plugin that puts every part of your machine — hardware, system, network, security, processes, cleanup and benchmarks — into one panel, with 19 guarded actions and 3 agent tools.

## 小红书

**标题**：把 Mac 装进一页面板 🖥️

**正文**：

给 DSH 写了个设备面板 Device X，装完的瞬间感觉这台 Mac 被摊开在桌面上。

🖥️ **10 个标签页**
硬件：CPU 逐核 / 内存 / GPU / 屏幕 / 硬盘 / 电池健康 / 温度 / 驱动
网络：Wi-Fi、DNS、路由、监听端口，直接开关
安全：FileVault、SIP、Gatekeeper、防火墙、隐私权限
还有系统、软件、进程、清理、性能、操作……日常折腾的入口基本都在。

🎛️ **19 个白名单动作**
结束进程、退出/卸载应用、启停登录项、改主机名/音量/深色模式、开关 Wi-Fi/防火墙、设 DNS、清空废纸篓、睡眠/锁定。危险动作会二次确认，失败只在卡片里报错。

🤖 **3 个 Agent 工具**
`device_info` / `device_control` / `device_benchmark`，和面板共用同一套实现——面板里能做的，Agent 也能做。

macOS + Windows，MIT 开源。
装法：DSH → Plugins → 粘贴仓库地址。
github.com/cfour-hi/dsh-plugin-devicex

#Mac #macOS #效率工具 #开源 #程序员 #系统工具 #DSH

## 微博

把整台电脑装进一页面板 👀

Device X：DSH 的 macOS / Windows 设备面板插件。
10 个标签页看硬件、系统、网络、安全、进程、清理与跑分；19 个白名单动作可以直接操作；3 个 Agent 工具让模型也能读设备、动手改。

MIT 开源，装完即用：
github.com/cfour-hi/dsh-plugin-devicex

#macOS# #Windows# #效率工具# #开源#

配图建议：`hero-zh-1200x630.jpg` + `square-zh-1080x1080.jpg` + 两张 README 截图（四宫格）。

## 朋友圈

最近给自己的 Mac 做了一块「仪表盘」：硬件、温度、电池、DNS、进程、驱动、清理和跑分全在一个面板里，Wi-Fi / DNS / 进程这些还能直接改。DSH 插件，macOS + Windows，开源 MIT。折腾电脑的朋友可以试试：
github.com/cfour-hi/dsh-plugin-devicex

配图：`square-zh-1080x1080.jpg`（或 `hero-zh-1200x630.jpg`）。

## 即刻

DSH 插件 Device X：把 macOS / Windows 的硬件、网络、安全、进程、清理和跑分收进一个面板，同时暴露成 3 个 Agent 工具（`device_info` / `device_control` / `device_benchmark`）。

19 个动作全部白名单 + 参数校验，危险操作二次确认；采集和操作都在本机完成，UI 和 Agent 共用同一套实现。

MIT 开源：github.com/cfour-hi/dsh-plugin-devicex

## V2EX / 技术社区

**标题**：[分享] 给 DSH 写了个设备面板：10 个标签页、19 个白名单动作、3 个 Agent 工具

**正文**：

链接：https://github.com/cfour-hi/dsh-plugin-devicex

DSH（DeepSeek Harness）插件。装上后左侧栏多一个 Device X 图标，打开是一页系统面板：

- 总览：纯 CSS 3D 设备核心 + 5 个环形 KPI + 火花线 + Top 进程
- 硬件：CPU 逐核、内存、GPU、显示器、磁盘、电池、温度、驱动、USB/蓝牙/音频/摄像头
- 系统 / 软件 / 网络 / 安全 / 进程 / 清理 / 性能 / 操作
- 清理：先扫描、再勾选、二次确认才删除；只接受扫描返回的固定 id，不接受任意路径
- 性能：固定工作量的 CPU / 内存 / 磁盘基准，同一台机器前后对比

实现上，Host 侧按 `process.platform` 分发 macOS 系统命令与 PowerShell/CIM；19 个动作是白名单 id + 严格参数校验，子进程走 `execFile` 参数数组、不经 shell；浏览器通过同源 `/devicex/api/*` 走 DSH 的信任栅栏；UI 和 Agent 工具共用同一套动作实现，不会出现两套逻辑。

macOS 实机验证；Windows 目前是真实 CIM fixture + `.ps1` 静态检查 + 模拟 Host 端到端验证，还没在 Windows 实机上跑过，欢迎反馈。

安装：DSH → Plugins → 粘贴仓库地址，或
`dsh plugin --profile desktop add https://github.com/cfour-hi/dsh-plugin-devicex`

## X / Twitter

Your Mac has the answers — they're just scattered across 10 different system apps.

Device X is a DSH plugin that puts hardware, network, security, processes, cleanup and benchmarks into one panel — then exposes the same actions to your agent.

10 panels · 19 guarded actions · 3 agent tools
macOS + Windows · MIT

github.com/cfour-hi/dsh-plugin-devicex

#macOS #opensource #devtools

配图：`hero-en-1200x630.jpg`。

## GitHub Release / 项目简介

> Device X turns the whole machine into one panel: hardware, system, software, network, security,
> processes, cleanup and benchmarks. It also ships 19 whitelisted actions and three agent tools
> (`device_info` / `device_control` / `device_benchmark`) that share the exact same implementation
> as the UI. macOS + Windows, MIT.

## 发布注意

- **图片已脱敏**：画面中的 `Demo-Mac.local`、`/Users/demo`、`10.0.0.12`、`C02DEMO123` 等都是演示数据；
  不要换成自己的真实截图再发。
- **版本号**：图片和文案对应 v1.9.0；发版后如果改了数字，重新跑构建脚本。
- **平台差异**：macOS 为实机验证；Windows 为离线 fixture + 静态检查 + 模拟 Host 端到端验证，
  公开文案可以写「支持 Windows」，但遇到 Windows 具体问题请如实说明这是已知验证边界。
- **权限预期**：改主机名、防火墙、系统级启动项、DNS、Wi-Fi 开关等动作需要管理员权限；
  首次调用可能被 macOS TCC 拦截，插件会如实返回错误，不会假装成功。
- **隐私措辞**：采集与面板读取都在本机完成；如果通过 Agent 工具读取设备信息，内容会进入当前会话上下文，
  对外表达时不要写成「任何情况下都不离开本机」。
