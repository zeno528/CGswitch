---
name: release
description: CGswitch 发版流水线（**默认仅本地 commit 为止**）：AI 读 CHANGELOG 历史与 git 三态（最新 tag / HEAD VERSION / working tree VERSION），**单次展示** bump 级别建议（用户确认）→ AI 跑 `node scripts/bump-version.mjs <level>`（**禁止手写**）→ **展示** CHANGELOG 草稿（用户确认）→ 写入 CHANGELOG + 本地 commit。**Step 3 写入本地 commit 即终止**；AI 不主动询问、不主动执行任何 push / 盯构建 / 发布动作。push 到 main 后 Release 工作流自动触发（构建完停在草稿），公开发布仍须用户确认。当用户说"发版"、"发行"、"release"、"发个新版本"、"发布新版本"时使用。
---

# CGswitch 发版

分工：本 skill 做需要判断的部分——bump 级别建议、CHANGELOG 内容草稿（撰写须由 Agent 完成并经用户确认）、本地 commit、跑 bump-version 命令；`.github/workflows/release.yml` 做确定性的部分——回填版本标题（`## [版本] - 发行日`，发行那一刻才确定的事实）、校验、三平台构建、创建 tag 与草稿发行页、上传资产。草稿不会通知关注者；执行发布那一刻 GitHub 才给关注者发通知邮件。

工作流由 push 到 main 自动触发（要求 VERSION 与 CHANGELOG.md 有变更且内容齐备，不满足则绿色跳过），构建完停在**草稿**；也可手动 `workflow_dispatch` 触发并可传 `release_mode` 直接预发行/正式发布。工作流用 `GITHUB_TOKEN` 创建 tag 和草稿，不会递归触发自身。

## 默认流程边界

**Step 0–3 是默认范围**：建议 bump 级别（用户确认） + 跑 bump 命令 + 起草 CHANGELOG 草稿（用户确认） + 写入本地 commit。**Step 3 写入本地 commit 即终止。**

Step 4–6（push / 盯构建 / 发布）属于扩展流程，**必须用户明确启动**才执行，常见触发词如"继续"、"push"、"推上去"、"触发构建"、"发布"、"发版（确认发布）"。**用户不说就停手**——AI 在 Step 3 之后只汇报 commit 结果，**不主动询问也不主动执行**任何扩展动作。

**角色分工硬约束**：

- **AI**：给 bump 级别建议；用户确认后跑 `node scripts/bump-version.mjs <level>`；起草 CHANGELOG 草稿；写入；commit。**不**直接编辑 `VERSION` / `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
- **版本号与日期禁写**：CHANGELOG 段落标题固定写 `## [Unreleased]`，不写版本号也不写日期——两者由 Release 工作流在发行时回填为 `## [<版本>] - <发行日>]` 并同步到发行页与 CHANGELOG.md。
- **用户**：确认 bump 级别（可改 AI 建议）；确认 CHANGELOG 文案（可改）。
- **递增必须跑脚本命令，禁手写**：`bump-version.mjs` 内已串联 `sync-version.mjs` 同步全部元数据文件，手写会漏。
- **版本号基线以 git 三态为准**：最新 tag + HEAD VERSION（`git show HEAD:VERSION`）+ working tree VERSION（读 `VERSION`），取三者中**最大值**作为 bump 基线——用户在测试场景可能预先 bump，working tree 会领先 index / HEAD。

本 skill 不限定分支：在任何分支触发都只执行本地流程（bump + CHANGELOG + commit）。分支切换、push、工作流触发、盯构建、发布由用户自行决定，AI 不主动执行也不主动询问。

## Instructions

### Step 0: 展示 bump 级别建议（**等用户确认**，不修改任何文件）

