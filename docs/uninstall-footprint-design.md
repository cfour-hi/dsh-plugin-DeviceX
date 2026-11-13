# 应用卸载 + 残留足迹清理 — 设计定稿

Status: **design frozen**（2026-11-09）；**1.6.0 已实现**：macOS 完整（扫描 + 清理），
Windows 只读（见 §8.2 与决策 4 的偏差说明）。实现落地情况见 §12。

目标：卸载一个应用时，除了跑它自己的卸载程序（或把本体移走），还要找出它散落在系统里的
数据目录，**列出来让用户逐项选择**是否一起清掉。

与既有模块的关系：

| 既有能力 | 复用方式 |
| --- | --- |
| `app.uninstall`（darwin/win32） | 保留，作为流水线的第一步；**不新增第 20 个动作** |
| `cleanup.delete` + 两平台 allowlist | 保留不动；残留清理**不复用**它（理由见 §6.1） |
| `CleanupTab` 的复选框列表 + 危险确认条 | UI 模式直接复用 |
| `system.emptyTrash` | 复用，但需先修 §7.2 的 TCC 缺陷 |

---

## 1. 已定决策

| # | 决策 | 连锁后果 |
| --- | --- | --- |
| 1 | 删除一律进**废纸篓**，不做永久删除 | Windows 需新建"移入回收站"能力（现有 `removeTree` 是永久删除，见 §8.2） |
| 2 | 低置信候选**展示**，默认不勾，并给出理由 | 扫描必须做跨应用冲突检测（§4.3） |
| 3 | **不引入 REA** | 沙盒判定改用 `codesign -d --entitlements` |
| 4 | macOS / Windows **同版本**上线 | 两套发现逻辑独立，档位需重新映射（§8） |
| 5 | 卸载器**失败或被取消 ⇒ 全局中止**，不删任何数据 | 必须有"卸干净了吗"的状态校验（§5.1） |

补充定义（§5.1）：**"应用没有自带卸载器"不算失败**，直接走本体 + 残留流程。
79 个应用里只有 Docker、Tailscale 自带卸载器；若把"没有卸载器"也算失败，此功能 97% 的场景不可用。

---

## 2. 明确不做的事

### 2.1 不用 REA 做发现（实测否决）

本机（macOS 15.5、REA 6.8.0、无 Hopper 授权）实测：

| 命令 | 结果 |
| --- | --- |
| `rea analyze <Mach-O>` | `provider_unavailable` — macOS 拒绝向 Hopper 发 Apple Events |
| `rea search <asar>` | `capability_unavailable` — 四个 provider 均拒绝 archive 目标 |
| `analyze-javascript-application`（Claude.app 全量） | 698 s 后 `provider_timeout`，产出 313 MB 进度 JSON |
| `analyze-javascript-application`（限 3 个文件） | 24 s 成功，但**零条路径字面量** |
| 同上，10 行控制程序（写死 3 条 `Library/Application Support/...`） | 46 节点、**0 字面量**；`strings` 三条全中 |
| `inspect-plist` / `inspect-signature` | 各约 4 s，可用（但等价于 `plutil` / `codesign`） |

根因有两层，都不是"换个参数"能解决的：

1. **原生二进制本就不存路径字面量**。抽查 IINA / Motrix / Termius / Charles，`Library/...`
   字面量均为 **0 条**（仅 Proxifier 有 4 条）——它们用 `NSSearchPathForDirectoriesInDomains`
   之类 API 在运行时拼路径。
2. **Electron 的路径在 JS 里，但 REA 的 AST 图不保留字符串字面量**，且有 20000 节点/文件上限。

决定性的反例：`~/Library/Application Support/Claude-3p` 占 **11 GB**，既不含 bundle id
（`com.anthropic.claudefordesktop`），也不含 `Library/` 形式的引用。REA、`strings`、
bundle-id 模板**全都漏它**，只有"目录名像 App 名"这一条能捞回来。

→ **结论：REA 不进入本功能。** 不做证据留档，不引入 npx 依赖。

### 2.2 其他不做

- 不删 vendor 级共享目录（`Application Support/Google`、`Microsoft`、`Adobe`）。
- 不接调用方传入的任意路径做删除（§6）。
- 不静默跑 GUI 型卸载器。
- 不假装能提权：`/Library`、PrivilegedHelperTools、LaunchDaemons 一律标"需手动处理"。

---

