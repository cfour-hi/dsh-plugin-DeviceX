# 发布流程（npm + GitHub Release）

发布由 tag 驱动：`git push origin v1.5.0` 触发 `.github/workflows/release.yml`，先跑与 `main` 完全相同的验证门，
再把**通过审计的同一份 tarball** 发布到 npm，并把该文件挂到 GitHub Release 上。日常发版不需要任何 token。

```
push tag v*.*.*
   └─ verify（复用 .github/workflows/verify.yml：build --check → tsc → test → verify:build → 五套离线验证）
        └─ publish（ubuntu-latest，npm 11.21.2，OIDC 换 token）
             ├─ **npm-release 环境审批**：reviewer 点 Approve 后 job 才开始执行
             ├─ check-release-version：tag / 两份清单 / CHANGELOG / repository 对齐
             ├─ 包备好：tag 指向 origin/main 上的提交
             ├─ pack-release：npm pack + tarball 内容审计
             ├─ 已发布？→ 已存在则跳过 publish，只对账 Release（可安全重跑）
             ├─ npm publish dist/<tgz> --access public --provenance --tag <latest|next>
             └─ gh release：不存在则创建，存在则 --clobber 替换附件
```

## 一次性配置

> 前提：仓库 **public**（provenance 只对公开仓库生成）；操作账号对 `@cfour-hi` 有发布权限并开了 2FA。

### 1. 第一次发布必须 bootstrap

npm 的 Trusted publishing **只能配置在已存在的包上**：`npm trust` 明确要求包已上架，网页端的
"Trusted publishing" 设置页也只出现在已发布包的设置里。本仓库的包名目前在 registry 上还是 404，
所以第一次发布只能二选一：

**路径 A（推荐，仍由 CI 完成首发）**

1. 生成一个有 `@cfour-hi` 发布权限的 Granular Access Token；
2. 仓库 Settings → Secrets and variables → Actions 新增 `NPM_TOKEN`；
3. Actions → **release** → *Run workflow*，`dry_run` 选 **false**，`version` 留空（用清单里的 1.5.0）；
   工作流跑完 verify 后会停在 **Review deployments**，点 **Approve** 批准；
   随后打包 → 用 token 发布（会打印 warning 说明走了 token 路径）；
4. 推 tag 后由 tag 运行补上 GitHub Release（此时版本已在 npm 上，publish 自动跳过）；
5. 立刻按第 2 步配置 Trusted publishing，然后**删除 `NPM_TOKEN` secret**。
   只要 secret 还在，后续每次发布都会优先用 token 而不是 OIDC（工作流会持续告警）。

**路径 B（不用任何 CI token）**

```sh
cd plugin && npm publish --access public      # 手工首发，仅此一次（2FA）
```

之后按第 2 步配置 Trusted publishing；`v1.5.0` 的 GitHub Release 依然可以补：推 tag 后工作流发现版本已存在，
会跳过 publish 直接建 Release。第一个真正由 CI 发布的版本是下一个版本（1.5.1）。

### 2.5 实测到的两个操作细节

- **2FA 是安全密钥（WebAuthn）时没有 6 位验证码**：npm 会走浏览器授权，命令打印
  `Authenticate your account at: https://www.npmjs.com/auth/cli/<id>`，在浏览器里用安全密钥确认即可。
  非 TTY 环境下这个链接会被显示成 `***`，需要伪终端才能看到完整地址（例如
  `script -q /dev/null npm publish ...`）。`npm publish` 与 `npm trust` 各需要一次确认。
- **新包发布后 registry 可能先返回 404**：CLI 会提示
  *"Your package is being processed and may take a few minutes to become available"*，
  实测约 3–5 分钟后 `https://registry.npmjs.org/<pkg>` 才返回 200。期间
  `npm access list packages <scope>` 已经能看到包记录，可据此判断"已提交、正在生效"，不必重发
  （npm 也不允许重发同一版本）。

> 新配置的 trusted publisher 有 **2 天窗口**：必须在 2 天内完成一次成功的可信发布，否则配置失效，需要重新配置。

### 2. 配置 Trusted publishing（包已存在后）

```sh
npm login          # 必须 2FA，npm >= 11.15
npm trust github @cfour-hi/dsh-plugin-devicex \
  --repo cfour-hi/dsh-plugin-devicex \
  --file release.yml \
  --env npm-release \
  --allow-publish \
  --dry-run        # 先确认，再执行真正的命令
```

`--allow-publish` 不能省：2026-09-03 之后新建的 trusted publisher 默认**只允许 stage publish**，而本工作流直接
`npm publish`。网页端等价操作是在 *Allowed actions* 里勾选 **npm publish**（不是 staged publishing）。

