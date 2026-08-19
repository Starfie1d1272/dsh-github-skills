# dsh-github-skills 的定位：从 Codex GitHub Skill 到 DSH 工作流层

[English](ecosystem-positioning.en.md) | **简体中文**

> 本文回答一个核心问题：**DSH 已经有不少 GitHub 插件，为什么还需要 `dsh-github-skills`？**
>
> 简短答案是：GitHub provider 和工具插件主要解决“Agent 能调用什么”；`dsh-github-skills` 解决“面对一个真实的软件工程任务，Agent 应该在什么时候使用什么能力、按什么顺序使用、什么时候必须停止，以及能力不足时如何安全回退”。

`dsh-github-skills` 不是从零设计的一套 GitHub 提示词。它以 **OpenAI 官方 Codex GitHub plugin 的工作流语义**为主要上游基线，再针对 DeepSeek Harness（DSH）的多能力提供方、审批机制、Skill 按需加载方式和 CLI 回退环境进行适配、修正与加固。

---

## 1. 为什么需要这一层

DSH 的 GitHub 生态已经出现了不同类型的项目，分别覆盖 GitHub 认证、Issue / PR / Review / CI 结构化能力、本地 Git、GitHub MCP、CI 专项诊断、SCM 界面和更高层 GitHub 工具。

这些项目主要回答：

> **“DSH 现在能做什么？”**

但 Coding Agent 真正执行任务时还需要回答另一组问题：

- 当前请求是在查状态、处理 Review、修 CI，还是准备发布？
- 已有结构化能力是否足够，还是需要回退到 `gh` / `git`？
- 普通评论和带 resolved / outdated 状态的 Review Thread 能不能混为一谈？
- 只有 CI 失败状态、却没有真实日志时，能不能直接推断根因？
- “处理 Review”是否意味着可以直接回复、resolve、push？
- 工作区里混有无关修改时，哪些内容可以暂存和提交？
- 当前分支已经有 PR 时，是否应该再创建一个？
- Fork PR 应该向哪个仓库读取 Review Thread、向哪个远程推送？

这些不是“再增加一个 GitHub API”就能解决的问题，而是**工作流语义、路由、证据要求和安全边界**的问题。

这正是 `dsh-github-skills` 所处的层。

---

## 2. 上游基线：OpenAI 官方 Codex GitHub plugin

本项目最初的工作流结构来自 OpenAI 官方 Codex GitHub plugin，主要对应四条路径：

| Codex GitHub plugin | dsh-github-skills | 作用 |
|---|---|---|
| `github` | `github` | GitHub 总入口、上下文解析与路由 |
| `gh-address-comments` | `gh-address-comments` | 处理 PR Review 反馈 |
| `gh-fix-ci` | `gh-fix-ci` | 基于真实 CI 证据诊断 / 修复 GitHub Actions |
| `yeet` | `gh-publish` | 安全地提交、推送并创建 PR |

这里的目标不是逐字复制，而是保持**工作流语义一致**。

项目维护了一份固定基线的逐项审计记录：[`references/codex-conformance.md`](../references/codex-conformance.md)。其中记录审计时使用的 Codex GitHub plugin 版本与公开 commit、每个工作流行为是否等价、DSH 环境下的有意适配、上游行为的修正与加固，以及发现过的缺口及处理结果。

因此，本项目的设计依据不是“作者觉得这样比较合理”，而是：

> **先以官方 Codex GitHub 工作流作为可追溯的语义基线，再针对 DSH 的运行环境做明确、可审计的适配。**

保持一致的核心原则包括：

1. 先解析仓库 / PR / Issue / 当前分支上下文；
2. 明确区分普通 GitHub 处理、Review 反馈、CI 诊断和发布；
3. 一旦任务属于专家工作流，就尽早路由到对应 Skill；
4. Review 必须区分普通评论、Review 和 Review Thread；
5. CI 根因必须建立在真实 check / log 证据上；
6. “分析”不会自动升级成“修改”；
7. 本地修改与 GitHub 远程写操作分开授权；
8. 发布前先确认真实工作区范围，再暂存、提交和推送；
9. 默认创建 Draft PR，而不是直接进入合并流程；
10. 最终结果必须说明检查了什么、修改了什么、验证了什么以及还剩什么不确定性。