## 3. 发现机制：四路来源

单应用端到端耗时实测（含建索引）：**IINA 16 ms、Claude 11 ms、Telegram 186 ms、Docker 20 ms**；
`~/Library` 12 个根建索引 **8 ms / 2325 项**。离线、可复现、无外部依赖。

| 来源 | 优先级 | 说明 |
| --- | --- | --- |
| `S1` Bundle ID | 高 | 精确匹配 + 后缀匹配（`.ShipIt`、`.helper` 等）；扫 12 个根 |
| `S2` 名称启发式 | 中 | App 名 slug 前缀/相等匹配；**Claude-3p 只能靠这条** |
| `S3` Homebrew zap | 高 | `Caskroom/*/.metadata/INSTALL_RECEIPT.json` 的 `uninstall_artifacts[].zap` |
| `S4` entitlements | 判定 | 有 `com.apple.security.app-sandbox` → 只扫容器；否则扫 `~/Library` |

补充说明：

- **Group Containers 带 Team ID 前缀**，匹配前须剥离 `^[A-Z0-9]{10}\.` 与 `^group\.[A-Z0-9]{10}\.`。
  实例：`6N38VWS5BX.ru.keepcoder.Telegram`、`group.W5364U7YZB.io.tailscale.shared`。
- `pkgutil --files <receipt>` **只列 bundle 内文件**（Amphetamine 144 条全在 `.app` 里），
  查不到数据目录；但它能判断"这是 pkg 安装的"，可提示可能存在厂商卸载器。
- `mdfind` 不可靠（Claude-3p 命中零条），仅作可选补充，不作为来源。

### 3.1 扫描根（macOS）

用户域 12 个：`Application Support`、`Caches`、`Preferences`、`Preferences/ByHost`、`Logs`、
`HTTPStorages`、`WebKit`、`Cookies`、`Saved Application State`、`Containers`、`Group Containers`、
`Application Scripts`。

系统域（只读展示，删除标"需管理员"）：`/Library/Application Support`、`/Library/Caches`、
`/Library/Preferences`、`/Library/Logs`、`/Library/LaunchAgents`、`/Library/LaunchDaemons`、
`/Library/PrivilegedHelperTools`。

---

## 4. 置信档位（决策 2 的落地）

| 档 | 判定 | 默认勾选 | 呈现 |
| --- | --- | --- | --- |
| **A 高置信** | S1 精确/后缀匹配、S3 zap 命中、MSIX `PackageFamilyName` | ✅ | 正常行 |
| **B 名称候选** | S2 命中，且该目录**只**匹配到这一个已装应用 | ❌ | 正常行 + 标签「按名称推测」+ 理由文本 |
| **C 冲突候选** | 同一目录匹配到 ≥2 个已装应用 | ❌ | 正常行 + 行内「也可能属于：XXX」 |
| **D 共享厂商目录** | vendor 级（`Google/`、`Microsoft/`） | — | **只读行，无复选框**，仅显示体积 |

### 4.1 为什么 B/C 要展示而不是隐藏

1. 不展示 ⇒ 招牌场景失效：卸载完显示"已清理 1 MB"，用户认为工具没用（Claude-3p 11 GB 被漏掉）。
2. 决策 1 选了废纸篓，误删代价从"不可逆"降为"可还原"，这是敢展示低置信项的前提。
   若决策 1 是永久删除，B/C 只应进日志、不进弹窗。
3. 产品定位是"列出来让用户选"；藏起来等于替用户判断，而判断依据（名字像）恰恰用户比机器懂。

### 4.2 必须的两个防呆

- **弹窗底部固定显示**「另有 N 项候选未选中（共 X GB）」。否则用户直接点确认，大目录静默滑过。
- **每行给可读理由**，如「目录名与 App 名相似：Claude ≈ Claude-3p」。可解释性比置信度数字有用。

### 4.3 冲突检测必须全局

判定 B vs C 需要**全部已装应用**参与，不能只看当前这一个。实测反例：豆包（`Doubao`）与
豆包工作浏览器（`DoubaoWork`）——`doubao` 前缀同时命中 `doubaowork`。另有纯名称假阳性：
`Code` 会命中 `Code` / `Codex` / `CodeBuddyExtension`。

---

## 5. 流程与状态机

顺序不可颠倒：**先跑卸载器 → 校验已卸干净 → 再复扫 → 才删残留**。否则会把卸载器本该删的东西
算成残留，或卸载器在删除后重建。

