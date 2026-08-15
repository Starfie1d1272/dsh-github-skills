# dsh-github-skills

[English](README.md) | 简体中文

> **这不是一个 GitHub API 插件。** 它是一个 Skill Pack，教 DeepSeek Harness 如何"走通"GitHub 工程工作流：PR triage、review 反馈、CI 诊断、安全发布——组合会话中已有的 GitHub/Git 能力，必要时回退到 `gh`/`git`。

*DeepSeek Harness（DSH）的非官方社区插件。与 deepseek-ai、OpenAI、GitHub 无隶属关系，也未获其背书。*

[![npm version](https://img.shields.io/npm/v/dsh-github-skills.svg)](https://www.npmjs.com/package/dsh-github-skills)
[![CI](https://img.shields.io/github/actions/workflow/status/Starfie1d1272/dsh-github-skills/ci.yml?branch=main)](https://github.com/Starfie1d1272/dsh-github-skills/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/Starfie1d1272/dsh-github-skills)](LICENSE)

## 功能

面向 DSH 的 skill-first、connector-agnostic GitHub 工作流层。它提供四个 Skill——仅在调用时加载（progressive disclosure），并自适应会话中已暴露的 GitHub/Git 能力：

| Skill | 功能 |
|---|---|
| `github` | Umbrella 路由器：解析 repo/PR/issue/branch 上下文，分类意图，立即路由到对应专家。 |
| `gh-address-comments` | 处理 PR review 反馈：thread-aware 读取（resolved/outdated/锚点）、分类、本地修复，远程写有严格边界。 |
| `gh-fix-ci` | 基于真实日志证据诊断或修复失败的 GitHub Actions check；外部 CI provider 仅报告。 |
| `gh-publish` | 安全发布本地改动：范围确认、分支、暂存（绝不盲用 `git add -A`）、提交、验证、推送、draft PR。 |

**为什么存在：** DSH 生态已有多个 GitHub/Git 能力提供方——缺的是**工作流层**：路由 / 策略 / 安全边界 / 回退。本包提供这一层，且不重实现任何 GitHub API。

## 安装

需要一个 DSH profile（`web` 是 GUI profile）。任选一种方式：

### 已全局安装 dsh CLI

```sh
dsh plugin --profile web add dsh-github-skills
dsh web
```

### 未全局安装 DSH：npx

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-github-skills
npx @deepseek-ai/dsh web
```

- 使用 `npx` 不需要全局安装 DSH。
- 官方 `dsh plugin` 命令用 `pnpm` 管理 profile 依赖，因此 **`pnpm` 仍需在 `PATH`**。
- Node runtime 需满足包 `engines`（`^22.19.0 || >=24.0.0`）。

### 从 GitHub（开发版 / 精确 commit）

```sh
dsh plugin --profile web add github:Starfie1d1272/dsh-github-skills#<commit>
```

npx 等价形式：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:Starfie1d1272/dsh-github-skills#<commit>
```

- 推荐 pin commit（`#<sha>`），避免后续 push 静默改变运行内容。
- 本包是**纯 JavaScript、无 build/prepare 步骤**，git 安装不存在缺失构建产物问题（无 TypeScript `lib/` 输出、无 `allowBuilds` 提示）。
- 常规安装优先使用上面的 npm 包；GitHub commit-pin 适用于未发布或需要可审计快照的场景。

### 本地 tarball（高级）

```sh
npm pack
dsh plugin --profile web add ./dsh-github-skills-0.1.0.tgz
```

---

**可用性：** npm 安装方式从正式发布的 `v0.1.0` 起可用；对于尚未发布的提交，请使用 GitHub commit pin 或本地 tarball 安装。

## 卸载

```sh
dsh plugin --profile web remove dsh-github-skills
```

或 npx 形式：

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-github-skills
```

profile 的 `dsh.profile.bundles` 列表由官方插件管理器自动 reconcile；`~/.dsh` 不残留文件。

## Requirements

### Runtime / 安装

- Node.js `^22.19.0 || >=24.0.0`（由 `engines` 校验）。
- `PATH` 上的 `pnpm`（官方 `dsh plugin` 命令使用）。
- DeepSeek Harness `dsh`——全局或 npx；reviewed/tested baseline 为 `@deepseek-ai/dsh@0.1.0-rc.6`。

### 工作流 fallback（按功能）

- `git`——本地工作流（preflight、publish）需要。
- `gh` CLI（GitHub CLI）且已认证——`gh-address-comments` 的 review thread 读取、`gh-fix-ci` 的 Actions 日志，以及 CLI fallback 路径需要。

如果当前 DSH 会话已有足够的结构化 GitHub capability，并非每个 workflow 都一定依赖 `gh`；Skill 优先用已有能力，仅在需要时回退 `gh`/`git`。

## Quick start

安装后直接说：

```text
"PR 482 现在什么状态？"               → github（triage）
"处理这个 PR 的 review 意见"          → gh-address-comments
"为什么我这个分支的 CI 挂了？"        → gh-fix-ci
"提交这些改动并开一个 draft PR"       → gh-publish
"Fork awesome-foo，更新 README，然后开 PR" → gh-publish
```

混合请求可能同时加载多个专家——先完成 review 或 CI 域工作，再发布：

```text
"修完 review 意见然后 push"           → gh-address-comments + gh-publish
"修好 CI 再开 PR"                     → gh-fix-ci + gh-publish
```

## 安全

规范性规则见 [references/safety-model.md](references/safety-model.md)。要点：

- Helpers **从不主动提取** raw 凭据（绝不调用 `gh auth token`），也**不存储凭据**；每条输出路径在进入 model-visible 输出前对已知凭据形态（GitHub token 前缀、https remote URL userinfo）做 redaction 并替换为稳定占位符。不可信远端内容——评论、CI 日志、gh/git stderr——按不可信对待，对其中凭据形态做 redaction。
- 分析请求永不自动变成写操作："看看 review"不会 reply/resolve；"为什么 CI 挂了"不会 push 修复。
- "处理 review"只授权**本地**修改；远程写需要显式意图或宿主 approval gate。
- 混合工作树绝不用 `git add -A` 暂存；范围歧义会中止发布流。
- 无 force push、无默认 merge、无分支删除、无 hooks 绕过。
- 回退必须能力等价，绝不偷偷降低安全边界。

## 兼容性

- Reviewed/tested baseline：`@deepseek-ai/dsh@0.1.0-rc.6`。CI 在 Node 22.19 与 Node 24 上运行完整单元/安全测试套件 + 真实 disposable-profile 安装 smoke。
- 后续 DSH 版本可能可用，但**不会自动成为** supported baseline；当前契约审计只说明审计时接口仍兼容，不是对未来版本的承诺。
- Skill 按设计 connector-agnostic：自适应宿主会话暴露的 GitHub/Git 能力。

## 架构

```
lib/index.js            极薄 bundle shim：注册只读 SkillProvider
skills/<name>/SKILL.md  四个 Skill；catalog 仅 name+description，body 按需加载
skills/*/scripts/       零依赖 Node helpers（thread 读取、CI 证据、publish preflight）
references/             能力矩阵、安全模型、上游笔记、conformance 记录、
                        GitHub MCP 参考、routing fixture
```

唯一代码是 shim：把四个 SKILL.md bundle 注册到 `ctx.skills`（bundled rank、惰性重读 body、directory `resourceBase`）。不注册 GitHub API 工具、不管凭据。

**可选 GitHub MCP：** GitHub 官方 MCP server 可接入 DSH 作为额外的结构化能力来源；Skill 会像对待任何可见能力一样按语义选用其工具。DSH profile 配置见 [references/github-mcp.md](references/github-mcp.md)；本包不配置 MCP server，也不管理凭据。

## 与现有项目的关系

| 项目 | 角色 | 关系 |
|---|---|---|
| [kaziii/dsh-github-connector](https://github.com/kaziii/dsh-github-connector) | GitHub provider/auth（Device Flow）/UI | 互补；其认证 UX/UI 正是本包不做的事。 |
| [PerryLink/dsh-github](https://github.com/PerryLink/dsh-github) | 审批门控的 GitHub model tools | 互补/竞争；其工具已安装时 Skill 优先调用，然后回退 `gh`。 |
| [ZariaEcho/dsh-github-workflow](https://github.com/ZariaEcho/dsh-github-workflow) | 高层 GitHub 工具集 | 不是替代品；其工具存在时 Skill 可路由到它们。 |
| [jkrandom-sudo/dsh-ci-doctor](https://github.com/jkrandom-sudo/dsh-ci-doctor) | CI 诊断 primitive | 互补；`gh-fix-ci` 在可见时优先用 `ci_diagnose`。 |
| [lonelymoon87/dsh-gitflow](https://github.com/lonelymoon87/dsh-gitflow) | 本地 git primitive | 互补；其工具是 git 回退层。 |
| [BrambleXu/dsh-revdiff](https://github.com/BrambleXu/dsh-revdiff) | 交互式本地 diff 审阅 | 基本不重叠；可作发布流上游输入。 |
| [Lixiaoyiao/deepseek-harness-action](https://github.com/Lixiaoyiao/deepseek-harness-action) | 在 CI 里跑 DSH 的 GitHub Action | 触发面不同（事件 vs 对话）。 |

本项目是**工作流大脑 / 路由 / 安全组合**层，刻意不与上述任何项目竞争 tool surface。

## 上游归属

工作流结构参考了官方 [OpenAI Codex GitHub plugin](https://github.com/openai/plugins/tree/main/plugins/github)（本机安装版本 `0.1.8-2841cf9749ae`）。改编/重实现内容在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中声明，细节见 [references/upstream-notes.md](references/upstream-notes.md)。Helpers 是独立的 Node 重实现，不是 Python 翻译。本项目与 OpenAI 无隶属关系，也未获其背书。

## 开发

```sh
npm test                 # 单元、安全、结构、redaction、package 测试
npm run pack:check       # npm pack allowlist + 隔离安装 + shim 注册
npm run test:smoke       # 端到端 disposable-profile 安装（真实 dsh + pnpm）
```

## 许可证

Apache-2.0。见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