1. 取最新 tag：`git tag -l 'v*' | sort -V | tail -1`
2. **git 三态确认基线**（取 max）：
   - HEAD VERSION：`git show HEAD:VERSION`
   - working tree VERSION：读 `VERSION`
   - 最新 tag 解析出的版本号
   - 三者取 max 作为 Step 1 bump 命令的输入基线
3. 拉自上一 tag 起的 commit 列表：`git log <上一tag>..HEAD --oneline --no-merges`（首个版本用全部历史）。
4. 拉 `CHANGELOG.md` 最近 5–8 段已发布段落作为"项目自有的 minor / patch / major 量级参照"。
5. AI 综合判断后展示：

   ┌──────────────────────────────────────────────────────────────┐
   │ 当前状态（git 三态）：                                       │
   │   最新 tag：v0.7.1                                           │
   │   HEAD VERSION：0.7.2                                        │
   │   working tree VERSION：0.7.3（领先 HEAD 是测试残留）        │
   │   bump 基线（取 max）：0.7.3                                 │
   │   自上一 tag 的 commit 数：N                                 │
   │                                                              │
   │ 建议 bump 级别：patch / minor / major                        │
   │ 依据：参照 v0.6.0（...）+ 当前 commit 列表的关键特征         │
   └──────────────────────────────────────────────────────────────┘

6. 等用户明确"OK / 确认 / 就这样"或修改建议级别后才能进入 Step 1。
7. **硬约束**：本步骤**禁止**修改任何文件、**禁止**跑 `bump-version.mjs`。

### Step 1: 跑 bump-version 命令（**用户确认级别后 AI 执行**）

**递增必须用脚本命令，禁止 AI 直接编辑版本号文件**——`bump-version.mjs` 内已串联 `sync-version.mjs` 同步全部元数据，手写会漏。

1. AI 按 Step 0 用户确认的级别跑：

   ```bash
   node scripts/bump-version.mjs patch   # 或 minor / major
   ```

2. 检查脚本输出"版本号已从 X.Y.Z 更新为 A.B.C"，记下 A.B.C 作为本版本号（用 git 三态确认输入基线 = max，避免 working tree 残留干扰）。
3. 锁文件未跟上的话 AI 跑：`cargo update -p cgswitch --manifest-path src-tauri/Cargo.toml`（lockfile 已对齐可跳过）。
4. 进入 Step 2 起草 CHANGELOG（标题固定 `## [Unreleased]`，不需要带入版本号——版本号与日期由工作流发行时回填）。

### Step 2: 展示 CHANGELOG 草稿（**等用户确认**，不修改任何文件）

1. AI 展示（段落标题固定 `## [Unreleased]`，版本号与日期由 Release 工作流发行时回填，AI 不写）：

   ┌──────────────────────────────────────────────────────────────┐
   │ CHANGELOG 草稿（用户视角描述，即将写入 CHANGELOG.md 顶部）：│
   │ ```markdown                                                  │
   │ ## [Unreleased]                                              │
   │ ...                                                          │
   │ ```                                                          │
   │                                                              │
   │ 进 / 不进（无用户可见影响的提交不进）：                       │
   │ - <commit hash> <标题> — 进 / 不进（理由）                   │
   └──────────────────────────────────────────────────────────────┘

3. 等用户明确"OK / 确认 / 就这样"或修改文案后才能进入 Step 3。
4. **硬约束**：本步骤**禁止**编辑 `CHANGELOG.md` 或任何文件。

CHANGELOG 写作规则：

- 用用户视角描述变更（"新增 xxx 功能"），不要照抄 commit 标题。
- 空分区整节省略；可用分区：新增 / 修复 / 界面与样式 / 性能优化 / 重构 / 移除 / 安全；都不匹配时可自拟简洁分区名（如 文档 / 依赖升级）。
- **不进入 CHANGELOG 的提交**（无用户可见影响）：
  - 纯版本号 bump（`chore(release): vX.Y.Z`）
  - 纯 CI / 工作流变更
  - 纯文档类提交
  - 纯文案 / 按钮 / 标签 / 提示语等措辞小改（不影响功能）
  - 纯图标 / 品牌资源更新（不影响功能）
