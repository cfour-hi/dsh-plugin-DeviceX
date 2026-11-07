# Device X · DSHP-DeviceX

一个持久化的 **DSH 插件**：用一页优雅的中文/英文界面看尽当前设备的一切——硬件、系统、软件、
网络、安全与权限、进程——并对**非硬件**的一切直接操作（结束进程、退出/启动/卸载应用、启停登录项、
修改主机名/音量/深色模式、开关 Wi-Fi/防火墙、设置 DNS、卸载 Homebrew 包、清空废纸篓、睡眠/锁定、
跳转系统设置……）。同一套操作同时暴露给 Agent 模型，作为 `device_info` / `device_control` 两个工具。

- 已安装到当前 `desktop` profile（本地 link 安装，包目录 `plugin/`），安装结果 `application: applied`。
- UI 入口：左侧栏底部的 **Device X 面板图标**（在 Plugins、Schedules 图标之后）→ 中央主面板。
- 失败动作只在对应卡片/弹窗内报错，不会让页面或插件崩溃。

## 界面

八个标签页，跟随 DSH 主题（浅色/深色）、仅使用主题 token 着色，支持 `prefers-reduced-motion`：

| 标签 | 内容 |
|---|---|
| 总览 Overview | 纯 CSS 3D 设备核心（分层芯片 + 轨道环 + 粒子）、CPU/内存/磁盘/电池/网络五个 SVG 环形 KPI、60 点火花线、Top 进程、派生告警、内存构成条 |
| 硬件 Hardware | CPU 与逐核占用、统一内存/内存条、GPU、显示器、物理磁盘与卷、电池健康、USB、蓝牙、音频、摄像头 |
| 系统 System | 系统/内核/构架、设备型号/序列号、启动时间与运行时长、真实用户表、登录项与 LaunchAgents（可启停）、白名单环境变量 |
| 软件 Software | 已安装应用（搜索/来源过滤/排序、定位、卸载到废纸篓或删除）、Homebrew 已装与可升级包（可卸载） |
| 网络 Network | 网卡卡片、Wi-Fi 状态/信号、DNS、默认路由、代理、TCP 监听端口与已建立连接数；开关 Wi-Fi、设置 DNS、打开网络设置 |
| 安全 Security | FileVault / SIP / Gatekeeper / 防火墙状态卡、TCC 权限（可读时列出授权，不可读时解释需完全磁盘访问）、管理员用户、跳转隐私等设置页、刷新 DNS、清空废纸篓、防火墙开关 |
| 进程 Processes | 可搜索/排序的进程表（PID、命令、用户、CPU、内存、状态），逐行结束进程（TERM/KILL/INT/STOP/CONT，二次确认） |
| 操作 Actions | 18 个白名单动作按组呈现：表单由参数目录自动生成、危险动作二次确认、结果吐司与操作历史 |

## Agent 工具

- `device_info`：`section = overview | hardware | system | software | network | security | processes`，`fresh` 可绕过缓存。
- `device_control`：`action` 为动作 id 枚举，`params` 为动作参数，与 UI 走**同一实现**（不会出现两套逻辑）。

## 动作清单（18 项，全部白名单 + 严格参数校验）

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
| `network.setWifiPower` | 开/关 Wi-Fi（自动解析 Wi-Fi 设备） |
| `network.setDns` | 为网络服务设置 0–4 个 DNS；接受服务名或网卡名（en0 → 对应服务） |
| `power.sleep` / `power.lock` | 睡眠 / 锁定屏幕 |
| `software.brewUninstall` | 卸载 Homebrew 公式（公式名白名单校验） |

安全模型：浏览器通过同源 `/devicex/api/*` 调用，落在 DSH 的 **Connection 信任栅栏**之后（签名会话
cookie + Host/Origin 校验，未认证请求 401，异源 403）；所有子进程使用 `execFile` 参数数组，不经 shell；
路径参数做根目录与后缀校验；每次动作（含失败）都进入 50 条环形历史。

## 架构

```
plugin/
├── package.json          # dsh.bundle.patch + dsh.client(web, immediately) + exports(locale/icon/client)
├── cordis.patch.yml      # 插入 id: devicex 行
├── index.js              # Host 入口：warmup() + 注册 4 条 HTTP 路由 + 2 个 Agent 工具
├── host/
│   ├── proc.js           # execFile 封装：永不抛出、超时/maxBuffer、C locale、12 路并发上限
│   ├── collector.js      # 指标 + 六大分区采集，分区 TTL 缓存、后台预热、并发去重、JSON 安全
│   ├── actions.js        # 18 个动作的目录、参数校验、守卫、执行与历史
│   ├── transport.js      # /devicex/api/{metrics,inventory,actions,action}，信任栅栏 + JSON 信封
│   └── tool.js           # device_info / device_control 的 schema、摘要与渲染
├── client.js             # 浏览器模块：main 面板 + sidebar.panellist + zh/en 词典 + 样式
├── locale/{en,zh}.json   # 插件管理器里的标题、描述
└── icon.svg              # 原创图标
docs/build-contract.md    # 构建契约（数据形状、API、动作表、UI 要求）
scripts/verify.mjs        # 离线验证脚本（59 项检查）
```