```
[idle]
  ↓ 用户点"卸载…"（带已记录的本体路径 / uninstallId）
[scan-pre]        只读：S4 判沙盒 → S1/S2/S3 → 生成报告 + scanId
  ↓
[confirm]         用户勾选（A 默认勾，B/C 默认不勾，D 只读）
  ↓ 用户点"卸载并清理"
[uninstall]
  ├─ 有卸载器 → 执行（GUI 型另行处理，见 §5.2）
  ├─ 无卸载器 → 视为正常，直接进 [trash-app]
  ↓
[verify]          本体是否消失 / 注册表卸载键是否消失
  ├─ 未消失 → [aborted]（决策 5，零副作用）
  └─ 已消失 ↓
[trash-app]       本体进废纸篓（失败 → [aborted]）
  ↓
[scan-post]       复扫，重算体积与存在性（卸载器可能已清掉一部分）
  ↓
[trash-residue]   逐项移入废纸篓，流式报告进度，单条失败不中断
  ↓
[done]            汇总：已清理 / 跳过 / 失败 / 需管理员 / 需重启
```

### 5.1 `verify` 不能只看退出码

MSI 的 3010/1641、厂商脚本的 0 都可能骗人。判定依据是**客观状态**：

- macOS：`.app` 路径不存在（`lstat` → ENOENT）；
- Windows：注册表 `Uninstall\<key>` 消失，或 `InstallLocation` 不存在。

`verify` 失败 ⇒ 全局中止，提示"卸载未完成，未删除任何数据"。这比任何二次确认都有效，
因为它把失败路径变成零副作用路径。

### 5.2 GUI 型卸载器

Docker 和多数商业软件是 GUI 卸载器，无法静默完成。处理方式：

1. 用 `open -a` 启动卸载器（不等待）；
2. 弹窗转为"请在卸载窗口中完成… [我已完成] [取消]"；
3. 用户点"我已完成"后**同样跑 `verify`**；
4. `verify` 不通过 ⇒ 中止。用户声称完成不算数。

---

## 6. 契约增量

### 6.1 为什么不复用 `cleanup.delete`

既有安全基线是**"删除永不接受调用方给的路径"**：`cleanup.delete` 只收 id，id 映射到模块
加载时算好的固定绝对路径；`scripts/verify-cleanup.mjs` 还有静态断言"没有任何非白名单路径
能到达 `fs.rm`"。

而残留目录天生是运行时才出现、每个应用都不同的路径，**静态白名单装不下**。

→ 保留 `cleanup.delete` 原样；残留清理用**扫描令牌**解决同一问题（§6.3）。

### 6.2 不加第 20 个动作

动作目录冻结在 19 个（`test/action-contracts.test.mjs` 与 `scripts/verify.mjs` 都硬断言
`catalog.length === 19`）。**扫描是只读操作，本来就不该进动作目录**——目录里的每一条都带
`danger` 等级、需要确认、会写动作历史，那是"写操作"的语义。

因此：

| 表面 | 变更 | 影响断言 |
| --- | --- | --- |
| `app.uninstall` | **加可选参数** `scanId`、`itemIds[]`、`cleanup: 'trash' \| 'none'` | 无（参数数量不受约束） |
| 新增只读路由 `GET /devicex/api/footprint` | 扫描 → 返回报告 + `scanId` | 无 |

**动作目录仍是 19 个，`types/contracts.ts` 的 `ActionId` 不需要改。** 这是本设计刻意避免
破坏冻结契约的地方：读走读路由，写只扩既有动作的参数。

### 6.3 扫描令牌（安全模型的核心）

- `GET /devicex/api/footprint` 返回 `scanId` + 清单，**完整路径集合只留在服务端内存**；
- TTL 10 分钟、单次卸载隔离、条目上限 200、`scanId` 一次性消费；
- `app.uninstall` 只接受 `(scanId, itemIds[])`，服务端校验：
  1. `scanId` 存在且未过期、未消费；
  2. 每个 `itemId` 属于该 scan；
  3. `realpath` 后仍落在受控根列表内（12 用户根 + 7 系统根 + 应用本体路径）；
  4. 拒绝根目录本身（不得删 `~/Library/Caches` 之类）；
  5. 拒绝符号链接（`lstat().isSymbolicLink()` → 跳过并报告）。

