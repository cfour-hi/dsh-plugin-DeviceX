# Device X 安装指南（给其他人 / 其他机器）

Device X 是一个 **DSH 持久插件**，安装到某个 DSH profile 后，该 profile 的所有会话都会得到：

- 左侧栏底部的 **Device X** 面板图标 + 中央仪表盘（8 个标签页、SVG 图表、CSS 3D）；
- Agent 工具 `device_info` / `device_control`。

官方安装入口有两个，底层是同一套插件管理操作：

| 入口 | 适用场景 |
|---|---|
| **CLI**：`dsh plugin --profile <profile> add <包名/路径>` | 终端、给其他机器/其他 profile 安装 |
| **应用内**：`plugin_manager` 工具（或 Plugins 页面） | 正在运行的 Desktop/Web，热安装、返回 `application` 结果 |

## 前提条件

| 条件 | 说明 |
|---|---|
| 系统 | **macOS**。Host 端采集与系统动作调用 `system_profiler`、`sw_vers`、`networksetup`、`launchctl`、`pmset`、`osascript` 等 macOS 命令；Linux/Windows 能加载但大部分数据为空、动作会失败 |
| DSH 形态 | **Desktop 或 Web** 形态的 profile（需要 `webServer` / `connection` / `tools` 服务）。headless/纯 CLI（如 tui）profile 不会激活本插件 |
| `dsh` CLI | 需要在 `PATH` 上。Desktop 安装自带 CLI，若未 link，可用绝对路径：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` |
| pnpm | CLI 使用安装自带的 pnpm；应用内安装需要 `pnpm` 在 `PATH` 上 |
| 权限 | 安装 Host 代码需要 `danger-full-access` 或当次批准；执行时按提示确认 |

## 方式一：官方 CLI（推荐给其他机器 / 其他 profile）

```sh
# 从打包文件安装（推荐分发形式）
dsh plugin --profile desktop add /绝对路径/local-dsh-devicex-1.0.0.tgz

# 或直接从源码目录安装
dsh plugin --profile desktop add /绝对路径/plugin
```

它不只是 `pnpm add`，完整流程是：

1. 必要时初始化目标 profile；
2. 把包操作转发给 pnpm（安装依赖）；
3. **自动把声明了 `dsh.bundle` 的新包写进 profile 的 `dsh.profile.bundles`**（即激活为 profile 层）——
   这就是"安装插件"里容易被忽略的一步，实测新 profile 安装后 manifest 中同时出现依赖和 bundles 条目；
4. 做版本兼容性（`engines`/peerDependencies）与 bundle 平台检查；失败会回滚 `package.json`/`pnpm-lock.yaml`，
   需要版本豁免时会打印 `dsh plugin --profile <p> allow-version ...` 提示。

注意：

- 对 **`desktop`** profile：应用会用它自己的 CLI（`manageDesktopProfile`），官方提示建议**先完全退出 Desktop**
  再执行，避免安装过程与运行中的 Host 争用；装完重新打开应用即可。若不想退出，直接在应用内用方式二，安装会热生效。
- 对 **其他 profile**（如自建 `web` profile）：装完用 `dsh --profile <profile>` 启动即可加载；tui/headless 这类
  没有 `webServer` 的 profile 不会激活本插件。
- 目录安装是 `link:` 依赖，之后**不要移动/删除**该目录，否则插件失效。

## 方式二：应用内 `plugin_manager`（运行中热安装）

在目标机器的 DSH 会话里让 Agent 执行（或自己调用该工具）：

```
plugin_manager action=install_bundle target=/绝对路径/local-dsh-devicex-1.0.0.tgz
```

- 返回 `application: applied` 即生效：侧边栏出现 Device X 图标、Agent 立刻拿到两个工具，无需重启；
  若返回 `restart-required` 则重启 DSH。
- 这个入口在 CLI 的能力之上还多了：registry 回退计划、GitHub 预检、构建脚本批准（`approvedBuilds`）、
  以及给界面的安装进度/激活结果；Plugins 页面也用它做启用/停用/卸载。

## 方式三：分发包

仓库里的 `dist/local-dsh-devicex-1.0.0.tgz`（约 91 KB，仅含运行文件）就是给对方的分发件：

- 对方拿到后按方式一或方式二安装即可；
- 更新同理：重新 `npm pack`（在 `plugin/` 下 `npm pack --pack-destination ../dist`）后用新 tgz 覆盖安装。

## 方式四：npm registry / Git 仓库

`dsh plugin add` 与 `install_bundle` 都接受 registry 包名和 git 地址（如 `git+https://...`）。
发布前需要：

1. 把 `plugin/package.json` 的 `name` 改成自己的包名（例如 `@yourscope/dsh-devicex`），删除 `"private": true`；
2. `npm publish` 或推送到 Git；
3. 安装：`dsh plugin --profile <p> add @yourscope/dsh-devicex`（或 `install_bundle` 同样的 target）。

包名同时是浏览器模块 id：改名时 `plugin/client.js` 里的模块 id 与 `plugin/cordis.patch.yml` 的 `name` 也要同步。

## 安装后确认

1. 左侧栏（Plugins、Schedules 图标之后）出现 **Device X** 图标 → 点击打开面板；
2. 该会话的 Agent 可见 `device_info` / `device_control` 两个工具；
3. 探活（端口以实际 `DSH_WEB_URL` 为准；未认证返回 401 表示路由已注册）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/devicex/api/metrics   # 期望 401
curl -sN -m 2 http://127.0.0.1:50732/plugins/events | grep -c '@local/dsh-devicex'      # 期望 ≥1
```

## 卸载 / 更新

```sh
# CLI：卸载并同时从 bundles 选择中移除
dsh plugin --profile <profile> remove @local/dsh-devicex

# 应用内
plugin_manager action=remove_bundle target=@local/dsh-devicex
```

更新：用新 tgz（或新目录/新版本）重新执行 add / install_bundle。

## 注意事项

- 这是**本机设备管理**插件，数据不出本机；每个用户的机器各自采集、各自操作，不会互相同步。
- `device_control` 对 Agent 开放了结束进程、卸载软件、改主机名、防火墙、DNS 等高权限动作；装到共享账号的
  profile 前请确认这是预期行为。
- 需管理员权限的动作（防火墙、DNS、系统级 LaunchAgent、改主机名）失败时会把命令 stderr 返回给界面。
- 需要 macOS 自动化授权的动作（退出应用/深色模式/锁定）首次调用可能被 TCC 拒绝，按系统提示授权即可。