HTTP API（同一来源，`cache-control: no-store`）：

| 方法与路径 | 响应 |
|---|---|
| `GET /devicex/api/metrics` | `{ ok, metrics }`（UI 每 2500ms 轮询；实测 9–172ms） |
| `GET /devicex/api/inventory[?section=&fresh=1]` | `{ ok, section, data }`；不带 section 返回完整清单 |
| `GET /devicex/api/actions` | `{ ok, platform, sections, actions, history }` |
| `POST /devicex/api/action` | `{ ok, message, data? }`（业务失败仍 HTTP 200） |

## 验证

离线（不需要改动 profile）：

```sh
node scripts/verify.mjs   # 59 项检查全部通过
```

覆盖：语法/清单/locale/图标、指标与六大分区真实采集、动作目录与守卫、伪造 Cordis 上下文下的路由与
工具注册、信任栅栏与 JSON 信封、浏览器模块加载 + slot 注册 + 中英词典一致 + 样式释放。

本机实测证据（安装后）：

- `plugin_manager install_bundle` → `application: applied`，`warnings: []`；profile 记录
  `"@local/dsh-devicex": "link:~/GitHub/DSHP-DeviceX/plugin"`（实际记录为绝对路径），且 bundle 列表包含它。
- 实时 Host：`Tool.listTools` 中出现 `device_info`、`device_control`（参数枚举完整）。
- 实时 Client：`Slots.listSubTree("main")` 出现 `devicex` occupant；`Slots.listSubTree("sidebar.panellist")`
  出现 `devicex` / order 20 occupant（说明浏览器端模块已加载并成功注册，无需刷新页面）。
- `/plugins/events` 的模块图中包含 `@local/dsh-devicex` 条目，抓取到的 bundle 与 `plugin/client.js`
  逐字节一致（仅多一行 sourceMappingURL）。
- 路由存活与栅栏：`GET /devicex/api/metrics` → `401`（已注册且拒绝未认证），
  同时 `/definitely-not-a-route-xyz/` → `404`（证明 401 不是兜底页）。
- 客户端渲染：React 18.3 + jsdom 真实渲染 8 个标签页 + 弹窗/焦点/重试/畸形数据等 **184/184 断言通过**。

复现实时探测：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/devicex/api/metrics   # 期望 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/nope/                  # 期望 404
curl -sN -m 2 http://127.0.0.1:50732/plugins/events | head -c 200                      # 模块图 SSE
```

## 已知限制

- **像素级外观未验证**：本会话没有浏览器控制能力（截图/DOM），视觉仅经过主题 token 审计、CSS 类覆盖检查
  与 jsdom 结构渲染验证；真实浏览器中的动画/模糊/`color-mix` 效果请以实际页面为准。
- 部分系统动作需要管理员权限（改主机名、防火墙、系统级 LaunchAgent、DNS），无权限时会把命令 stderr
  原样返回给界面，不会假装成功。
- 需要 macOS 自动化授权的动作（退出应用、深色模式、锁定屏幕）首次调用可能因 TCC 被拒绝并如实报错。
- Apple Silicon 上无法公开读取 CPU 温度（`thermal.cpuTempC` 为 `null`，不伪造）；Wi-Fi 关闭时
  `network.wifi` 为 `null`；TCC 数据库通常需完全磁盘访问，读不到时界面会说明原因。
- 端口列表仅含 TCP LISTEN；部分系统进程的监听端口在无 root 时看不到。
- 本机 Wi-Fi 射频关闭，Wi-Fi 开启态的解析未能用真实连接验证。

## 分享给其他人安装

官方安装命令是 CLI（底层与插件管理器同一套操作，安装 pnpm 依赖并自动把 bundle 写进 profile 的
`dsh.profile.bundles`）：

```sh
dsh plugin --profile desktop add /绝对路径/local-dsh-devicex-1.0.0.tgz
# 或：dsh plugin --profile desktop add /绝对路径/plugin
```

运行中的 Desktop/Web 也可以直接在会话里用 `plugin_manager action=install_bundle target=<绝对路径>` 热安装
（返回 `application: applied`，无需重启）。分发件为 `dist/local-dsh-devicex-1.0.0.tgz`（仅含运行文件；随代码提交，代码改动后需重新 `npm pack`）。
完整步骤、前提（macOS / web 形态 profile）、npm/Git 分发、卸载与注意事项见
[`docs/INSTALL.md`](docs/INSTALL.md)。

## 二次开发

修改 `plugin/` 下任意文件后，重新执行 `plugin_manager install_bundle`（target 同上）即可；
或者重启 Harness。随后运行 `node scripts/verify.mjs` 做离线回归，并用上面的 `curl` 探测实时路由。
