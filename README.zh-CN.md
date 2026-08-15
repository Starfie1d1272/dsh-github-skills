# dsh-github-skills

> **这不是一个 GitHub API 插件。** 它是一个 Skill Pack，教 DeepSeek Harness 如何"走通"GitHub 工程工作流：组合会话中已有的 GitHub/Git 能力，必要时回退到 `gh`/`git`。

dsh-github-skills 是 DeepSeek Harness（DSH）的 **skill-first、connector-agnostic 工作流编排层**。它提供四个 Skill：一个 umbrella 路由器加三个专家工作流（review 反馈、CI 诊断、安全发布），结构借鉴了官方 OpenAI Codex GitHub 插件经过验证的 progressive-disclosure 分层，并适配到 DSH 的能力模型。

## 为什么存在

DSH 生态已有多个 GitHub/Git 能力提供方（见[与现有项目的关系](#与现有项目的关系)）。生态缺的是**工作流层**：把原始能力组织成可靠工程工作流的 路由 / 策略 / 安全边界 / 回退。能力很多，工作流很少。

本包用以下方式补齐这个缺口：

- **skill-first** —— 四个 `SKILL.md` bundle；catalog 只有 name + description，完整工作流在调用时才加载（progressive disclosure）。无常驻 system prompt、无大段 prompt 膨胀。
- **connector-agnostic** —— 不依赖任何单一 DSH GitHub 提供方；Skill 检测当前 tool catalog 里真实可见的能力，优先用最专门的能力，逐级下探到 `gh`/`git`。
- **remote write fail-closed** —— 分析永不自动变成写操作；任何远程变更都需要明确的用户意图或 DSH approval gate。
- **local-first（涉及本地 checkout 时）** —— 发布范围确认是确定性的（`publish-preflight.mjs`），混合工作树绝不用 `git add -A` 盲选。

## 是什么 / 不是什么

| 是 | 不是 |
|---|---|
| GitHub 的 workflow/skill 编排层 | 新的 GitHub REST/GraphQL client |
| 已有 DSH GitHub/Git/CI 能力之上的路由器 | 新的 OAuth / PAT / Device Flow 实现 |
| 带确定性 preflight 的安全发布流 | 新的通用 issue/PR/search 工具集 |
| thread-aware 读取、CI 证据、发布范围的 Node helpers | 新的 GitHub Action |
| Apache-2.0，零运行时依赖 | 对 DeepSeek Harness core 的修改 |

## 四个 Skill

| Skill | 用途 | 路由到 / 使用 |
|---|---|---|
| [`github`](skills/github/SKILL.md) | Umbrella 路由器：解析上下文、分类意图、立即路由 | `gh-address-comments`、`gh-fix-ci`、`gh-publish` |
| [`gh-address-comments`](skills/gh-address-comments/SKILL.md) | 处理 PR review 反馈：thread-aware 读取、分类、本地修复 | `scripts/fetch-review-threads.mjs`（经 `gh` 的 GraphQL） |
| [`gh-fix-ci`](skills/gh-fix-ci/SKILL.md) | 基于真实日志证据诊断或修复 GitHub Actions 失败 | `scripts/inspect-pr-checks.mjs` |
| [`gh-publish`](skills/gh-publish/SKILL.md) | 安全地本地 → GitHub 发布：范围、分支、暂存、提交、验证、推送、draft PR | `scripts/publish-preflight.mjs`（只读） |

### `github` —— umbrella 路由器

触发词："看看这个 PR"、"GitHub 上现在什么情况"、"看下这个 issue"、"当前 PR 有什么要处理"、"CI 怎么了"、"帮我把这些改动发成 PR"。

它解析操作上下文（repo / PR / issue / branch），把意图分为 *general triage*、*review feedback*、*CI debugging*、*publish changes* 四类，并**立即路由**到对应专家 Skill，而不是重复专家的流程。

### `gh-address-comments` —— review 反馈

获取完整 review 上下文并保持三层区分：顶层 **conversation comments**、**review submissions**、**inline review threads**（含 `isResolved`、`isOutdated`、`path`、`line`、`diffSide`、`startLine`）。flat comments 绝不当作完整 review-thread 状态。

thread 分类为 actionable / informational / approval / resolved / outdated / duplicate / ambiguous，按文件或行为域聚类，并在本地可追溯地实施。"处理所有 review"授权对未解决 actionable thread 的**本地**修改；它本身绝不授权回复、resolve、push 等远程写操作。

### `gh-fix-ci` —— CI 诊断

只有 GitHub Actions check 进入自动日志诊断；外部 CI provider（Buildkite、CircleCI 等）默认 **report-only**（仅 check 名 + URL + 状态）。`inspect-pr-checks.mjs` 提取有界的失败证据（run/job id、run 元数据、snippet/tail），带 gh field-drift 与 job-log fallback——pending 或不可用的日志如实报告。根因由 Agent 基于证据判断，脚本绝不伪造根因。

### `gh-publish` —— 安全发布

唯一按设计执行远程写的 Skill（发布请求本身就是显式意图）。严格顺序：解析 git root → 检查 status/diff → 识别范围 → 分支策略 → 只暂存**本任务文件**（混合工作树绝不默认 `git add -A`）→ 提交（尊重 hooks、不 force）→ 相关验证 → 带 upstream 推送 → **draft PR**（优先已有 DSH PR 能力，回退 `gh pr create`）。fork/cross-repo head 用 `gh pr create`。分支/提交/PR 命名遵循目标仓库惯例——不强制前缀、不强制语言。

## 架构

```
dsh-github-skills/
  package.json            # DSH bundle 契约：dsh.bundle.patch
  cordis.patch.yml        # 挂载唯一的 shim 行
  lib/index.js            # 极薄 shim：注册一个只读 skill provider
  skills/
    github/SKILL.md                     # umbrella 路由器
    gh-address-comments/SKILL.md
    gh-address-comments/scripts/fetch-review-threads.mjs
    gh-fix-ci/SKILL.md
    gh-fix-ci/scripts/inspect-pr-checks.mjs
    gh-publish/SKILL.md
    gh-publish/scripts/publish-preflight.mjs
  references/
    capability-matrix.md   # 什么能力干什么活、回退顺序
    safety-model.md        # 规范性硬规则
    upstream-notes.md      # Codex GitHub 插件来源与刻意变更
  tests/                   # structure/unit/safety/package 测试 + install smoke
```

唯一代码是 `lib/index.js`：一个刻意做薄的 bundle shim，把四个 SKILL.md bundle 注册到 `ctx.skills`（只读、惰性加载 body、directory `resourceBase`）。它**不**注册任何 GitHub API 工具，也**不**管理任何凭据。

## 能力解析

完整矩阵见 [references/capability-matrix.md](references/capability-matrix.md)。规则按顺序：

1. 使用当前 catalog 中**最专门的已有 DSH 能力**（如 `gh_get_repo_context`、`gh_analyze_issue`、`github_pr_read`、`pr_create`、`ci_diagnose`、`git_status` …）。
2. 否则下探到更通用的已有能力。
3. 最后回退到 `gh`/`git` 与本包 Node helpers。
4. 绝不假装能力存在；绝不发明工具名。

## 与现有项目的关系

| 项目 | 生态角色 | 与本包的关系 |
|---|---|---|
| [kaziii/dsh-github-connector](https://github.com/kaziii/dsh-github-connector) | GitHub service/provider/auth（Device Flow）/Web UI 层 | 互补。它的认证 UX 与 UI 正是本包完全不做的事。 |
| [PerryLink/dsh-github](https://github.com/PerryLink/dsh-github) | 审批门控的 GitHub model tools | 互补/竞争。其 `gh_*`/`pr_*`/`issue_*` 工具已安装时，Skill 优先调用，然后回退 `gh`。 |
| [ZariaEcho/dsh-github-workflow](https://github.com/ZariaEcho/dsh-github-workflow) | 高层 GitHub 工具集（12 工具 + 常驻 system prompt） | **不是它的替代品**。本包提供 skill 编排 / progressive disclosure；若其工具已安装，Skill 可以路由到它们。 |
| [jkrandom-sudo/dsh-ci-doctor](https://github.com/jkrandom-sudo/dsh-ci-doctor) | CI 诊断 primitive（`ci_diagnose`、日志签名） | 互补。`gh-fix-ci` 在可见时优先用 `ci_diagnose` 做深度结构化诊断。 |
| [lonelymoon87/dsh-gitflow](https://github.com/lonelymoon87/dsh-gitflow) | 本地 git primitive（status/diff/commit/branch；不含 stage/push/PR） | 互补。其工具是 git 回退层；publish 的 stage/push 仍用受控 `git`。 |
| [BrambleXu/dsh-revdiff](https://github.com/BrambleXu/dsh-revdiff) | 交互式本地 diff 审阅 TUI | 基本不重叠；其批注可作为发布流的上游输入。 |
| [Lixiaoyiao/deepseek-harness-action](https://github.com/Lixiaoyiao/deepseek-harness-action) | 在 CI 里跑 DSH 的 GitHub Action | 触发面不同（事件驱动 vs 对话）。Skill 可同时作为 CI 运行时内的 prompt 资产。 |

本项目是**工作流大脑 / 路由 / 安全组合**层，刻意不与上述任何项目竞争 tool surface。

## 安装

要求：

- DeepSeek Harness `dsh` 0.1.0-rc.6 或兼容版本（带 `ctx.skills` 的 skill registry）
- Node.js `^22.19.0 || >=24.0.0`
- `pnpm`（profile 插件管理器）
- `gh` CLI（GitHub CLI），已认证（`gh auth status`）用于 GitHub 侧工作
- `git` 用于本地工作流

### 从 npm（npm release 后可用）

```sh
dsh plugin --profile web add dsh-github-skills
```

包发布到 npm registry 后，这条命令成为主安装方式。

### 从 GitHub / 本地 tarball（当前真实可用）

包尚未发布到 npm，以下是当前安装路径。从本地 checkout：

```sh
npm pack
dsh plugin --profile web add ./dsh-github-skills-0.1.0.tgz
```

或直接安装 release 产物中的 tarball。

重启 profile 后，四个 Skill（`github`、`gh-address-comments`、`gh-fix-ci`、`gh-publish`）会出现在模型的 skill catalog 中，并在调用时加载。

### 卸载

```sh
dsh plugin --profile web remove dsh-github-skills
```

`dsh.profile.bundles` 列表会自动 reconcile；`~/.dsh` 不会留下残留文件。

## 安全

规范性规则见 [references/safety-model.md](references/safety-model.md)。要点：

- Helpers **从不主动提取** raw 凭据（绝不调用 `gh auth token`），也**不存储凭据**；每条输出路径在进入 model-visible 输出前对已知凭据形态（GitHub token 前缀、https remote URL userinfo）做 redaction 并替换为稳定占位符。不可信的远端内容——评论、CI 日志、gh/git stderr——按不可信对待，对其中凭据形态做 redaction。
- 分析请求永不自动变成写操作："看看 review"不会 reply/resolve；"为什么 CI 挂了"不会 push 修复。
- "处理 review"只授权**本地**修改；远程写需要显式意图或宿主 approval gate。
- 混合工作树绝不用 `git add -A` 暂存；范围歧义会中止发布流。
- 无 force push、无默认 merge、无分支删除、无 hooks 绕过。
- 回退必须能力等价，绝不偷偷降低安全边界。

## 示例

```text
"PR 482 现在什么状态？"               → github（triage）
"处理一下这个 PR 的 review 意见"      → gh-address-comments
"为什么我这个分支的 CI 挂了？"        → gh-fix-ci
"提交这些改动并开一个 draft PR"       → gh-publish
```

## 兼容性

- 已验证：`@deepseek-ai/dsh` 0.1.0-rc.6（本仓库 CI 在 Node 22.19 与 Node 24 上运行完整单元/安全测试套件 + 真实 disposable-profile 安装 smoke）。
- 支持 Node 22.19+ 与 Node 24。
- 本包**不**声称兼容所有 DSH 版本；install smoke 把契约钉在它所验证的版本上。
- Skill 按设计 connector-agnostic：随宿主会话暴露的 GitHub/Git 能力自适应，在 DSH provider 生态演进时继续可用。

## 上游归属

工作流结构参考了官方 [OpenAI Codex GitHub plugin](https://github.com/openai/plugins/tree/main/plugins/github)（本机安装版本 `0.1.8-2841cf9749ae`）。该插件专家 Skill 目录带 Apache-2.0 许可证；改编/重实现内容在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中声明，细节见 [references/upstream-notes.md](references/upstream-notes.md)。本项目与 OpenAI 无隶属关系，也未获其背书。Helpers 是独立的 Node 重实现，不是 Python 翻译。

## 开发 / 测试

```sh
npm test                # structure、unit、safety、package 测试（node:test，零依赖）
node tests/install-smoke.mjs   # 端到端 disposable-profile 安装验证
```

覆盖：

- **Skill structure** —— frontmatter、name、description、断链、umbrella 路由目标。
- **Helper 单元测试** —— thread 分页/状态/错误/auth、check field-drift/日志回退/外部 CI、针对真实一次性 git 仓库的 preflight（clean/dirty/staged/mixed/detached/ahead-behind/no-origin）。
- **安全回归** —— 读工作流与 preflight 的零写审计、fake token 不外泄、无 shell 插值、混合工作树处理、外部 CI 绝不进入日志诊断。
- **Package 验证** —— `npm pack` 内容、bundle 契约、安装后 shim 注册全部四个 Skill。
- **Install smoke** —— 真实 `dsh plugin add` 到 disposable profile，然后经真实 `ctx.skills` registry 验证发现与 body 加载。

## 许可证

Apache-2.0。见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