第 3 条在**删除前一刻**执行，用于防 TOCTOU（扫描后被替换成指向 `~/` 的符号链接）。

### 6.4 数据形状

```ts
type FootprintConfidence = 'high' | 'medium' | 'conflict' | 'shared';
type FootprintSource = 'bundle-id' | 'name-match' | 'brew-zap' | 'entitlements' | 'registry' | 'msix';

interface FootprintItem {
  id: string;                 // 仅在本 scan 内有效
  kind: 'app' | 'data' | 'container' | 'shared' | 'system';
  path: string;
  displayPath: string;        // ~ 缩写后的展示形式
  bytes: number;
  files: number;
  confidence: FootprintConfidence;
  source: FootprintSource;
  reason: string;             // 可读理由，直接进 UI
  alsoMatchedBy?: string[];   // C 档：还命中哪些已装应用
  requiresAdmin: boolean;
  exists: boolean;
  warning?: string;
}

interface FootprintReport {
  scanId: string;
  appPath: string;
  bundleId: string | null;
  sandboxed: boolean;
  targetedRoots: string[];    // S4 判定后实际扫过的根
  generatedAt: number;
  durationMs: number;
  items: FootprintItem[];
  totalBytes: number;
  selectedBytes: number;
  errors: string[];
}
```

### 6.5 HTTP 路由

现有 6 条：`/metrics`、`/inventory`、`/actions`、`/action`、`/cleanup`、`/benchmark`
（注：`plugin/host/transport.js` 头注释写"four routes"，已过期，顺手修）。

新增 **1** 条只读路由：

- `GET /devicex/api/footprint?path=<app path>` → `FootprintReport`
  （`fresh=1` 绕过缓存，与 `/inventory` 的查询参数风格一致）

**不新增写路由**：残留删除复用既有 `POST /devicex/api/action`，action 为 `app.uninstall`，
参数带 `scanId` / `itemIds[]` / `cleanup`。这样写表面一个不变，只读表面加一个。

新增路径需过 Connection 信任栅栏（与既有路由一致）；`app.uninstall` 照常计入 50 条动作历史。

---

## 7. macOS 实现要点

### 7.1 `moveToTrash` 必须泛化（现有实现有 3 个缺陷）

现有 `actions-darwin.js` 的 `moveToTrash(source)` 是给 `.app` 写的，直接复用到数据目录会出问题：

1. **硬编码 `.app` 后缀**：`path.basename(source).replace(/\.app$/i, '')` 之后又拼回 `.app`，
   数据目录会被命名成 `com.colliderli.iina-1794180039186.app`。必须按源类型决定后缀。
2. **`fsp.rename` 会静默覆盖**：实测把文件 rename 到已存在的目标路径，目标被直接覆盖
   （内容变成后写入的）。现有实现靠一次 `fsp.access()` 探路，存在竞态。
   **必须改为原子占位**：目录用 `fsp.mkdir(dest)`（已实测，重名时 `EEXIST`），
   文件用 `fsp.open(dest, 'wx')`（已实测，重名时 `EEXIST`）；占位成功后再 `rename` 覆盖自己的占位符。
3. **EXDEV 分支**只在 `rename` 失败后判断，但 `fsp.cp` 也可能 EE 失败，缺少部分移动的回滚说明。

### 7.2 废纸篓在此机器上不可枚举（TCC）— 影响两处既有功能

实测（本机 macOS 15.5，宿主进程为普通用户权限）：

| 操作 | 结果 |
| --- | --- |
| `fsp.readdir(~/.Trash)` | **EPERM** |
| `du -sk ~/.Trash` | Operation not permitted |
| `fsp.rename(src, ~/.Trash/x)` | ✅ 成功 |
| `fsp.stat` / `du` 已知的 `~/.Trash/x` | ✅ 成功 |
| `fsp.rm` 自己刚 rename 进去的 `~/.Trash/x` | ✅ 成功 |

两个既有功能因此**在本机是坏的**（不是设计缺陷，是环境事实，需在文档和错误文案里如实呈现）：

- `system.emptyTrash` 走 `fsp.readdir` → 返回 `TRASH_READ_FAILED`；
- `cleanup` 扫描器对 `trash` 项返回 `bytes: 0` + `EPERM` 错误串。

