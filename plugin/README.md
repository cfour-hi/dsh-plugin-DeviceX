# @cfour-hi/dsh-plugin-devicex

**Device X** — inspect every part of this device and control what can be changed
(macOS + Windows). A [DeepSeek Harness](https://github.com/cfour-hi/dsh-plugin-devicex) plugin.

## 安装

```sh
dsh plugin add @cfour-hi/dsh-plugin-devicex
```

或在 DSH 的 **Plugins** 页面粘贴包名；Agent 侧对应 `plugin_manager install_bundle`。

## 内容

| 路径 | 作用 |
| --- | --- |
| `index.js` | 插件入口：注册 `device_info` / `device_control` 两个工具、HTTP 路由与 Cordis 层 |
| `client.js` | 浏览器端单文件 bundle（由仓库的 `src/client/` 用 esbuild 生成，已随包提交，无需构建） |
| `host/` | Host 侧采集与动作实现：`collector-*`、`actions-*`、`cleanup-*`、`benchmark`、`proc`、`transport` |
| `host/win/*.ps1` | Windows 采集桥（PowerShell + CIM） |
| `locale/{en,zh}.json` | 插件管理器里的标题与描述 |
| `icon.svg` | 面板图标 |

本包不含源码、测试与构建脚本；完整源码、契约文档与验证套件在仓库中：

- 仓库：https://github.com/cfour-hi/dsh-plugin-devicex
- 安装说明：https://github.com/cfour-hi/dsh-plugin-devicex/blob/main/docs/INSTALL.md
- 发布流程：https://github.com/cfour-hi/dsh-plugin-devicex/blob/main/docs/RELEASE.md

## 许可

[MIT](https://github.com/cfour-hi/dsh-plugin-devicex/blob/main/LICENSE)。

## 注意

这是**本机设备管理**插件：数据不出本机，每个用户各自采集、各自操作。`device_control` 对 Agent 开放了
结束进程、卸载软件、改主机名、防火墙、DNS 等高权限动作；装到共享账号的 profile 前请确认这是预期行为。
需管理员权限的动作在 macOS 需要授权、在 Windows 需要以管理员身份运行 DeepSeek Harness。
