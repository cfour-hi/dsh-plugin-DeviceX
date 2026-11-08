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
| 系统 | **macOS** 或 **Windows 10/11**。macOS 用 `system_profiler`、`networksetup`、`launchctl`、`pmset` 等系统命令；Windows 用 PowerShell/CIM（powershell.exe 5.1 或 pwsh 7 均可，系统自带）。Linux 不在支持范围内，安装会被 bundle 平台检查拒绝 |
| DSH 形态 | **Desktop 或 Web** 形态的 profile（需要 `webServer` / `connection` / `tools` 服务）。headless/纯 CLI（如 tui）profile 不会激活本插件 |
| `dsh` CLI | 需要在 `PATH` 上。macOS 未 link 时可用绝对路径：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；Windows 使用 Desktop 安装目录下 `resources\runtime\cli` 提供的 `dsh` |
| pnpm | CLI 使用安装自带的 pnpm；应用内安装需要 `pnpm` 在 `PATH` 上 |
| PowerShell（Windows） | 需要 `powershell.exe`（Windows PowerShell 5.1，系统自带）或 `pwsh.exe`（PowerShell 7+）。插件会自动探测，无需额外安装模块 |
| 权限 | 安装 Host 代码需要 `danger-full-access` 或当次批准；执行时按提示确认 |

## 方式一：从 GitHub 仓库安装（推荐，对方不需要源码）

DSH（pnpm）把仓库**根目录**当作要安装的包，本仓库根部的 `package.json` 就是给 Git 安装的入口清单：
它声明 `dsh.bundle` / `dsh.client`，并用 `exports` 把入口映射到 `plugin/` 下的真实代码；
`plugin/package.json` 继续服务本地 link 安装与 tgz 分发。安装目标直接填仓库地址即可：

```sh
# CLI
dsh plugin --profile desktop add https://github.com/cfour-hi/dsh-plugin-devicex
```

或运行中的 Desktop/Web 里让 Agent / 自己调用：

```
plugin_manager action=install_bundle target=https://github.com/cfour-hi/dsh-plugin-devicex
```

- 公开仓库即可，**不需要**发布 npm、不需要改包名、也不需要去掉 `private`；pnpm 拉取默认分支的最新 commit。
- 仓库根必须保留 `package.json` 且逐项声明 `dsh.bundle` / `dsh.client`。若根目录没有清单，pnpm 会把它
  装成 `0.0.0` 占位包，DSH 激活时会报 “declares no dsh.bundle / not-bundle”，安装随之失败。
- 不要把 `plugin/` 子目录的裸地址当安装目标：GitHub 直装固定取仓库根；需要子目录布局时请发
  GitHub Release 的 `.tgz` 直链（见方式四）或 npm 包。pnpm 的 `#path:/plugin` 片段可以让 `plugin/`
  自身作为包安装（记录下来是 `github:cfour-hi/dsh-plugin-devicex#path:/plugin`），可作为临时绕过手段，
  但有了仓库根清单后裸仓库地址即可用。
- 更新：重新执行同一条 `add` / `install_bundle`（必要时先 `remove` 再安装），见“卸载 / 更新”。

## 方式二：官方 CLI（本地 tgz / 源码目录）