→ 设计约束：**残留清理流程不得依赖"读废纸篓"**。移动后不校验、不统计废纸篓体积，
只在内存里记录 `原路径 → 废纸篓目标路径` 的映射（§7.4）。`emptyTrash` 的修复单列，见 §9.3。

另一观察（原因未确认，如实记录）：一个经 Finder 移入废纸篓的文件落成了 `group=wheel`，
此后 `rm` / `chmod` / `read` 全部 EPERM，无法从废纸篓移出或删除，成为**卡死的垃圾项**。
同样经 Finder 移入的另一个文件却可正常删除。→ 说明"进废纸篓"不是绝对可逆的，
UI 文案不能承诺"随时可还原"。建议文案用"已移入废纸篓（可在访达中查看）"。

### 7.3 沙盒判定

```
codesign -d --entitlements - <bundle> | grep -c com.apple.security.app-sandbox
```

实测：Amphetamine / Telegram 命中，IINA / Claude 不命中。
有 sandbox 键 → 主要足迹在 `~/Library/Containers/<bundleId>` 与
`~/Library/Group Containers/<TEAMID>.<group>`；无 → 扫 `~/Library` 全量 12 根。
**两路都扫**，只是 sandboxed 时把容器类结果提到 A 档、`~/Library` 直下结果降权。

### 7.4 必须记录的映射

动作历史里存 `原路径 → 废纸篓目标路径`。macOS 废纸篓会给重名项加时间戳后缀（实测 Finder 产出
`SomeData 07.20.52`），用户想手工还原时没有映射基本找不到东西。成本极低、收益很高。

---

## 8. Windows 实现要点

### 8.1 起点更好，但命名匹配更弱

已采集到 `DisplayName`、`InstallLocation`、`DisplayVersion`、`EstimatedSize`、注册表 key path、
`uninstallId`。但：

- **没有 bundle id**，只能按 DisplayName / Publisher 名称匹配 → 假阳性比 macOS 更高，
  B/C 档的冲突检测更要紧；
- `mapSoftware`（`collector-win32.js`）**当前丢弃了 `publisher`**，而 `software.ps1` 已经采到了。
  做名称匹配前需先把 `publisher` 透传到前端（纯增字段，不破坏既有形状）。

### 8.2 "废纸篓"（决策 1）在 Windows 是**新能力**

现有 `cleanup-win32.js` 的 `removeTree` 用 `fsp.rm` — **永久删除**，`removeTree`/`deleteItem`
两个平台都不走回收站。`cleanup` 的 `recycle-bin` 项只是"清空回收站"，不是"移入回收站"。

→ 必须新建"移入回收站"：`Shell.Application` 的 `NameSpace(0xA).MoveHere` 或
`SHFileOperation` + `FOF_ALLOWUNDO`。**此路径未在 Windows 主机上验证**（本机是 macOS），
实现时必须以 Windows 实测为准，并在失败时明确降级提示（绝不静默改成永久删除）。

### 8.3 档位映射

| 档 | Windows 判定 |
| --- | --- |
| A | MSIX/Store 的 `%LOCALAPPDATA%\Packages\<PackageFamilyName>`（天然精确足迹）；MSI 的 `InstallLocation` + 注册表 `Software\<Vendor>\<Product>` 树 |
| B | `%APPDATA%` / `%LOCALAPPDATA%` / `%PROGRAMDATA%` 下按 DisplayName / Publisher 名称匹配 |
| C | 同目录命中 ≥2 个已装应用 |
| D | `ProgramData\Package Cache`、`%LOCALAPPDATA%\Temp` 等共享目录，只读 |

### 8.4 Windows 独有的"系统项"

不是文件，但卸载残留清单不给出来会显得不完整。**单列一节「系统项（需手动处理）」**：
服务、计划任务、`Run` 键、防火墙规则、`ProgramData` 下的厂商目录。

### 8.5 源码约束

`cleanup-win32.js` / `actions-win32.js` / `host/win/*.ps1` 必须 **ASCII-only**
（`scripts/verify-cleanup.mjs`、`verify-sensors.mjs` 有静态断言）。新增的 PowerShell 片段
不能含中文，中文只出现在 locale / dicts。

---

## 9. 验收目标与待办

### 9.1 可量化目标（本机已测得基线）