| 字段 | 值 |
| --- | --- |
| Organization | `cfour-hi` |
| Repository | `dsh-plugin-devicex` |
| Workflow filename | `release.yml` |
| Environment | **`npm-release`**（与工作流里的 `environment:` 完全一致；写成别的名字或留空都会 403） |
| Allowed actions | **npm publish**（勾上，否则 403） |

配置完成后 `npm trust list @cfour-hi/dsh-plugin-devicex` 应能看到这条关系。

### 3. 确认没有被遗留的 token

Secrets 里不应再存在 `NPM_TOKEN`；工作流优先 OIDC，token 只作为 bootstrap 逃生通道。

## 日常发版

1. **版本号同步**（`verify.mjs` 强制 root 与 plugin 的 name/version 一致）：

   ```sh
   npm version patch --no-git-tag-version   # 更新 root package.json 与 package-lock.json
   ```

   再把 `plugin/package.json` 的 `version` 改成同一个值。
2. **CHANGELOG 置顶一条**：`## <version> — <摘要>`，正文非空。
3. **本地预检**：

   ```sh
   npm run verify:ci                       # 与 CI 完全一致的门
   npm run release:check -- --tag v1.5.0   # tag / 两份清单 / CHANGELOG / repository 对齐
   npm run release:pack                    # 打包并审计 tarball（dist/，不进仓库）
   ```
4. **推 main，再打 tag**：

   ```sh
   git commit -am "chore(release): 1.5.0"
   git push origin main
   git tag -a v1.5.0 -m "1.5.0"
   git push origin v1.5.0
   ```
5. **看 Actions 并审批**：`verify` 绿了才进 `publish`，此时运行会停在 **Review deployments**（`npm-release`
   环境）等你点 **Approve**；批准后才会真正发布。完成后 npm 与 Releases 各一份产物（同一个文件）。
   *dry run 也走同一个审批门*——这是有意的：被批准的那条路径就是被验证的路径。

发布前会拦下四类问题，不会产生"半发布"：tag 与两份清单/CHANGELOG 不一致、tag 不在 `origin/main` 上、
目标版本已存在于 npm、目标版本会把 `latest` 往回指。

> **发布前的仓库清单**：仓库 public；Trusted publishing 已配置且允许 *npm publish*；两份清单的
> `repository.url` 与仓库一致（`check-release-version.mjs` 会核对，provenance 依赖它）；
> 许可证 —— MIT：两份清单的 `license` 一致、`plugin/LICENSE` 与根 `LICENSE` 一致（脚本会校验）。

## 手动 dry run 与重跑语义

Actions → **release** → *Run workflow*，`dry_run` 默认 **true**：

| 触发 | dry_run | 行为 |
| --- | --- | --- |
| 手动 | `true` | 只做 verify + 打包；tgz 作为 Actions artifact 保留 14 天；不碰 npm、不建 Release |
| 手动 | `false` | verify + 打包 + 发布；**不建 Release**（Release 只由 tag push 触发） |
| tag push | — | verify + 打包 + 发布（若未发布）+ Release（不存在则建，存在则替换附件） |

重跑同一个 tag 是安全的：若该版本已在 npm 上，publish 步骤自动跳过，Release 步骤把缺失的 Release 建出来、
或把附件用 `--clobber` 换成当前提交构建的产物。所以"已发布但 Release 创建失败"只需重跑那次运行即可修复，
不需要 `npm unpublish`。

## 预发布版本

版本号带 `-` 后缀（如 `1.6.0-rc.1`）会被识别为预发布：

- npm 用 `--tag next` 发布，**不会移动 `latest`**（安装需 `npm i @cfour-hi/dsh-plugin-devicex@next`）；
- GitHub Release 自动勾选 *pre-release*；
- 两份清单与 CHANGELOG 仍要用完整版本号（含后缀）；
- 若目标版本低于当前 `latest`，非预发布会被拒绝（防止 `latest` 回退），预发布不受影响。

