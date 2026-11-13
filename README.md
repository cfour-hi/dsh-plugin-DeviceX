# Device X · dsh-plugin-devicex

简体中文 | [English](README.en.md)

[![verify](https://img.shields.io/github/actions/workflow/status/cfour-hi/dsh-plugin-devicex/verify.yml?branch=main&style=flat-square&label=verify)](https://github.com/cfour-hi/dsh-plugin-devicex/actions/workflows/verify.yml)
[![npm](https://img.shields.io/npm/v/%40cfour-hi%2Fdsh-plugin-devicex?style=flat-square&label=npm)](https://www.npmjs.com/package/@cfour-hi/dsh-plugin-devicex)
[![checks](https://img.shields.io/badge/checks-976%20passing-brightgreen?style=flat-square)](#验证与开发)
[![license](https://img.shields.io/github/license/cfour-hi/dsh-plugin-devicex?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%2010%2F11-555?style=flat-square)](#已知限制)

![Device X：整台机器，一页看清](docs/promo/banner-zh-1280x640.jpg)

一页中文/英文界面看尽本机硬件、系统、软件、网络、安全与进程，并对**非硬件**的一切直接操作——结束进程、
卸载应用并清理残留、改主机名/音量/深色模式、开关 Wi-Fi/防火墙、设 DNS、清空废纸篓、睡眠锁定……
还内置可确认的磁盘清理与可重复的本机基准测试。同一套能力以 `device_info` / `device_control` /
`device_benchmark` 三个工具暴露给 Agent 模型。

**平台**：macOS 与 Windows 10/11。Host 按 `process.platform` 选实现（`darwin` 用系统命令，`win32` 用
PowerShell/CIM），浏览器 UI、HTTP API、Agent 工具两端完全一致。
**入口**：左侧栏底部 **Device X** 图标 → 中央面板；仅使用主题 token 着色，跟随浅色/深色，支持
`prefers-reduced-motion`。失败动作只在对应卡片或弹窗内报错，不会让页面崩溃。

## 界面

> 截图为插件真实渲染，主机名、账号、序列号、MAC 与内网地址已替换或隐藏。

![总览](docs/images/overview.png)

![硬件](docs/images/hardware.png)

<p align="center">
  <img src="docs/images/network.png" width="49%" alt="网络标签页">
  <img src="docs/images/cleanup.png" width="49%" alt="清理标签页">
</p>

| 标签 | 内容 |
|---|---|
| 总览 | CSS 3D 设备核心、五个环形 KPI、火花线、Top 进程、派生告警 |
| 硬件 | CPU 与逐核、内存、图形与显示（GPU/显示器同卡）、磁盘、电池健康、温度与散热、驱动、连接设备（USB/蓝牙切换）、音频、摄像头 |
| 系统 | 系统与内核、型号序列号、运行时长、用户表、登录项与 LaunchAgents（可启停）、环境变量 |
| 软件 | 应用搜索/过滤/排序、定位、卸载（含[残留清理](#卸载残留清理)）；Homebrew / winget 列表（标题旁切换，可升级标签带悬停提示） |
| 网络 | 网卡、Wi-Fi 信号、DNS、默认路由、代理、TCP 监听与连接数；开关 Wi-Fi、设 DNS |
| 安全 | FileVault/SIP/Gatekeeper/TCC 或 BitLocker/Defender/UAC、防火墙、管理员、隐私设置页、刷新 DNS |
| 进程 | 可搜索排序的进程表，逐行结束（TERM/KILL/INT/STOP/CONT），二次确认 |
| 清理 | 扫描缓存/日志/废纸篓/开发缓存，显示体积与文件数；勾选后二次确认才删除 |
| 性能 | CPU 单/多核、内存带宽、磁盘读写；与上次运行对比，仅适合同机前后比较 |
| 操作 | 每个平台 19 个白名单动作按组呈现，表单由参数目录生成，危险动作二次确认，含操作历史 |

## 安装

```sh
# 从 GitHub 直接安装（对方无需本地源码）
dsh plugin --profile desktop add https://github.com/cfour-hi/dsh-plugin-devicex

# 本地目录或 tgz
npm run release:pack
dsh plugin --profile desktop add /绝对路径/cfour-hi-dsh-plugin-devicex-<version>.tgz
```

运行中的会话也可直接 `plugin_manager action=install_bundle target=<路径或仓库地址>` 热安装，无需重启。
仓库根的 `package.json` 是 Git 安装入口，`plugin/package.json` 供本地 link 与 tgz 使用，两份清单必须同步
（`verify.mjs` 会逐项检查）。前提条件、权限要求与卸载/更新步骤见 [docs/INSTALL.md](docs/INSTALL.md)。

## 能做什么

每个平台 19 个白名单动作（两端合计 20 个 id：`brewUninstall` 与 `wingetUninstall` 各属一端），
参数由目录生成并逐项校验，危险动作二次确认。

| 组 | 动作 | 说明 |
|---|---|---|
| process | `process.signal` | TERM/KILL/INT/STOP/CONT；拒绝 PID 1 与 Host 自身 |
| app | `app.quit` · `app.launch` · `app.reveal` · `app.uninstall` | 退出 / 启动 / 在文件管理器中显示 / 卸载（macOS 仅限三个应用目录并拒绝系统应用；Windows 接受 `msi:{GUID}`、`winget:<id>` 或卸载注册表键，不执行任意 shell 字符串） |
| system | `system.setHostname` · `setVolume` · `setDarkMode` · `launchAgent` · `openSettings` · `toggleFirewall` · `flushDNS` · `emptyTrash` · `cleanup.delete` | 主机名 / 音量 0–100 / 深色模式 / 启停 LaunchAgent 或启动项 / 打开 23 个系统设置面板 / 防火墙 / 刷新 DNS / 清空废纸篓或回收站 / 删除清理选中项 |
| network | `network.setWifiPower` · `setDns` | Wi-Fi 开关；设 0–4 个 DNS（接受服务名或网卡名） |
| power | `power.sleep` · `power.lock` | 睡眠 / 锁定 |
| software | `software.brewUninstall` · `software.wingetUninstall` | 卸载包管理器公式或包 |

Windows 用相同动作 id 的平台实现：`Stop-Process`、`Rename-Computer`、`ms-settings:`、
`Enable/Disable-NetAdapter`、`Set-DnsClientServerAddress`、`Clear-RecycleBin` 等。

**安全模型**：同源 `/devicex/api/*`，落在 DSH 的 Connection 信任栅栏之后（签名会话 cookie + Host/Origin
校验，未认证 401、异源 403）；子进程一律 `execFile` 参数数组，不经 shell；路径参数做根目录与后缀校验；
`cleanup.delete` 只接受扫描返回的固定 id，绝不接受路径（1–20 个、去重）；每次动作（含失败）进入 50 条
环形历史。

## 卸载残留清理

应用拖进废纸篓只删了 `.app`，数据仍留在 `~/Library`。卸载时会先扫描散落的数据目录，**列出来供逐项勾选**。

| 档位 | 依据 | 默认勾选 |
|---|---|---|
| A 高置信 | Bundle ID 匹配、MSIX 包容器、Homebrew cask `zap` 清单 | ✅ |
| B 名称候选 | 目录名像 App 名，且只匹配到一个已装应用 | ❌ |
| C 冲突候选 | 同一目录匹配到 ≥2 个已装应用 | ❌ |
| D 共享/受限 | 厂商级目录（`Google/`、`Microsoft/`）或需管理员权限 | 无复选框 |

B/C 展示但不默认勾选——本机实测 `Application Support/Claude-3p` 占 11 GB 却不含任何 bundle id，只有名称
启发式能发现它；藏起来等于替用户放弃 11 GB。弹窗底部固定显示「另有 N 项未选中（共 X）」。

三条不变式：**删除永不接受路径**——浏览器只拿条目 id，完整路径留在 Host 内存，`scanId` 一次性且绑定单次
扫描，`realpath` 后必须仍在允许的根列表内；**卸载失败即全局中止**，一个字节都不删，应用仍在运行时直接
拒绝；**一律移入废纸篓**，结果页写明「清空废纸篓后释放 X」。Windows 侧同样移入回收站，不提供永久删除。
扫描与令牌的完整设计见 [设计文档](docs/uninstall-footprint-design.md)。

## 给 Agent 与自动化

- `device_info`：`section` 取八个分区之一，`fresh` 绕过缓存。
- `device_control`：`action` + `params`，与 UI 走同一实现，不会出现两套逻辑。
- `device_benchmark`：`tests?`、`repeat?`，与「性能」页同一引擎。

UI 通过 `/devicex/api` 的 7 条同源路由取数（`metrics`、`inventory`、`actions`、`action`、`cleanup`、
`footprint`、`benchmark`；`cache-control: no-store`，业务失败仍 HTTP 200）。请求体、错误码与响应信封的
精确契约见 [build-contract](docs/build-contract.md)。

## 架构

```
plugin/
├── index.js              # Host 入口：warmup + 7 条路由 + 3 个工具
├── host/
│   ├── collector*.js     # 平台采集（系统命令 / PowerShell+CIM），TTL 缓存与预热
│   ├── actions*.js       # 每个平台 19 个白名单动作
│   ├── cleanup*.js       # 白名单清理扫描与删除
│   ├── footprint*.js     # 残留扫描：纯内核 + 平台实现 + 一次性令牌
│   ├── uninstall.js      # 卸载流水线（校验门禁、失败零副作用）
│   ├── benchmark.js      # CPU/内存/磁盘基准（worker_threads）
│   ├── win.js + win/*.ps1 # PowerShell 桥与七个只读采集脚本
│   ├── transport.js      # 路由注册 + 信任栅栏 + JSON 信封
│   └── tool.js           # 三个 Agent 工具的 schema 与渲染
└── client.js             # 构建产物（勿手改，改源码后 npm run build）

src/client/               # 浏览器端 TSX 源码（10 个标签页 + 43 个组件）
```

浏览器端由 esbuild 打成单文件 IIFE（227 KB，只向 loader 要一次 `react`），提交的 `plugin/client.js`
自包含、运行时零依赖；无打包器环境可用 `npm run build:concat` 生成等价产物（335 KB）。
[types/contracts.ts](types/contracts.ts) 是纯类型文件，定义 Host ↔ API ↔ 客户端的冻结形状。

## 验证与开发

```sh
npm run verify:ci    # 一条命令跑完全部关卡（等价 CI）
```

分开跑时：`npm test`（121 项单测）、`verify.mjs`（93 项通用回归）、`verify-windows.mjs`（173 项，
含 1 项仅在 Windows 上执行的桥接实机回归）、`verify-sensors.mjs`（Windows 46 / macOS 57 项温度与驱动）、
`verify-cleanup.mjs`（Windows 108 / macOS 130 项，沙箱删除）、`verify-benchmark.mjs`（46 项）、
`verify-footprint.mjs`（Windows 66 / macOS 72 项残留）、`render-check.mjs`（282 条渲染断言）。
macOS 多出的条目是只有真机能跑的实机探测；在 Windows 上它们报告 SKIP 而不是失败。
`verify:ci` 另外强制 `build-client --check`、`typecheck` 与产物校验，所以**过期产物过不了 CI**。

`verify-footprint.mjs` 把实测踩到的坑固化成回归：Team ID 前缀、`Claude-3p` 名称匹配、厂商目录误报、
令牌单次使用与跨 scan 混用、卸载失败零副作用、`moveToTrash` 不覆盖已有条目。

改 `plugin/` 后重跑 `install_bundle` 或重启 Harness；改 UI 请改 `src/client/` 再 `npm run build`，然后
`npm run verify:ci`。

## 已知限制

- **Windows 已在真机验证，但只验证过一台机器**：Windows 10 22H2 + Windows PowerShell 5.1 上跑通了
  采集、动作目录、回收站移入/还原与卸载流水线；其他版本、ARM 设备、非中文/非英文系统仍可能有 CIM
  字段差异，失败会如实返回命令错误而不是假装成功。
- **Windows 的 winget 卸载只以退出码为准**：winget 没有可观察的注册表记录，`winget list` 在本机要 ~15 秒
  且需要接受源协议，所以 MSI/注册表卸载以注册表项消失为校验门槛，winget 卸载只能信退出码。
- **Windows 的慢变字段最多陈旧 30 秒**：CPU 型号、默认路由、Wi-Fi、电池、进程属主与 GPU 温度走 30 秒
  的旁路探测，快速轮询（约 2.2–2.5 秒一次）只保证内存、磁盘、字节计数、温度区与高占用进程是新的。
- 需要管理员权限的动作（改主机名、防火墙、系统启动项、DNS、Wi-Fi 开关）失败时会把命令错误原样返回，
  不会假装成功。
- macOS 自动化授权（退出应用、深色模式、锁定屏幕）首次调用可能被 TCC 拒绝；Apple Silicon 默认不向
  普通用户公开 CPU/GPU 温度，`thermal.cpuCelsius` 为 `null` 并给出 `note`，不伪造温度。
- 清理与残留：`~/.Trash` 与部分系统缓存受 TCC 保护，扫描如实返回 `EPERM`；流水线不依赖枚举废纸篓，
  也不承诺「随时可还原」。
- 基准分数只适合同一台机器前后对比，不能与跑分软件横向比较；机器负载会影响单次结果。
- 端口列表仅含 TCP LISTEN；非管理员看不到部分系统进程的端口。

## 许可证

[MIT](LICENSE) © 2026 cfour-hi。仓库根 `LICENSE` 是唯一来源，`plugin/LICENSE` 是随包副本，须逐字节一致。

---

更多细节：[构建契约](docs/build-contract.md) · [Windows 契约](docs/windows-contract.md) ·
[发布流程](docs/RELEASE.md) · [安装指南](docs/INSTALL.md)