| 指标 | 目标 | 基线实测 |
| --- | --- | --- |
| Bundle ID 召回 | ≥ 75% | **61/79 = 77%** |
| + 名称启发式增量 | ≥ +8 pp | **+10 个应用 → 87%** |
| 单应用扫描耗时 | < 500 ms | **11–186 ms** |
| 共享厂商目录误报 | 0 | D 档只读，逻辑上为 0 |
| brew zap 回归 | IINA 命中 6 条现存 + glob | 14 条中 6 条存在 |

### 9.2 必做（阻塞上线）

1. `moveToTrash` 泛化 + 原子占位（§7.1 三个缺陷）。
2. 扫描令牌 + `realpath` 校验 + 符号链接拒绝（§6.3）。
3. `verify` 状态校验（§5.1）。
4. Windows 回收站移动能力 + Windows 实测（§8.2）。

（动作目录保持 19 个，无断言改动 —— 见 §6.2。）

### 9.3 应做

6. `system.emptyTrash` 的 TCC 修复（改用 `osascript` Finder 或 `NSFileManager`；
   实测 Finder 路径可用，且能取回目标路径）。
7. `mapSoftware` 透传 `publisher`。
8. `transport.js` 头注释 "four routes" 改为实际数量。

### 9.4 验证脚本

新增 `scripts/verify-footprint.mjs`，风格对齐 `verify-cleanup.mjs`：

- 离线、只读：用固定 fixture 目录树验证四路来源与档位归类；
- 静态守卫：断言删除路径永远经过 scanId 校验，不接受裸路径；
- 零副作用：脚本自己在 `os.tmpdir()` 建沙箱，不碰真实 `~/Library`；
- ASCII 守卫：Windows 源码仍为 ASCII。

---

## 10. 已知风险

| # | 风险 | 缓解 |
| --- | --- | --- |
| 1 | 漏检大目录（Claude-3p 11 GB 只能靠名称） | B/C 档展示 + 底部"未选中"汇总 |
| 2 | 误删共享 vendor 目录 | D 档只读，无复选框 |
| 3 | 应用仍在运行 → 文件被重建 / 删除失败 | 先 `app.quit` 并轮询进程退出，超时中止 |
| 4 | `/Library`、PrivilegedHelperTools 需管理员 | 标"需手动处理"；无提权通道，不假装能删 |
| 5 | 大体积删除耗时（实测 9.3 GB `du` 4.1 s） | 流式进度、超时、可中断 |
| 6 | TCC 保护目录读得到删不掉 | 单条失败不中断，显式 `error` 字段 |
| 7 | 废纸篓不可枚举、个别项会卡死（§7.2） | 不依赖读废纸篓；文案不承诺"随时可还原" |
| 8 | `rename` 覆盖导致数据丢失（§7.1） | 原子占位后再 rename |
| 9 | glob 类残留（`*.sfl*`、`IINA*.crash`） | 借 Homebrew zap 的成熟规则集当规则库 |

---

## 11. 文案要求

- 废纸篓 ≠ 释放空间。结果页必须写「**清空废纸篓后释放 X GB**」，并提供跳转清理页入口
  （复用 `system.emptyTrash`）。不写这句，用户会以为已经腾出空间。
- 不做"随时可还原"的承诺（§7.2 有卡死实例），用「已移入废纸篓（可在访达中查看）」。
- 中止时明确写「卸载未完成，**未删除任何数据**」。
- B/C 档每行必须带可读理由，不能只给置信度标签。

---

## 12. 实现落地（1.6.0）

### 12.1 文件

| 文件 | 作用 |
| --- | --- |
| `plugin/host/footprint-core.js` | 纯逻辑内核（无任何 import）：Team ID 剥离、slug、档位判定、去重、合计 |
| `plugin/host/footprint-darwin.js` | macOS 扫描：12 用户根 + 7 系统根、brew zap、`codesign` 判沙盒 |
| `plugin/host/footprint-win32.js` | Windows 扫描：MSIX `Packages`、名称匹配、`%PROGRAMDATA%` 标管理员 |
| `plugin/host/footprint.js` | dispatcher + 扫描令牌（TTL 10 min、一次性、上限 16/200） |
| `plugin/host/uninstall.js` | 共享流水线状态机 |
| `plugin/host/actions-darwin.js` | `app.uninstall` 扩参 + 流水线适配器 + 修复后的 `moveToTrash` |
| `src/client/components/UninstallFootprintModal.tsx` | 四档弹窗 |

### 12.2 实现中发现并修复的问题

设计评审阶段没看到、写代码和测试时才暴露的问题：

