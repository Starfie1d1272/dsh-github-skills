# dsh-github-skills

**简体中文** | [English](README.en.md)

> **把 OpenAI Codex 官方 GitHub 工作流带到 DeepSeek Harness。**
>
> `dsh-github-skills` 以 OpenAI 官方 Codex GitHub plugin 的工作流语义为上游基线，针对 DSH 的多 provider、审批机制、Skill 按需加载和 `gh` / `git` 回退环境进行适配与加固。
>
> 它不是另一个 GitHub API 插件。**GitHub provider 负责让 DSH“有能力”，本项目负责让 Agent“正确、安全地组织这些能力”。**

*DeepSeek Harness（DSH）的非官方社区项目。与 deepseek-ai、OpenAI、GitHub 无隶属关系，也未获其背书。*

[![npm version](https://img.shields.io/npm/v/dsh-github-skills.svg)](https://www.npmjs.com/package/dsh-github-skills)
[![CI](https://img.shields.io/github/actions/workflow/status/Starfie1d1272/dsh-github-skills/ci.yml?branch=main)](https://github.com/Starfie1d1272/dsh-github-skills/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/Starfie1d1272/dsh-github-skills)](LICENSE)

<p align="center">
  <img src="docs/assets/dsh-github-skills-architecture.png" alt="dsh-github-skills 架构概览：从 Codex 工作流语义基线到 DSH 多 provider 生态" width="100%">
</p>

## 为什么做这个

DSH 已经出现了不少 GitHub / Git 能力插件：有人负责认证，有人提供 PR / Issue / Review / CI 工具，有人负责本地 Git，有人提供 GitHub MCP 或专项 CI 诊断。

这些项目解决的是：

> **Agent 能调用什么？**

`dsh-github-skills` 解决的是另一层问题：

> **面对一个真实的软件工程任务，Agent 应该在什么时候使用什么能力、按什么顺序使用、需要什么证据、什么时候不能继续，以及能力不足时如何安全回退？**

因此，本项目刻意不重新实现 GitHub API，而是作为 DSH GitHub 生态之上的**工作流语义 / 路由 / 证据要求 / 安全组合层**。

完整设计与生态定位见：**[《dsh-github-skills 的定位：从 Codex GitHub Skill 到 DSH 工作流层》](docs/ecosystem-positioning.md)**。

## 从 Codex 到 DSH

本项目不是从零发明四套 GitHub 工作流。核心结构来自 OpenAI 官方 Codex GitHub plugin：

| Codex GitHub plugin | dsh-github-skills | 作用 |
|---|---|---|
| `github` | `github` | GitHub 总入口、上下文解析与路由 |
| `gh-address-comments` | `gh-address-comments` | 处理 PR Review 反馈 |
| `gh-fix-ci` | `gh-fix-ci` | 基于真实 CI 证据诊断 / 修复 GitHub Actions |
| `yeet` | `gh-publish` | 安全提交、推送并创建 PR |

目标不是逐字复制，而是保持**工作流语义一致**，并针对 DSH 做必要适配。

项目维护了一份固定上游版本的逐项一致性记录：[`references/codex-conformance.md`](references/codex-conformance.md)。其中明确区分：

- 与 Codex 等价的行为；
- 通过 DSH 不同能力实现的等价行为；
- DSH 特有增强；
- 有意保留的差异；
- 审计中发现并修复的 gap。

目前已有的 DSH 适配包括多 provider 能力选择、DSH approval、按需加载、Fork PR 目标仓库修正、mixed worktree 防护、partially staged 处理、已有 PR 检测、非 `origin` 远程处理和凭据脱敏等。

## 四个 Skill

| Skill | 负责什么 |
|---|---|
| `github` | GitHub 总入口：解析 repo / PR / Issue / branch 上下文，判断意图，并尽早路由到对应专家 Skill。 |
| `gh-address-comments` | 处理 PR Review 反馈：保留 Review Thread 的 resolved / outdated / 锚点语义，分类反馈并进行可追溯的本地修复。 |
| `gh-fix-ci` | 基于真实 check / log 证据诊断或修复 GitHub Actions；没有日志就不猜根因，外部 CI 默认只报告。 |
| `gh-publish` | 安全发布本地改动：确认范围、分支、选择性暂存、提交、验证、推送，并在需要时创建 Draft PR。 |

这四个 Skill 只在需要时加载，避免把整套 GitHub 工作流长期塞进上下文。

## 它如何与其他 GitHub 插件配合

```text
GitHub / GitHub Actions / 本地 Git
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ 能力提供层                                   │
│ kaziii · PerryLink · ZariaEcho · GitHub MCP │
│ dsh-ci-doctor · dsh-gitflow · gh / git      │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ dsh-github-skills                            │
│ 工作流语义 · 路由 · 证据要求 · 安全组合 · 回退 │
└──────────────────────────────────────────────┘
                 │
                 ▼
           DSH Coding Agent
```

典型关系：

- `kaziii/dsh-github-connector`：提供 GitHub 认证、UI 和结构化能力；本项目负责工作流组织；
- `PerryLink/dsh-github`：提供丰富的 GitHub 模型工具和审批门控；本项目可优先使用其可见能力；
- `ZariaEcho/dsh-github-workflow`：提供更高层 GitHub 工具；本项目不复制它们，而按语义组合；
- `jkrandom-sudo/dsh-ci-doctor`：可作为 `gh-fix-ci` 的专项 CI 证据来源；
- `lonelymoon87/dsh-gitflow`：可作为本地 Git 能力来源；
- GitHub MCP：可作为额外结构化能力来源；
- `gh` / `git`：当结构化能力不足时的最终回退层。

**高质量 provider 越多，本项目越应该少依赖 CLI，而不是变得越没有价值。**

## 安装

### 已全局安装 `dsh`

```sh
dsh plugin --profile web add dsh-github-skills
dsh web
```

### 未全局安装 DSH

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-github-skills
npx @deepseek-ai/dsh web
```

要求：

- Node.js `^22.19.0 || >=24.0.0`；
- `pnpm` 在 `PATH` 中；
- DeepSeek Harness `dsh`；
- 本地发布流程需要 `git`；
- 当当前 DSH 会话缺少足够的结构化 GitHub 能力时，部分 Review / CI / PR 流程会回退到已认证的 `gh` CLI。

### 从 GitHub 安装指定提交

```sh
dsh plugin --profile web add github:Starfie1d1272/dsh-github-skills#<commit>
```

适合未发布版本或需要固定可审计快照的场景。常规使用优先 npm 包。

### 本地 tarball

```sh
npm pack
dsh plugin --profile web add ./dsh-github-skills-<version>.tgz
```

### 卸载

```sh
dsh plugin --profile web remove dsh-github-skills
```

## 怎么用

安装后直接用自然语言描述任务：

```text
“这个 PR 现在什么状态？”
→ github

“处理这个 PR 的 Review 意见”
→ gh-address-comments

“为什么这个 PR 的 GitHub Actions 挂了？”
→ gh-fix-ci

“提交这些改动并开一个 Draft PR”
→ gh-publish
```

混合任务会按顺序组合多个 Skill：

```text
“修完 Review 意见然后 push”
→ gh-address-comments → gh-publish

“修好 CI 再开 PR”
→ gh-fix-ci → gh-publish
```

以上是**工作流示意**，用于解释路由与职责边界，不代表一次真实模型 benchmark。

## 安全边界

本项目把“本地修改”和“GitHub 远程写”分开处理：

- “看看 Review”不会自动改代码；
- “处理 Review”可以做必要的本地修改，但不会自动 reply / resolve / push；
- “为什么 CI 挂了”只分析；“修好 CI”才允许做与真实根因直接相关的本地修改；
- push、rerun、评论、resolve 等远程动作需要明确意图或宿主 approval；
- 混合工作区不盲用 `git add -A`；
- 不默认 force push、merge、删分支或绕过 hooks；
- 辅助脚本不会主动执行 `gh auth token`，也不会存储 GitHub 凭据；
- 评论、CI 日志和 CLI stderr 等不可信远端内容在进入模型可见输出前进行凭据形态脱敏。

完整规范见 [`references/safety-model.md`](references/safety-model.md)。

## 质量策略：尽量不烧真实模型 Token

本项目不把持续运行昂贵的真实 Coding Agent 任务当成日常测试前提。

优先采用：

1. **固定 Codex 上游基线**：记录官方 GitHub plugin 的版本 / commit；
2. **工作流语义一致性审计**：逐项记录等价、适配、增强和有意差异；
3. **确定性辅助脚本测试**：分页、CI 日志识别、Fork、mixed worktree、凭据脱敏等；
4. **合成场景 / 静态行为规格**：描述预期路由、权限和回退行为；
5. **真实模型任务仅作可选人工抽查**：用于必要的问题复现或发布前抽样，而不是持续成本。

路由规格见 [`references/routing-fixture.md`](references/routing-fixture.md)。

## 兼容性

- 当前审阅 / 测试基线：`@deepseek-ai/dsh@0.1.0-rc.6`；
- CI 在 Node 22.19 与 Node 24 上运行单元、安全和打包测试；
- 另有 disposable-profile 安装 smoke，用于验证安装结构；
- 后续 DSH 版本不会因为“看起来能跑”就自动成为正式支持基线。

## 项目结构

```text
lib/index.js            极薄的 bundle shim，只负责注册 SkillProvider
skills/<name>/SKILL.md  四个 Skill，正文按需加载
skills/*/scripts/       零依赖 Node 辅助脚本
references/             一致性、安全、能力矩阵、生态调研、路由规格
docs/                   面向用户和维护者的定位与说明文档
```

本包不注册自己的 GitHub API 工具，也不管理 OAuth / token。

## 文档

- [生态定位：从 Codex GitHub Skill 到 DSH 工作流层](docs/ecosystem-positioning.md)
- [Codex 上游一致性记录](references/codex-conformance.md)
- [能力选择与回退矩阵](references/capability-matrix.md)
- [安全模型](references/safety-model.md)
- [DSH GitHub 生态调研](references/ecosystem-analysis.md)
- [上游来源与适配说明](references/upstream-notes.md)
- [GitHub MCP 参考](references/github-mcp.md)
- [路由行为规格](references/routing-fixture.md)

## 这个项目刻意不做什么

它不是：

- 另一个 GitHub REST / GraphQL 客户端；
- 另一个 OAuth / Device Flow 插件；
- 另一个 SCM 侧边栏；
- GitHub MCP 的替代品；
- 一个通用 Coding Agent；
- 以工具数量或 API 覆盖率为目标的 GitHub 工具箱。

> **Provider 负责能力，`dsh-github-skills` 负责工作流。**

## 上游与许可

工作流语义参考 OpenAI 官方 [Codex GitHub plugin](https://github.com/openai/plugins/tree/main/plugins/github)。固定审计基线、行为差异和 DSH 适配见 [`references/codex-conformance.md`](references/codex-conformance.md)；改编 / 重实现声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。辅助脚本是独立 Node 重实现，不是 Python 逐行翻译。

本项目采用 Apache-2.0 License。见 [LICENSE](LICENSE)。