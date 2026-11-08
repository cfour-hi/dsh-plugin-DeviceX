# Device X · dsh-plugin-DeviceX

一个持久化的 **DSH 插件**：用一页优雅的中文/英文界面看尽当前设备的一切——硬件、系统、软件、
网络、安全与权限、进程、温度与散热、驱动清单——并对**非硬件**的一切直接操作（结束进程、退出/启动/
卸载应用、启停登录项、修改主机名/音量/深色模式、开关 Wi-Fi/防火墙、设置 DNS、卸载 Homebrew/winget 包、
清空废纸篓、睡眠/锁定、跳转系统设置……）。还内置**可确认的清理**与**可重复的本机基准测试**。
同一套能力同时暴露给 Agent 模型，作为 `device_info` / `device_control` / `device_benchmark` 三个工具。

- **平台**：**macOS** 与 **Windows 10/11**。Host 采集/动作按 `process.platform` 自动选择实现
  （`darwin` 用系统命令，`win32` 用 PowerShell/CIM）；浏览器 UI、HTTP API、Agent 工具在两个平台完全一致。

- 已安装到当前 `desktop` profile（本地 link 安装，包目录 `plugin/`），安装结果 `application: applied`；
  也支持把 GitHub 仓库地址直接当安装目标（仓库根 `package.json` 是 Git 安装入口，见
  [分享给其他人安装](#分享给其他人安装)）。
- UI 入口：左侧栏底部的 **Device X 面板图标**（在 Plugins、Schedules 图标之后）→ 中央主面板。
- 失败动作只在对应卡片/弹窗内报错，不会让页面或插件崩溃。

## 界面

十个标签页，跟随 DSH 主题（浅色/深色）、仅使用主题 token 着色，支持 `prefers-reduced-motion`：

| 标签 | 内容 |
|---|---|
| 总览 Overview | 纯 CSS 3D 设备核心（分层芯片 + 轨道环 + 粒子）、CPU/内存/磁盘/电池/网络五个 SVG 环形 KPI、60 点火花线、Top 进程、派生告警、内存构成条 |
| 硬件 Hardware | CPU 与逐核占用、统一内存/内存条、GPU、显示器、物理磁盘与卷、电池健康、**温度与散热**、**驱动/内核扩展（只读）**、USB、蓝牙、音频、摄像头 |
| 系统 System | 系统/内核/构架、设备型号/序列号、启动时间与运行时长、真实用户表、登录项与 LaunchAgents（可启停）、白名单环境变量 |
| 软件 Software | 已安装应用（搜索/来源过滤/排序、定位、卸载）；macOS 显示 Homebrew 已装/可升级包，Windows 显示 winget 状态 |
| 网络 Network | 网卡卡片、Wi-Fi 状态/信号、DNS、默认路由、代理、TCP 监听端口与已建立连接数；开关 Wi-Fi、设置 DNS、打开网络设置 |
| 安全 Security | 安全状态卡（macOS：FileVault/SIP/Gatekeeper/TCC；Windows：BitLocker/Defender/安全启动/UAC）、防火墙、管理员用户、跳转隐私等设置页、刷新 DNS、清空废纸篓 |
| 进程 Processes | 可搜索/排序的进程表（PID、命令、用户、CPU、内存、状态），逐行结束进程（macOS: TERM/KILL/INT/STOP/CONT；Windows: TERM/KILL/INT；二次确认） |
| 清理 Cleanup | 扫描缓存/日志/废纸篓/开发缓存等可安全清理位置（只扫描不删除）；显示大小、文件数、是否需管理员；勾选后二次确认才执行 `cleanup.delete` |
| 性能 Benchmark | 固定工作量的 CPU（单核+多核）、内存带宽、磁盘读写测试；显示分数/单位/耗时/环境，并与上一次运行对比涨跌；分数仅用于同一台机器的前后对比 |
| 操作 Actions | 19 个白名单动作按组呈现：表单由参数目录自动生成、危险动作二次确认、结果吐司与操作历史 |

## Agent 工具

- `device_info`：`section = overview | hardware | system | software | network | security | processes | cleanup`，`fresh` 可绕过缓存。
- `device_control`：`action` 为动作 id 枚举，`params` 为动作参数，与 UI 走**同一实现**（不会出现两套逻辑）。
- `device_benchmark`：`tests? = cpu|memory|disk`、`repeat?`，运行与「性能」标签页完全相同的基准引擎。

## 动作清单（19 项，全部白名单 + 严格参数校验）

下表为 macOS 语义；Windows 使用相同动作 id 的平台实现（差异见下方 **Windows 映射**）。

| 动作 id | 说明 |
|---|---|
| `process.signal` | 向进程发送 TERM/KILL/INT/STOP/CONT；拒绝 PID 1、Host 自身及其父进程 |
| `app.quit` / `app.launch` / `app.reveal` | 退出应用 / 启动应用 / 在 Finder 中显示 |
| `app.uninstall` | 卸载 `.app`（默认移到废纸篓，可选彻底删除）；只允许 `/Applications`、`~/Applications`、`/System/Applications`，系统应用拒绝 |
| `system.setHostname` | 改 HostName / ComputerName / LocalHostName（字符与长度校验） |
| `system.setVolume` / `system.setDarkMode` | 系统音量 0–100 / 深色模式开关 |
| `system.launchAgent` | 启停用户或系统 LaunchAgent（`launchctl bootstrap/bootout`，路径白名单） |
| `system.openSettings` | 打开指定系统设置面板（21 个面板白名单） |
| `system.toggleFirewall` | 开/关应用防火墙（需管理员权限，失败如实返回 stderr） |
| `system.flushDNS` / `system.emptyTrash` | 刷新 DNS 缓存 / 清空废纸篓 |
| `cleanup.delete` | 清理扫描后选中的缓存/日志/废纸篓等（只接受扫描返回的固定 id，绝不接受路径；1–20 个、去重、白名单校验） |
| `network.setWifiPower` | 开/关 Wi-Fi（自动解析 Wi-Fi 设备） |
| `network.setDns` | 为网络服务设置 0–4 个 DNS；接受服务名或网卡名（en0 → 对应服务） |
| `power.sleep` / `power.lock` | 睡眠 / 锁定屏幕 |
| `software.brewUninstall` | 卸载 Homebrew 公式（公式名白名单校验）；Windows 对应 `software.wingetUninstall` |

### Windows 映射

| 动作 | Windows 实现 |
|---|---|
| `process.signal` | `Stop-Process`（TERM 温和结束；KILL/INT 强制结束）；Windows 不支持 STOP/CONT |
| `app.quit` / `app.launch` / `app.reveal` | `Stop-Process -Name` / `Start-Process` / `explorer /select` |
| `app.uninstall` | 参数改为 `id`：支持 `msi:{GUID}`、`winget:<id>`、注册表卸载键路径；不执行任意 shell 字符串 |
| `system.setHostname` | `Rename-Computer`（`ComputerName`，需管理员，重启后生效） |
| `system.setVolume` / `system.setDarkMode` | CoreAudio 音量接口 / 注册表 `Themes\Personalize` |
| `system.launchAgent` | 启动项：`startup:HKCU|HKLM:<ValueName>` 伪路径，禁用时移入备份键，可恢复 |
| `system.openSettings` | `ms-settings:<pane>` 白名单（display/sound/network/privacy/…） |
| `system.toggleFirewall` / `system.flushDNS` / `system.emptyTrash` | `Set-NetFirewallProfile` / `Clear-DnsClientCache` / `Clear-RecycleBin` |
| `network.setWifiPower` / `network.setDns` | `Enable/Disable-NetAdapter` / `Set-DnsClientServerAddress`（按网卡别名） |
| `power.sleep` / `power.lock` | `powrprof.dll,SetSuspendState` / `user32.dll,LockWorkStation` |
| `software.wingetUninstall` | `winget uninstall --id <id>`（仅 Windows） |

安全模型：浏览器通过同源 `/devicex/api/*` 调用，落在 DSH 的 **Connection 信任栅栏**之后（签名会话
cookie + Host/Origin 校验，未认证请求 401，异源 403）；所有子进程使用 `execFile` 参数数组，不经 shell；
路径参数做根目录与后缀校验；每次动作（含失败）都进入 50 条环形历史。

## 架构

```
plugin/
├── package.json          # dsh.bundle.patch + dsh.client(web, immediately) + exports(locale/icon/client)
├── cordis.patch.yml      # 插入 id: devicex 行
├── index.js              # Host 入口：warmup() + 注册 6 条 HTTP 路由 + 3 个 Agent 工具
├── host/
│   ├── proc.js           # execFile 封装：永不抛出、超时/maxBuffer、stdin input、12 路并发上限
│   ├── collector.js      # 平台 dispatcher（darwin | win32）
│   ├── collector-darwin.js  # macOS 采集：指标 + 六大分区，TTL 缓存、后台预热、并发去重
│   ├── collector-win32.js   # Windows 采集：PowerShell/CIM 采集 + 纯映射（__test 供离线验证）
│   ├── actions.js        # 动作目录 dispatcher（darwin | win32）
│   ├── actions-darwin.js # macOS 19 个动作
│   ├── actions-win32.js  # Windows 19 个动作（Stop-Process / ms-settings / winget / …）
│   ├── cleanup.js / cleanup-darwin.js / cleanup-win32.js  # 白名单清理扫描 + 确认删除
│   ├── benchmark.js      # 固定工作量、可重复的 CPU/内存/磁盘基准（worker_threads）
│   ├── win.js            # PowerShell 桥：优先 5.1、脚本经 stdin 流式执行（规避 32K 命令行上限）
│   ├── win/*.ps1         # 七个只读、免管理员、单 JSON 输出的 PowerShell 采集脚本
│   ├── transport.js      # /devicex/api/{metrics,inventory,actions,action,cleanup,benchmark}，信任栅栏 + JSON 信封
│   └── tool.js           # device_info / device_control / device_benchmark 的 schema、摘要与渲染
├── src/client/           # 浏览器端 ESM 源码（模块拆分：entry/runtime/core/dicts/styles/api/normalizers/helpers/constants）
├── client.js             # 构建产物：src/client → esbuild 单文件 bundle（勿手改，改源码后 npm run build）
├── locale/{en,zh}.json   # 插件管理器里的标题、描述
└── icon.svg              # 原创图标
docs/build-contract.md    # 构建契约（数据形状、API、动作表、UI 要求）
docs/windows-contract.md  # Windows 适配契约（PowerShell 约定、CIM 数据源、Windows 动作表）
scripts/build-client.mjs  # esbuild：src/client → plugin/client.js（--check 校验产物是否最新）
scripts/render-check.mjs  # jsdom + React 18 渲染冒烟（10 个标签页、215 条断言）
scripts/render-windows-check.mjs # 映射后的 Windows 数据渲染（32 条断言）
scripts/client-fixtures.mjs # 渲染测试用的数据 fixture
scripts/verify.mjs        # 通用离线验证（91 项检查）
scripts/verify-windows.mjs # Windows 离线验证（167 项：fixture 映射 + 模拟 win32 Host 端到端）
scripts/verify-sensors.mjs # 温度/驱动采集验证（57 项：静态 + fixture 映射 + 本机真实探测）
scripts/verify-cleanup.mjs # 清理扫描/动作验证（130 项：真实扫描 + 沙箱删除 + 白名单不可变）
scripts/verify-benchmark.mjs # 基准引擎验证（46 项：形状/确定性/重复性/临时文件清理）
scripts/fixtures/win32/   # 真实 CIM 输出形态的 fixture
tsconfig.json             # JSDoc/checkJs 类型检查配置（覆盖 Host）
.github/workflows/verify.yml # CI：build 一致性 + tsc + 渲染测试 + 全部离线验证
```

HTTP API（同一来源，`cache-control: no-store`）：

| 方法与路径 | 响应 |
|---|---|
| `GET /devicex/api/metrics` | `{ ok, metrics }`（UI 每 2500ms 轮询；实测 9–172ms） |
| `GET /devicex/api/inventory[?section=&fresh=1]` | `{ ok, section, data }`；不带 section 返回完整清单 |
| `GET /devicex/api/actions` | `{ ok, platform, sections, actions, history }` |
| `POST /devicex/api/action` | `{ ok, message, data? }`（业务失败仍 HTTP 200） |
| `GET /devicex/api/cleanup[?fresh=1]` | `{ ok, cleanup }`（白名单扫描，60s 缓存） |
| `POST /devicex/api/benchmark` | `{ ok, benchmark }`（body: `{ tests?, repeat? }`） |

## 工程化（1.3）

- **源码/产物分离**：浏览器端源码在 `src/client/`（ESM 模块：`entry.js` 负责 module-loader 注册，`core.js` 是页面与组件，`dicts.js`/`styles.js`/`helpers.js`/`constants.js`/`normalizers.js`/`api.js` 各自独立）。`plugin/client.js` 是 **B（esbuild）** 生成的单文件 IIFE bundle（minify，仍只通过 loader 的 `require("react")` 取运行时，外部零依赖），`npm run build` 重新生成，`npm run build:check` 校验提交产物与源码一致（CI 强制）。
- **B+C+D 三轨并存**：
  - **B（推荐主路径）**：esbuild 打包 → 202 KB minified bundle；
  - **C（无打包器回退）**：`npm run build:concat` 按依赖顺序拼接 `src/client/`、剥掉 `import`/`export`，并用 TypeScript 编译器转译 `.ts`/`.tsx`（**不引入打包器**；TypeScript 本就是 typecheck 的 devDependency），产物约 284 KB、行为与 B 等价；
  - **D（零构建资产）**：仓库提交的 `plugin/client.js` 是自包含产物——安装、加载、运行都不需要构建，也不需要 devDependencies；esbuild/TypeScript/jsdom 只在开发与 CI 中使用。
  - `npm run verify:build`（37 项）验证三者：两个引擎各自确定、结构与 loader 契约一致、注册面（inject/slots/615 个 zh/en 词条）逐项相等，并让 **B 与 C 各跑一遍 215 条 10 标签页渲染 + 32 条 Windows 数据渲染**。
- **静态类型**：`tsconfig.json` 开启 `allowJs + checkJs`（`strictNullChecks` 打开，其余渐进放松），覆盖 `plugin/index.js` 与 `plugin/host/**/*.js`；JSDoc 描述数据契约与返回类型，`npm run typecheck`（`tsc --noEmit`）为 0 error，CI 强制。
- **类型契约层（P0）**：[types/contracts.ts](types/contracts.ts) 是纯类型文件（不参与运行时、不打进 bundle、不随包分发），定义 Host 采集 ↔ 动作/HTTP API ↔ 浏览器客户端之间的冻结形状：`Metrics`、六个 section、`Inventory`、19 个动作的 `ActionId`/`Action`/`ActionResult`、cleanup/benchmark、`ExecResult`，以及最小的 DSH 契约（`PluginContext`/`ToolDefinition`/`WebRoute`）。**平台适配器接口** `PlatformCollector`/`PlatformActions` 在 `collector.js`/`actions.js` 的 dispatcher 处编译期校验——任一平台漏实现或签名漂移都会让 `tsc` 报错。Host 用 JSDoc `import type` 引用，client 源码用 JSDoc typedef 指向同一文件。
- **动作参数值类型（P1）**：契约层新增每个动作的归一化参数类型（`DarwinActionParamsById` / `Win32ActionParamsById`），含判别联合（`app.uninstall` 的 msi/winget/registry、`system.launchAgent` 的 hive）。Windows 侧 19 个 `validate(params)` 已用 `@returns {Win32Params['id']}` 标注，`tsc` 会拒绝与契约不一致的归一化值；macOS 侧 runner 仍在**不可信边界**内联校验（不把外部输入伪装成已校验类型），这是有意的分层。
- **客户端纯逻辑类型检查（P2-a）**：`src/client/{constants,helpers,runtime,normalizers,api}.js` 加 `// @ts-check`，新增 `tsconfig.client.json`（含 DOM lib，`strictNullChecks`）并纳入 `npm run typecheck`——`core.js`/`dicts.js`/`styles.js` 暂不纳入（前者靠 215 条渲染测试覆盖，后两者是数据/样式），从而在不动 `.tsx`、不破坏 loader 契约的前提下获得客户端逻辑的编译期检查。
- **JSX 试点（P2-b）**：新增 [src/client/jsx.js](src/client/jsx.js) 作为 **classic JSX 运行时**（`h` 惰性绑定 loader 注入的 React，`<>` 片段映射到 `React.Fragment`），esbuild 使用 `jsxFactory: h` 而**不**打包 `react/jsx-runtime`——产物仍然只向 loader 请求一次 `react`。**全部 UI 已完成 `.tsx` 化**（1.4.0）：19 个基础组件 + 10 个 Tab（Overview/Hardware/System/Software/Network/Security/Processes/Cleanup/Benchmark/Actions）+ `Modal`/`Toasts`/`action-helpers` 均在 [components/](src/client/components) 与 [action-helpers.tsx](src/client/action-helpers.tsx) 中；`src/client/page.tsx` 承载页面装配（约 700 行 TSX），`use-device-metrics.js` 承载轮询/采样 hooks，`core.js` 只剩 57 行的插件注册（locale/styles/main/sidebar）。整条客户端从 6,600+ 行单文件拆成 40+ 个类型化模块。由 `tsconfig.client.json` 做 TSX 类型检查（`@types/react` 为 devDependency，运行时仍由 loader 注入）。页面层已开始拆 Tab：**OverviewTab**、**HardwareTab**（含 `ThermalCard`/`DriversCard`）、**SystemTab**、**SoftwareTab**、**NetworkTab**、**SecurityTab**、**ProcessesTab**、**CleanupTab**、**BenchmarkTab** 与共享的 **TabShell/SectionErrors** 已迁为 `.tsx`（含 `DeviceScene` 与 hooks 转发层），剩余 **ActionsTab** 与 Modal/Toasts 层按同样模式迁移，构建链不再变动。
- **可测的客户端**：`scripts/render-check.mjs` 与 `render-windows-check.mjs` 用 React 18 + jsdom 真实挂载面板，覆盖 10 个标签页、清理删除流、基准运行/对比、Windows 数据分支与错误边界；已随仓库提交并在 CI 跑。
- **解析器单元测试（P1）**：`test/` 下用 `node:test` 覆盖高风险纯函数（`npm test`，57 项）：macOS 命令解析（vm_stat/swap/pmset/ioreg/ifconfig/route/scutil/lsof/ps/launchctl/plist/mdls/system_profiler）、Windows CIM mapper 与 cleanup 归一化、动作目录/参数守卫、基准纯函数。测试直接驱动解析器，不 spawn 命令、不修改缓存。
- **CI**：`.github/workflows/verify.yml` 在 macOS runner 上执行 `npm ci → build --check → typecheck → npm test → verify:build（B/C/D）→ 五套离线验证`。当前 `npm run verify` = 91 + 167 + 57 + 130 + 46 项检查，另有 `verify:build` 37 项构建一致性检查。
- 说明：本轮保持现有的 `h()` 调用风格，没有整体改写成 JSX——模块拆分 + esbuild 已就位，后续可逐文件迁移到 `.jsx`，构建链无需更换。

## 验证

离线（不需要改动 profile）：

```sh
node scripts/verify.mjs           # macOS/Linux/Windows 通用的离线回归（91 项检查）
node scripts/verify-windows.mjs   # Windows 适配专项（167 项）：桥接层 + .ps1 静态检查 + fixture 映射 + 动作目录/守卫 + 客户端元数据 + 模拟 win32 Host 端到端
node scripts/verify-sensors.mjs   # 温度/驱动专项（57 项）：契约静态检查 + fixture 映射 + 本机真实采集
node scripts/verify-cleanup.mjs   # 清理专项（130 项）：真实扫描、缓存、沙箱删除、白名单不可变、动作守卫
node scripts/verify-benchmark.mjs # 基准专项（46 项）：形状、确定性、重复性、worker 回退、临时文件清理
npm test                          # 解析器/映射器/守卫单测（57 项，node:test）

# 工程化门禁（等价 CI）
npm run build:check   # 提交的 client.js 与 src/client 一致
npm run typecheck     # tsc --noEmit，覆盖 Host，0 error
npm test                               # node:test 解析器/映射器/守卫单测（57 项）
node scripts/verify-build.mjs          # B/C/D 构建一致性（37 项，含两个引擎的渲染回归）
node scripts/render-check.mjs          # 215 条渲染断言（对提交产物）
node scripts/render-windows-check.mjs  # 32 条 Windows 渲染断言（对提交产物）
```

`verify.mjs` 覆盖：语法/清单/locale/图标、指标与六大分区真实采集、动作目录与守卫、伪造 Cordis 上下文下的
路由与工具注册、信任栅栏与 JSON 信封、浏览器模块加载 + slot 注册 + 中英词典一致 + 样式释放。
`verify-windows.mjs` 不需要 Windows 或 PowerShell：用真实 CIM 输出形态的 fixture 驱动采集层的纯映射函数，
静态检查每个 `.ps1` 的约定（单 JSON 输出、`$ErrorActionPreference='Stop'`、无字符串插值、无 `Invoke-Expression`），
并在本机把 `process.platform` 模拟为 `win32` + 注入 fixture runner，端到端跑通 dispatcher → HTTP 路由 → Agent 工具。

本机实测证据（安装后）：

- `plugin_manager install_bundle` → `application: applied`，`warnings: []`；profile 记录
  `"@cfour-hi/dsh-devicex": "link:~/GitHub/DSHP-DeviceX/plugin"`（实际记录为绝对路径），且 bundle 列表包含它。
- 实时 Host：`Tool.listTools` 中出现 `device_info`、`device_control`（参数枚举完整）。
- 实时 Client：`Slots.listSubTree("main")` 出现 `devicex` occupant；`Slots.listSubTree("sidebar.panellist")`
  出现 `devicex` / order 20 occupant（说明浏览器端模块已加载并成功注册，无需刷新页面）。
- `/plugins/events` 的模块图中包含 `@cfour-hi/dsh-devicex` 条目，抓取到的 bundle 与 `plugin/client.js`
  逐字节一致（仅多一行 sourceMappingURL）。
- 路由存活与栅栏：`GET /devicex/api/metrics` → `401`（已注册且拒绝未认证），
  同时 `/definitely-not-a-route-xyz/` → `404`（证明 401 不是兜底页）。
- 客户端渲染：React 18.3 + jsdom 真实渲染 10 个标签页 + 清理删除流 + 基准运行/对比 + 弹窗/焦点/重试/畸形数据等 **215/215 断言通过**（测试已入库，CI 每次 push 重跑）；Windows 映射数据渲染 **32/32**。
- 类型检查：`tsc --noEmit`（JSDoc/checkJs）覆盖 Host **0 error**；esbuild 产物与源码一致性由 `build --check` 强制。
- Windows：开发机没有 Windows/PowerShell 可用，故为 **离线静态 + fixture 验证 + 模拟 win32 Host 端到端**
  （167 项），并经过一轮独立 QA 复审（阻塞问题已修复、复审无新阻塞项）；真实 Windows 运行时仍需在
  Windows 10/11 实机安装后确认，这是本轮交付的已知验证边界。

复现实时探测：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/devicex/api/metrics   # 期望 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/nope/                  # 期望 404
curl -sN -m 2 http://127.0.0.1:50732/plugins/events | head -c 200                      # 模块图 SSE
```

## 已知限制

- **像素级外观未验证**：开发会话没有浏览器控制能力（截图/DOM），视觉仅经过主题 token 审计、CSS 类覆盖检查
  与 jsdom 结构渲染验证；真实浏览器中的动画/模糊/`color-mix` 效果请以实际页面为准。
- **Windows 运行时未在实机验证**：本仓库开发于 macOS，Windows Host 通过 fixture + 静态检查验证；PowerShell
  5.1 的真实 CIM 字段差异、需要管理员权限的查询/动作，需要 Windows 10/11 实机确认。
- 部分系统动作需要管理员权限（改主机名、防火墙、系统级启动项、DNS、Wi-Fi 开关），无权限时会把命令错误
  原样返回给界面，不会假装成功。
- macOS：需要自动化授权的动作（退出应用、深色模式、锁定屏幕）首次调用可能被 TCC 拒绝并如实报错；
  Apple Silicon 默认不向普通用户公开 CPU/GPU 温度：`thermal.cpuCelsius` 为 `null` 并给出 `note`，
  安装 `smctemp` / `osx-cpu-temp` 或以管理员身份运行 DSH 才会解锁（不伪造温度）；TCC 数据库通常需完全磁盘访问。
- 温度：Windows ACPI 热区（WMI）在部分主板/虚拟机上不可用，此时只有其它来源或 `null`；风扇转速并非所有设备可读。
- 清理：macOS 下 `~/.Trash` 与部分系统缓存受 TCC/权限限制，扫描会如实返回 `EPERM`，删除时逐项报告失败；
  系统级目录需要管理员权限。
- 基准：固定工作量的分数只适合同一台机器前后对比，不能与鲁大师等跑分软件的分值横向比较；机器负载会影响单次结果（验证脚本允许 30% 波动）。
- Windows：BitLocker/Defender 等查询可能需要管理员权限，读不到时显示未知；Windows 没有等价的逐应用
  TCC 授权库，隐私面板显示为说明文案。
- 端口列表仅含 TCP LISTEN；部分系统进程的监听端口在非管理员下不可见。

## 分享给其他人安装

**从 GitHub 仓库直接安装（推荐，对方无需本地源码）** —— 在 Plugins 页面粘贴仓库地址，
或用 CLI / Agent 工具：

```sh
dsh plugin --profile desktop add https://github.com/cfour-hi/dsh-plugin-DeviceX
# 应用内等价操作：plugin_manager action=install_bundle target=https://github.com/cfour-hi/dsh-plugin-DeviceX
```

DSH（pnpm）把仓库**根目录**当作要安装的包，所以仓库根部保留一份薄 `package.json`：它声明
`dsh.bundle` / `dsh.client`，并用 `exports` 把入口映射到 `plugin/` 下的真实代码；
`plugin/package.json` 仍然是本地 link 安装与 tgz 分发包用的清单。两份清单必须保持同步，
`node scripts/verify.mjs` 会逐项检查，并且会校验每个导出资源都能真正解析到文件。

**本地文件 / tgz 安装（开发或离线分发）**：

```sh
# 需要 tgz 时先生成（dist/ 是构建产物，不随仓库提交）：
cd plugin && npm pack --pack-destination ../dist   # dist/cfour-hi-dsh-devicex-1.2.0.tgz
dsh plugin --profile desktop add /绝对路径/cfour-hi-dsh-devicex-1.2.0.tgz
# 或：dsh plugin --profile desktop add /绝对路径/plugin
```

运行中的 Desktop/Web 也可以直接在会话里用 `plugin_manager action=install_bundle target=<绝对路径或仓库地址>`
热安装（返回 `application: applied`，无需重启）。`dist/` 已在 `.gitignore` 中：需要 tgz 时用上面的
`npm pack` 生成，分发时也可以把它作为 GitHub Release 附件（Release 的 `.tgz` 直链同样可安装）。
完整步骤、前提（macOS 或 Windows 10/11、web 形态 profile）、GitHub/npm 分发、卸载与注意事项见
[`docs/INSTALL.md`](docs/INSTALL.md)。

## 二次开发

修改 `plugin/` 下任意文件后，重新执行 `plugin_manager install_bundle`（target 同上）即可；
或者重启 Harness。改动插件清单时记得同步仓库根的 `package.json`（GitHub 安装读取它）。
首次开发先 `npm ci`（esbuild/TypeScript/jsdom/react 均为 devDependencies）。改 `plugin/client.js` 时请改 `src/client/` 并 `npm run build`（CI 会拒绝过期产物；无 devDependencies 的环境可用 `npm run build:concat` 生成同契约回退产物），随后 `npm run typecheck`、`npm run verify:build`、`npm run verify`（或直接 `npm run verify:ci`）做完整回归，
并用上面的 `curl` 探测实时路由。