1. **`fsp.rename` 静默覆盖**（设计 §7.1 已预判）：加 `mkdir` / `open('wx')` 原子占位，8 项回归测试锁死。
2. **采集器把同一 bundle 报三次**：`com.anthropic.claude-code` 重复 3 行，使单个已装应用看起来
   像 3 个竞争者，把 Claude 的所有名称匹配全降级成 `conflict`。新增 `dedupeApps()`。
3. **厂商目录污染**：初版把 `Application Support/Google`（17 GB）、`Microsoft`、`Mozilla`
   全列进 IINA 的卸载清单——它们与 IINA 无关。新增 `vendorHoldsSubject()`：厂商目录只在
   确实含目标应用数据时才保留，否则整条丢弃。
4. **Windows 目录名带空格**：`%APPDATA%\Acme Widget` 永远匹配不上 slug。`ownersOf` 改为比对
   slug 化后的形式。
5. **slugify 去掉分隔符反而破坏匹配**：`Claude-3p → claude3p` 不再匹配 `claude`。
   改为分隔符折叠成 `-`；另加 `compactSlug()` 供 MSIX 包名（无分隔符约定）使用。
6. **校验门槛放错位置**：初版对所有应用都校验"是否已消失"，导致 77 个没有卸载器的应用
   永远中止。改为**只在卸载器真的跑过之后**才作为门槛。
7. **初始选中项没进请求**：复选框初始 checked，但 `modal.selection` 只在用户点击时才回填，
   首次确认会提交空列表。改为扫描完成后立即播种默认选中集。
8. **管理员项被展示为可删**：主机对 `requiresAdmin` 项一律拒绝，UI 却给了复选框。
   normalizer 改为 `selectable = !adminOnly && ...`。
9. **concat 构建漏文件**：`build-client-concat.mjs` 的 `MODULE_ORDER` 是显式清单，
   新组件没加进去，导致 concat 产物渲染时 `ReferenceError`。

### 12.3 与决策 4 的偏差（Windows）

决策 4 要求双平台同版本上线。Windows 现状：

- **已实现**：只读扫描（MSIX 容器 A 档、名称匹配 B/C 档、`%PROGRAMDATA%` 标管理员）。
- **未实现**：移入回收站。`app.uninstall` 收到 `scanId` 时**明确拒绝**并返回
  `UNSUPPORTED_PLATFORM`，而不是"卸载完再静默忽略用户的选择"。
- **原因**：`Shell.Application` / `SHFileOperation` 无法在 macOS 上验证，本插件不会发布
  未在真机验证过的破坏性路径。
- **补齐条件**：一台 Windows 真机跑通"移入回收站 → 可从回收站还原"即可接线，
  流水线与令牌机制已经平台无关，`uninstall.js` 无需改动。

### 12.4 验证

| 套件 | 数量 |
| --- | --- |
| `npm test` | 119 |
| 客户端渲染断言（两种产物各跑一遍） | 282 |
| `verify.mjs` | 96 |
| `verify-windows.mjs` | 167 |
| `verify-sensors.mjs` | 57 |
| `verify-cleanup.mjs` | 130 |
| `verify-benchmark.mjs` | 46 |
| `verify-footprint.mjs`（新增） | 72 |

### 12.5 补充约束：macOS 不执行厂商自带卸载器

评审时假设「有卸载器就跑它」。实现时检查了两个真实存在的情况，决定**不在 macOS 执行任何
bundle 内卸载器**：

- Docker 的 `Contents/MacOS/uninstall` 是一个 Go 二进制，Tailscale 的是 AppleScript；
  两者都没有可验证的命令行契约，`--uninstall` 只是我们的猜测；
- 用一个猜测的参数去跑一个会动系统组件的卸载器，最坏结果是**半卸载**：它删了一部分、
  失败了，而流水线在 verify 阶段中止 —— 用户得到一个坏掉的 Docker，且我们什么都没有清理。

所以 darwin 适配器固定传 `hasUninstaller: false`，走「本体进废纸篓 + 残留清单」。
`uninstall.js` 的卸载器路径仍然保留并被单测覆盖 —— Windows 的 MSI / winget / 注册表
三条路是**有确定命令行契约**的，那里才用。

`verify-footprint.mjs` 有一条静态守卫锁死这一点：源码里出现 `runVendorUninstaller`
或缺少 `hasUninstaller: false` 就报错。