```sh
# 从打包文件安装（适合离线或分发给别人；先在 plugin/ 下 npm pack 生成，见方式四）
dsh plugin --profile desktop add /绝对路径/cfour-hi-dsh-devicex-1.2.0.tgz

# 或直接从源码目录安装
dsh plugin --profile desktop add /绝对路径/plugin

# Windows（PowerShell / cmd）
dsh plugin --profile desktop add C:\path\cfour-hi-dsh-devicex-1.2.0.tgz
dsh plugin --profile desktop add C:\path\plugin
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
  再执行，避免安装过程与运行中的 Host 争用；装完重新打开应用即可。若不想退出，直接在应用内用方式三，安装会热生效。
- 对 **其他 profile**（如自建 `web` profile）：装完用 `dsh --profile <profile>` 启动即可加载；tui/headless 这类
  没有 `webServer` 的 profile 不会激活本插件。
- 目录安装是 `link:` 依赖，之后**不要移动/删除**该目录，否则插件失效。
- Git 仓库安装见方式一；它与本地安装共用同一个包名 `@cfour-hi/dsh-plugin-devicex`，同一 profile 只保留一种来源。

## 方式三：应用内 `plugin_manager`（运行中热安装）

在目标机器的 DSH 会话里让 Agent 执行（或自己调用该工具）：

```
plugin_manager action=install_bundle target=/绝对路径/cfour-hi-dsh-devicex-1.2.0.tgz
# 也可以直接填仓库地址：target=https://github.com/cfour-hi/dsh-plugin-devicex
```

- 返回 `application: applied` 即生效：侧边栏出现 Device X 图标、Agent 立刻拿到两个工具，无需重启；
  若返回 `restart-required` 则重启 DSH。
- 直接在 **Plugins 页面**粘贴包名/仓库地址/本地路径时，DSH 会先装再等一次确认：安装成功后需要点
  **Enable now** 才会启用（`plugin_manager` 工具默认 `enabled: true`，装完自动启用并加进
  `dsh.profile.bundles`）。
- 这个入口在 CLI 的能力之上还多了：registry 回退计划、GitHub 预检、构建脚本批准（`approvedBuilds`）、
  以及给界面的安装进度/激活结果；Plugins 页面也用它做启用/停用/卸载。

## 方式四：分发包（npm pack / GitHub Release）

`dist/` 是本地构建产物，**不随仓库提交**（已在 `.gitignore` 中）。需要离线分发时在仓库里生成：

```sh
npm run release:pack
# 等价于 cd plugin && npm pack --pack-destination ../dist，并额外审计 tarball 内容
# 生成 dist/cfour-hi-dsh-plugin-devicex-<version>.tgz（仅含运行文件与 Windows PowerShell 脚本）
```

- 对方拿到 tgz 后按方式二或方式三安装即可；
- 官方版本会自动把同一个 tgz 挂到 GitHub Release 上（见[发布流程](RELEASE.md)），可直接用 Release 附件的直链安装；
- 更新同理：重新 `npm pack` 后用新 tgz 覆盖安装。

## 方式五：npm registry 发布

`dsh plugin add` 与 `install_bundle` 都接受 registry 包名。本仓库的正式包由
[release.yml](../.github/workflows/release.yml) 在推 tag 时自动发布（OIDC 可信发布，无需 token，
详见[发布流程](RELEASE.md)）；日常使用只需：

```sh
dsh plugin --profile <profile> add @cfour-hi/dsh-plugin-devicex
npm i @cfour-hi/dsh-plugin-devicex          # 或作为普通依赖
```

如果你是在自己的 fork 里发布到别的 scope：

1. 把 `plugin/package.json` **与仓库根 `package.json`** 的 `name` 一起改成自己的包名
   （例如 `@yourscope/dsh-devicex`）；`plugin/package.json` 已带 `publishConfig.access: public`，
   根清单保持 `"private": true`（它只用于 Git 直装，不发布）；
2. 在 `plugin/` 下发布（分发清单以它为准）：`cd plugin && npm publish --access public`，
   或按 `docs/RELEASE.md` 配置你自己仓库的 Trusted publishing 后推 tag；
3. 安装：`dsh plugin --profile <p> add @yourscope/dsh-devicex`（或 `install_bundle` 同样的 target）。

包名同时是浏览器模块 id：改名时 `plugin/client.js` 里的模块 id、`plugin/cordis.patch.yml` 的 `name`
以及仓库根 `package.json` 的导出都要同步（`node scripts/verify.mjs` 会检查）。

## 安装后确认

1. 左侧栏（Plugins、Schedules 图标之后）出现 **Device X** 图标 → 点击打开面板；
2. 该会话的 Agent 可见 `device_info` / `device_control` 两个工具；
3. 探活（端口以实际 `DSH_WEB_URL` 为准；未认证返回 401 表示路由已注册）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:50732/devicex/api/metrics   # 期望 401
curl -sN -m 2 http://127.0.0.1:50732/plugins/events | grep -c '@cfour-hi/dsh-plugin-devicex'      # 期望 ≥1
```

## 卸载 / 更新

```sh
# CLI：卸载并同时从 bundles 选择中移除
dsh plugin --profile <profile> remove @cfour-hi/dsh-plugin-devicex

# 应用内
plugin_manager action=remove_bundle target=@cfour-hi/dsh-plugin-devicex
```

更新：

- tgz / 目录安装：用新 tgz（或新目录/新版本）重新执行 add / install_bundle；
- GitHub 仓库安装：重新执行同一条 `install_bundle` / `dsh plugin add <仓库地址>` 拉取默认分支最新 commit；
  若 DSH 认为“已安装”而未更新，先 `remove` 再安装。
- 早期用裸仓库地址安装失败时，CLI 可能留下一个名为 `DSHP-DeviceX` 的 **0.0.0 普通依赖**（没有 bundle）。
  升级到带仓库根清单的版本前，先用 `dsh plugin --profile <profile> remove DSHP-DeviceX` 清掉它。
- 从 1.1.2 及更早版本升级：旧包名是 `@local/dsh-devicex`，1.1.3 起改为 `@cfour-hi/dsh-plugin-devicex`。
  先 `remove @local/dsh-devicex`（应用内 `remove_bundle`），再按方式一/方式二安装新名字，避免同一个
  profile 里出现新旧两个 `devicex` 层。

## 注意事项

- 本项目以 **MIT** 许可发布（[LICENSE](../LICENSE)）；npm 包内的 `plugin/LICENSE` 是同一份文件的副本。
- 这是**本机设备管理**插件，数据不出本机；每个用户的机器各自采集、各自操作，不会互相同步。
- GitHub 直装读取的是仓库**根** `package.json`；`plugin/package.json` 只服务本地 link 与 tgz 分发。
  改清单（包名 / `dsh.bundle` / `dsh.client` / 导出）时两份要同步，`node scripts/verify.mjs` 会检查。
- `device_control` 对 Agent 开放了结束进程、卸载软件、改主机名、防火墙、DNS 等高权限动作；装到共享账号的
  profile 前请确认这是预期行为。
- 需管理员权限的动作（防火墙、DNS、系统级启动项、改主机名、Wi-Fi 开关）失败时会把命令 stderr 返回给界面：
  - macOS：以管理员身份运行 DSH，或按系统提示授权；
  - Windows：改用「以管理员身份运行」启动 DeepSeek Harness（UAC 会提示一次），否则相关动作返回权限错误。
- macOS：需要自动化授权的动作（退出应用/深色模式/锁定）首次调用可能被 TCC 拒绝，按系统提示授权即可。
- Windows：BitLocker/Defender 等查询可能需要管理员权限，读不到时界面显示未知；Windows 没有等价的逐应用
  TCC 授权库，隐私面板显示为说明文案。