## 失败排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `npm ERR! 403` 且提示 trusted publisher / not authorized | 没配置 trusted publisher，或 org / repo / workflow 文件名不符（必须是 `release.yml`），或 **Environment 不一致** | `npm trust list` 核对；工作流与 npm 端都必须填 `npm-release` |
| `npm ERR! 403` 但 trusted publisher 看起来正常 | 新配置默认只允许 **staged publishing** | 加 `--allow-publish` 重新配置，或网页端勾选 *npm publish* |
| 配置了 trust 却 2 天后仍 403 | 新配置的 2 天窗口内没完成首次成功发布而失效 | 重新执行 `npm trust github …` |
| `npm ERR! 404` / ENEEDAUTH（首次发布） | 包还不存在，OIDC 无从认证 | 按上文“第一次发布必须 bootstrap”做一次 |
| `npm ERR! 403 … cannot publish over previously published version` | 该版本已在 npm 上；正常流程会自动跳过，说明是并发/历史遗留 | 不要重发同一版本；版本号前移 |
| `::error::… would move the latest dist-tag backwards` | 想发布的版本低于当前 `latest` | 用更高版本；预发布请带 `-` 后缀 |
| `::error::… is not on top of origin/main` | tag 打在未推送/旧提交上 | 先 `git push origin main` 再打 tag |
| `FAIL repository.url is …` | 清单里的 repository 与仓库不符（provenance 会失败） | 改两份清单的 `repository.url` |
| `FAIL root package.json version is …` | 两份清单版本不一致 | 同步 root 与 `plugin/package.json` |
| `FAIL CHANGELOG.md has no "## x.y.z" section` | 忘写 CHANGELOG | 补一条再打 tag |
| `gh: Release … already exists` | 旧实现会撞车；现在走 `--clobber` 替换附件 | 若仍出现，手动 `gh release upload <tag> dist/<tgz> --clobber` |
| `verify` 超时（25 min） | macOS runner 上离线套件变慢 | 排查死循环的采集逻辑，或再调大 `timeout-minutes` |

## 撤回与回滚

- **npm 版本**：发布后 48 小时内可 `npm unpublish <pkg>@<ver>`；超过 48 小时只能
  `npm deprecate <pkg>@<ver> "reason"`，再用新版本修复。不要为了"重发同一版本"去移动 tag。
- **GitHub Release**：可直接编辑/删除 Release（tag 保留），或标记为 pre-release。
- **tag**：视为不可变。内容有问题时前移版本号重新发布，并在 CHANGELOG 说明。

## 许可证一致性

- 仓库根 `LICENSE` 与 `plugin/LICENSE` 必须逐字节一致：npm 只打包包目录内的文件，根部的 `LICENSE`
  不会进 tarball，所以包内那份是发布用的副本。
- 两份 `package.json` 的 `license` 必须相同（当前 `MIT`）。
- 以上三项由 `npm run release:check` 与 `npm run release:pack` 校验（`pack-release` 还会核对 tarball 内的
  `package/LICENSE` 与仓库根 `LICENSE` 是否一致）。

## 发布审批（Environment）

`publish` job 绑定 GitHub Environment **`npm-release`**，任何一次发布（含手动 dry run）都会先停在
*Review deployments* 等待审批，批准后 job 才开始跑。已在本仓库配置：

| 项 | 值 |
| --- | --- |
| Environment | `npm-release` |
| Required reviewers | `cfour-hi`（仓库 owner） |
| Prevent self-review | 关闭 —— 单人维护时自己可以批准；要强制双人复核就打开它并再加一个 reviewer |
| Admin bypass | 默认开启（`can_admins_bypass`），管理员可在紧急情况绕过 |

复现或修改（仓库 path 换成自己的）：

```sh
# 查看现状
gh api repos/cfour-hi/dsh-plugin-devicex/environments/npm-release \
  --jq '{name, rules: [.protection_rules[] | {type, prevent_self_review}]}'

# 重新设置 required reviewers（uid 换成审批人）
uid=$(gh api user --jq .id)
gh api -X PUT repos/cfour-hi/dsh-plugin-devicex/environments/npm-release \
  --input <(printf '{"reviewers":[{"type":"User","id":%s}]}' "$uid")
```

也可以走网页：Settings → Environments → `npm-release` → *Required reviewers*。

注意两点：

- **npm 端的 Environment 必须同名**：OIDC 声明里的 environment 与 npm trusted publisher 配置不一致会 403。
  已经配过 npm trust 但当时没填 environment 的，用 `npm trust github … --env npm-release` 重配一次。
- 审批只看"要不要发布"，不看你发的是哪个版本；版本/分支的合法性仍由 tag、`origin/main` 祖先、
  npm 已存在版本这些自动守卫负责。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/release.yml` | tag 触发的发布工作流（含 bootstrap token 逃生通道与幂等 Release 对账） |
| `.github/workflows/verify.yml` | 验证门，同时被 release 复用（`workflow_call`） |
| `scripts/check-release-version.mjs` | 版本/清单/CHANGELOG/repository 对齐，生成 Release notes 与 step outputs |
| `scripts/pack-release.mjs` | `npm pack` + tarball 内容审计（必含/禁含文件、产物一致性、README） |
| `plugin/package.json` | 实际被发布的清单（`publishConfig.access: public`） |
| `plugin/README.md` | npm 页面正文 |