- 已有段落风格时（查看 `CHANGELOG.md` 旧版本段落），沿用旧格式。

CHANGELOG 段落模板（分区按实际变更从可用分区里取，有几段写几段，不是固定三段）：

```markdown
## [Unreleased]

### <分区名>
- …
```

> **不要**在 CHANGELOG 里写「如何选择安装包」和「macOS 首次打开」：这两段由 `.github/workflows/release.yml` 的 release job 自动追加到发行页（安装指南兜底，必带），写进 CHANGELOG 会与工作流产出重复。旧版本段落里出现的这两段是历史遗留，新版本不沿用。版本标题行与 Full Changelog 对比链接同样由工作流自动生成（即使没写日志，发行页也有版本号、日期和变更入口），都不用写。

### Step 3: 写入 CHANGELOG 与本地 commit

1. 在 `CHANGELOG.md` 顶部（文件头部介绍之后）插入 Step 2 已确认的版本段落，标题固定 `## [Unreleased]`（版本号与日期由 Release 工作流发行时回填，**AI 禁写**）。
2. 提交所有发版文件：`git add VERSION package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md`
   提交信息：`chore(release): v<版本>`
3. **到此停下**：汇报版本号、commit hash、CHANGELOG 段落摘要，**会话停在此处**。**不询问用户是否继续**（避免被读成对扩展动作的暗示），**不主动执行**任何 push / 触发工作流 / 发布操作。Step 4–6 需用户用明确指令单独启动。

### Step 4: 推送（自动触发构建，停在草稿）— 需用户明确启动才执行

> 默认流程到 Step 3 为止。本节起必须用户明确指示（如"继续"、"push"、"推上去"）才执行，不要自行越界。

1. 推送发版提交：`git push origin main`（工作流从仓库读取 VERSION 与发行日志）。push 会**自动触发** Release 工作流，release_mode 为空 → 构建完停在**草稿**，走 Step 6 人工发布；不手动打 tag（tag 由工作流用 GITHUB_TOKEN 自动创建，避免递归触发）。
2. 仅当用户明确要求**直接预发行 / 正式发布**（不走人工发布）时，先取消 push 触发的 run，再手动 dispatch 对应模式：

   ```bash
   gh run list --workflow=Release --limit 1 --json databaseId,event,status   # 找 event=push 的 run
   gh run cancel <run-id>
   gh workflow run release.yml --ref main -f release_mode=prerelease   # 或 latest
   ```

   不取消也能工作（同一并发组排队，dispatch 那条最终更新草稿并发布），但会白跑一轮三平台构建。

3. 等 10 秒后取 run：`gh run list --workflow=Release --limit 1 --json databaseId,status,headSha`
4. 推送前可选本地预检 `pnpm check`（与工作流 verify job 同一条链），失败就地修复并补充提交；⚠️ 项目 node_modules 是 Windows 平台构建的，必须在 **Windows 侧**执行（WSL 里跑会触发 corepack 重建依赖、破坏 Windows 开发环境）；跳过也可，工作流 verify 会兜底。

### Step 5: 盯 Release 工作流 — 需用户明确启动才执行

1. `gh run watch <run-id> --exit-status --interval 30` 放后台执行（约 30-40 分钟），完成时会收到通知。
2. 构建失败：`gh run view <run-id> --log-failed` 提取报错摘要，报告用户并停止（草稿若已创建则留在草稿态，不影响关注者）。
3. 构建成功后工作流已自动完成：回填 CHANGELOG 版本标题（`## [版本] - 发行日`）、创建 tag、创建发行页（版本标题 + Full Changelog 链接 + 发行日志 + 安装指南）、上传三平台资产。draft 模式停在草稿；prerelease / latest 模式此刻已自动发布，无需 Step 6。