---

## 3. 为什么不能直接照搬 Codex

DSH 和 Codex 的宿主环境不同。

Codex 官方 GitHub plugin 面向相对确定的 GitHub connector / MCP 环境；DSH 社区则可能同时存在多个能力来源，例如：

- `kaziii/dsh-github-connector`；
- `PerryLink/dsh-github`；
- `ZariaEcho/dsh-github-workflow`；
- `jkrandom-sudo/dsh-ci-doctor`；
- `lonelymoon87/dsh-gitflow`；
- GitHub MCP；
- 本机 `gh` / `git`。

因此，DSH 版本需要解决一个更突出的现实问题：

> **同一个工作流语义，可能由完全不同的能力提供方完成。**

`dsh-github-skills` 的原则是：

1. 优先使用当前会话中**实际可见、语义最匹配**的结构化能力；
2. 不因为工具名字像、前缀相同或来自某个已知项目，就假设它具备某种能力；
3. 结构化能力不足时，再逐级回退；
4. 最终才使用 `gh` / `git` / 本包的零依赖辅助脚本；
5. 回退只能降低便利性，不能降低证据要求和安全边界。

换句话说：

> **Codex 是工作流语义基线；DSH 适配不是逐字翻译，而是把这些语义重新落到一个多 provider 的运行环境里。**

---

## 4. 在 DSH GitHub 生态中的位置

![dsh-github-skills 架构与生态定位](assets/dsh-github-skills-architecture.png)

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
       DSH Coding Agent / 用户请求