### Step 6: 确认与发布 — 需用户明确启动才执行

> 本步仅适用于 **draft 模式**（默认）。prerelease / latest 模式下工作流构建完成即自动发布，跳过本步。

1. 展示给用户（这一步必须等用户明确确认，不得自动发布）：
   - `gh release view v<版本> --json name,isDraft,assets` 的资产清单（文件名 + 大小）
   - 发行日志全文预览
2. 用户确认后执行：`gh release edit v<版本> --draft=false --latest`
3. 变体处理：
   - 用户说"预发布"：加 `--prerelease`，去掉 `--latest`
   - 用户要改日志：改 `CHANGELOG.md` 对应版本段落，提交推送后工作流自动重跑，用新段落更新既有草稿后再发布
4. 发布后告知用户：关注者通知已发出，附 release 页面链接 `https://github.com/zeno528/CGswitch/releases/tag/v<版本>`

## 示例

**场景 A（默认流程）**：用户说"发版"

1. **Step 0**：AI 看 git 三态（最新 tag `v0.7.1` / HEAD VERSION `0.7.2` / working tree VERSION `0.7.3`，取 max = `0.7.3`） + `git log v0.7.1..HEAD` + `CHANGELOG.md` 最近段落 → 单次展示"建议 patch（依据：参照 v0.7.1 类似量级，单 `fix:` commit）" → 用户回复"OK"
2. **Step 1**：AI 跑 `node scripts/bump-version.mjs patch` → 输出"版本号已从 0.7.3 更新为 0.7.4" → AI 记下 `0.7.4` 带入 Step 2
3. **Step 2**：AI 展示 CHANGELOG 草稿 `## [Unreleased]` + 内容 + 进/不进 → 用户回复"OK"
4. **Step 3**：AI 写入 `CHANGELOG.md` + `git commit -m "chore(release): v0.7.4"`
5. **到此停下**：汇报版本号、commit hash、CHANGELOG 段落摘要，**会话终止**。不询问、不执行 push / 触发工作流 / 发布；这些动作必须等用户在下一轮显式启动（例如"推上去"、"继续"）。

**场景 B（扩展流程，需用户明确指示）**：用户在场景 A 之后说"推上去，发布"

1. **Step 4**：`git push origin main` → Release 工作流自动触发（构建完停在草稿）
2. **Step 5**：后台 `gh run watch` 盯 Release 工作流至全绿（工作流自动建 tag、草稿并上传 4 个资产）
3. **Step 6**：展示 4 个资产（Windows setup/msi、macOS x64/arm64 dmg）+ 日志全文，等确认 → 用户回复"发布" → `gh release edit v0.7.4 --draft=false --latest`，报告链接

## Troubleshooting

**工作流未触发**：push 后 `gh run list --workflow=Release` 查看队列；确认改动包含 VERSION 或 CHANGELOG.md（paths 过滤，普通提交不触发）且推的是 main。手动兜底：`gh workflow run release.yml --ref main`。

**verify 绿色跳过（push 自动触发，`::notice` 提示）**：属正常，两种情况——① VERSION 与 CHANGELOG 顶部段落不一致（如只改其一、提前写未来版本段落）；② 该版本已公开发布（改文案不会重发）。

**verify 第 0 步失败（手动 dispatch 时 VERSION 为空 / 顶部段落与 VERSION 不一致）**：说明版本号与日志没同步提交。补上 `CHANGELOG.md` 顶部的 `## [Unreleased]` 段落并让 VERSION 一致，提交推送后重新触发。

**草稿已存在（重跑场景）**：工作流会检测到草稿并更新（`gh release edit`），不会重复建。

**发行已公开后工作流又跑**：工作流会拒绝修改已发布内容（"发行 vX 已经公开，拒绝修改已发布内容"），属正常保护，不是 bug；需要发新版本时递增 VERSION 重来。