```

因此它并不试图取代其他 GitHub 插件。恰恰相反：

> **越多高质量 provider 暴露结构化 GitHub 能力，`dsh-github-skills` 越应该少依赖 CLI，并越能把完整工作流建立在结构化能力之上。**

---

## 5. 当前四个 Skill 的职责边界

### `github`

GitHub 总入口：解析 repo / PR / Issue / branch 上下文，判断用户真实意图，处理一般状态查询，并尽早把 Review / CI / 发布任务路由给专家 Skill。它不应该膨胀成“万能 GitHub Skill”。

### `gh-address-comments`

处理 PR Review 反馈。重点是保持 conversation comments、reviews、review threads 的语义差异，保留 resolved / outdated / inline anchor 状态，只处理真正未解决且可执行的反馈，并把本地修改与 reply / resolve / push 等远程写分开授权。

### `gh-fix-ci`

诊断或修复 GitHub Actions。根因必须来自真实 check 和日志证据；没有日志时不能凭空猜测。外部 CI 默认只报告状态和链接。“为什么失败”只分析；“修好 CI”才允许做与根因直接相关的本地修改。

### `gh-publish`

把已经完成的本地工作安全发布到 GitHub。先确认范围，再暂存；混合工作区不盲用 `git add -A`；不假设 `origin`；正确处理 Fork；已有 PR 时不重复创建；Push 不等于自动开 PR；创建 PR 时默认 Draft。

---

## 6. 与其他项目是互补还是竞争

| 项目 | 主要角色 | 与本项目的关系 |
|---|---|---|
| `kaziii/dsh-github-connector` | GitHub provider、认证、UI、结构化 PR / Review / CI 能力 | **强互补**：它提供能力，本项目负责工作流组织 |
| `PerryLink/dsh-github` | GitHub 模型工具、审批门控、Review / CI 能力 | **互补**：可作为优先使用的结构化能力来源 |
| `ZariaEcho/dsh-github-workflow` | 更高层 GitHub 垂直工具 | **部分重叠但仍可组合**：本项目不复制其工具，而按语义使用可见能力 |
| `jkrandom-sudo/dsh-ci-doctor` | CI 专项诊断 | **互补**：适合作为 `gh-fix-ci` 的专项证据来源 |
| `lonelymoon87/dsh-gitflow` | 本地 Git 能力 | **互补**：适合作为本地 Git 能力来源 |
| GitHub MCP | 标准化 GitHub 工具来源 | **互补**：本项目不取代 MCP，只使用其可见能力 |
| `gh` / `git` | CLI 基础设施 | **最终回退层** |

项目不以“拥有最多 GitHub tools”为目标，也不把 API 数量作为功能完整度指标。

---

## 7. 质量如何维护：尽量不依赖昂贵的真实模型测试

模型路由本身具有非确定性。持续运行大量真实 Coding Agent 任务既昂贵，也不能变成严格的确定性单元测试。

因此，项目优先采用**低成本、可重复、可审计**的质量策略：

### 7.1 固定上游基线

对 OpenAI 官方 Codex GitHub plugin 固定版本 / commit，记录审计身份，不用模糊的 `main` 代表上游。

### 7.2 工作流语义一致性审计

逐项比较 Codex 与 DSH 版本：哪些行为等价、哪些通过 DSH 的不同能力实现等价、哪些是 DSH 特有增强、哪些差异是有意保留、哪些才是真正需要修复的 gap。

### 7.3 确定性辅助脚本测试

对 Review Thread 分页与截断、CI 日志识别、Actions / 外部 CI 区分、credential redaction、mixed worktree、partially staged 文件、Fork / target repo 解析、包内容与安装结构等可确定性部分使用普通测试。

### 7.4 合成场景和静态行为约束

使用 synthetic fixtures 表达预期工作流，例如：

- “看看 Review”不能自动修改代码；
- “处理 Review”可以本地修改，但不能自动 push；
- 没有日志时不能声称找到 CI 根因；
- push-only 请求不能自动创建 PR；
- 有足够结构化 provider 能力时，不应该无必要回退到 `gh`。

这些 fixture 是**行为规格**，不是伪装成确定性模型 benchmark 的测试。

### 7.5 真实模型任务只作为可选人工抽查

真实任务可以用于问题复现或必要的发布前抽查，但不作为每次维护都必须支付的持续成本。

---

## 8. 项目刻意不做什么

为了保持这一层足够小、足够稳定，本项目不是：

- 另一个 GitHub REST / GraphQL 客户端；
- 另一个 OAuth / Device Flow 插件；
- 另一个 SCM 侧边栏；
- GitHub MCP 的替代品；
- 一个内置 GitHub token 管理器；
- 一个什么都包进去的通用 Coding Agent；
- 以工具数量或 API 覆盖率为目标的 GitHub 工具箱。

一句话概括：

> **Provider 负责让 DSH“有能力”；`dsh-github-skills` 负责让 Agent“正确、安全地组织这些能力”。**

---

## 9. 下一阶段

近期优先级不是快速增加 Skill 数量，而是强化这一定位本身：

1. 把 capability matrix 从“已知插件 / 工具名列表”逐步升级为更稳定的**语义能力矩阵**；
2. 随 DSH GitHub provider 演进，更新兼容性与生态定位；
3. 保持四个现有 Skill 的行为边界和安全要求；
4. 新 Skill 只有在形成清晰、独立、可审计的工作流语义后才加入；
5. 候选方向优先考虑 PR readiness / merge readiness，而不是复制更多 GitHub API。

---

## 10. 进一步阅读

- [`references/codex-conformance.md`](../references/codex-conformance.md)：与 Codex 官方 GitHub plugin 的逐项一致性记录
- [`references/capability-matrix.md`](../references/capability-matrix.md)：DSH 能力选择与回退矩阵
- [`references/safety-model.md`](../references/safety-model.md)：安全边界
- [`references/ecosystem-analysis.md`](../references/ecosystem-analysis.md)：DSH GitHub 生态调研记录
- [`references/upstream-notes.md`](../references/upstream-notes.md)：上游来源与适配说明
- [`references/routing-fixture.md`](../references/routing-fixture.md)：路由行为规格

`dsh-github-skills` 是 DeepSeek Harness 的非官方社区项目，与 deepseek-ai、OpenAI、GitHub 无隶属关系，也未获其背书。对 Codex GitHub plugin 的参考、改编与重实现说明见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。