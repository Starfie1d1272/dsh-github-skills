> Design-time research artifact (2026-08): the ecosystem-boundary analysis that
> motivated this pack's differentiation. It studies the seven DSH GitHub/Git/CI
> projects as of the date above; per-repo raw dumps are not part of this repo.
> The conclusions feed the "Relations to existing projects" section of the README.

# dsh-github-skills 生态边界分析报告

调研方式：`api.github.com/repos/<o>/<r>`（meta）、`raw.githubusercontent.com`（README）、`api.github.com/repos/<o>/<r>/contents/`（顶层结构）、`git/trees/main?recursive=1`（全量文件树，用于 SKILL.md / tests 检索）。**全部 7 个仓库的 meta / README / contents / tree 请求均为 HTTP 200**（main 分支，README 无 404，未触发限流），未编造任何内容。

对比基准：**dsh-github-skills** = 纯 SKILL 编排层（4 个 SKILL.md：github umbrella router / gh-address-comments / gh-fix-ci / gh-publish），不实现任何 GitHub API 工具，只编排宿主已有能力 + gh/git CLI fallback，progressive disclosure。

---

## 1. PerryLink/dsh-github

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 |
| description | GitHub integration for DeepSeek Harness: create PRs, review PRs in background jobs, read issues — every write gated by human approval |
| license | **Apache-2.0** |
| last push | 2026-08-14T11:27Z（创建 08-13） |
| stars | 3（forks 1） |
| 类型 | dsh bundle 插件（TypeScript，npm `@perrylink/dsh-github`，`dsh plugin add` 安装） |

**内容**：
- **8 个工具**（`defineTool`，canonical JSON）：`pr_create` / `gh_review` / `review_post` / `gh_issue` / `issue_open` / `issue_comment` / `issue_close` / `gh_search`
- **3 组命令**：`/pr create`、`/review <pr>`（后台 job：`start/stop/post`）、`/issue open`
- **GitHub auth**：credentials seam → env → `gh` CLI 逐次解析（`tokenSource: auto`），token 绝不入日志/渲染/错误
- **write approval**：`tools/pre-execute` 瀑布监听 → `ctx.approval`（默认 `ask`，fail-closed）+ `allowedActions` 白名单；命令处理器结构上无法直接写
- **local git**：只读 git 检视（分支、变更文件、领先提交数），不 commit/push（`autoCommit: false` 默认，开启后经 bash 工具自身审批）
- **PR review**：`ctx.jobs` 后台 job（静态分析器默认 / `reviewMode:"model"` 委托 one-shot subagent），报告含 CI 状态 + 既有评论
- **review thread**：`review_post` mode `summary`（聚合评论）/ `inline`（按 head commit 行锚定评论）；**无回复/无 resolve 线程工具**
- **CI logs**：`gh_review` 只取 check runs 状态，**不读原始日志**
- **publish**：无发布能力；README 明示"CI / GitHub Action 是规划中的 v2 companion 仓库"
- **tests**：`test/` 14 个 vitest 文件（含 token 不泄漏安全测试、opt-in e2e）
- **SKILL.md**：无（全树 0 个 skill 路径）

**边界结论**：**竞争为主、可互补**。它是 7 个里最完整的"GitHub 操作插件"，与 dsh-github-skills 的能力面大面积重叠：PR 创建（gh-publish 相邻）、PR 审查（gh-address-comments 上游）、issue 评论、审批门控写、gh CLI fallback（恰好是 dsh-github-skills 的 fallback 层）。**差异化空间**：① dsh-github-skills 是纯 skill（零代码、工具无关），PerryLink 是工具实现——理想关系是 skill 作为路由层，检测到 PerryLink 的 `gh_*`/`pr_*`/`issue_*` 工具时优先调用、否则 gh CLI fallback；② PerryLink 缺 publish（gh-publish 空白）、缺原始 CI 日志诊断（gh-fix-ci 前半段空白）、缺线程回复/resolve。注意其 3 个工具名以 `gh_` 开头，与 ZariaEcho 的 `gh_*` 前缀**同名冲突**，umbrella router 必须按工具全名区分。

---

## 2. kaziii/dsh-github-connector

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 |
| description | DSH 的 GitHub 连接器：一键授权，对话内创建/AI 审查/合并 PR |
| license | **MIT** |
| last push | 2026-08-14T15:57Z（创建 08-13） |
| stars | 4（forks 0） |
| 类型 | 5 包 monorepo 插件（`dsh-github` 类型层 / `dsh-github-rest` REST client / `dsh-tool-github` 工具 / `dsh-github-connect` Device Flow / `dsh-ui-github` Web UI） |

**内容**：
- **6 个工具**（`github_*` 前缀，见 tool-catalog.json）：`github_search` / `github_issue_read` / `github_pr_read`（`part=metadata|diff|comments|checks`）/ `github_issue_create` / `github_issue_comment` / `github_pr_create`（幂等）；另附 `read-only` 变体（去掉写工具）
- **GitHub auth**：**Device Flow 一键授权**（设置页按钮，token 只存宿主进程）+ headless 用 `GITHUB_TOKEN` env —— 全生态独一份
- **UI**：输入框上方 PR 状态条（分支领先默认分支时出现，一键创建 PR / AI 审查 / 合并）
- **write approval**：写工具描述即"user asked to approve before…"；有 read-only 变体
- **AI 审查**：无独立 review 工具——由 agent 经 `github_pr_read part=diff` 读 diff → 自己分析 → `github_issue_comment` 回贴（ADR 0011 明文"create-pr-via-agent-prompt"：流程由 agent prompt 驱动）
- **CI logs**：`github_pr_read part=checks`（check runs），无原始日志
- **local git**：仅检测分支领先状态触发 PR bar；无 commit 能力
- **tests**：每包 vitest spec + e2e config；docs/ 含 11 个 ADR 与设计文档（工程文档最完善）
- **SKILL.md**：无

**边界结论**：**高度互补**。它的护城河是**认证 UX（Device Flow）与 Web UI（PR 状态条）**，这正是 dsh-github-skills 完全不做的东西；而它恰恰缺 review/CI 诊断/fix/publish 这类"流程纵深"，正是 4 个 skill 的领地。重叠仅在 PR 创建与 issue 评论的浅层。另注意其 `github_*` 工具名与 PerryLink `gh_*`、ZariaEcho `gh_*` 三套命名并存——router skill 需按前缀/能力归一化。差异化空间：dsh-github-skills 可把 Device Flow 认证作为"宿主已授权"的检测信号，并在缺工具时回退 gh CLI。

---

## 3. ZariaEcho/dsh-github-workflow ★ 重点核查

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 · PROMO.md 200 |
| description | "github-workflow"（README 自称：把 GitHub 从 API 调用升级成懂开发流程的业务工具，闭环 Issue→…→发布） |
| license | **MIT** |
| last push | 2026-08-14T15:37Z（创建 08-14） |
| stars | 1（forks 0） |
| 类型 | 单包 dsh 插件（TypeScript） |

**性质判定：是 "tool provider + system prompt"，不是真正的 SKILL orchestration pack。**
证据（源码级）：`src/index.ts` 中 `inject = ['tools', 'systemPrompt']`；12 个工具经 `registerXxxTool` 注册到 `tools` 服务；一段约 400 字的 `PROMPT_TEXT` 经 `ctx.systemPrompt` 注入模型（`systemPrompt.section`）。**全树无 SKILL.md、无 skills/ 目录、无 `ctx.skills.register`、无 progressive disclosure**——工具全量注册、prompt 一次性注入。PROMO.md 是自媒体推广文案，进一步佐证其定位是"工作流工具集"而非 skill 包。

**12 个工具清单**（README + src/tools/*.ts 逐一对应）：
`gh_get_repo_context`（读，含 CODEOWNERS/分支保护）、`gh_analyze_issue`（读，四维分析+四层上下文）、`gh_search_related`（读，查重）、`gh_create_draft_pr`（写，PR 模板+`Closes #N`+diff 推导描述）、`gh_check_ci_status`（读，combined status+check runs+失败 annotations）、`gh_review_pr`（读/写，阻断/建议/优化三级 Review + GraphQL 线程视图，`post:true` 提交）、`gh_request_reviewers`（写）、`gh_reply_comment`（写，可 resolve 线程）、`gh_generate_release_notes`（读，两 ref 间 changelog 草稿）、`gh_merge_pr`（写，GraphQL 合并，`markReady:true`）、`gh_close_issue`（写）、`gh_delete_branch`（写）

**其余维度**：write approval = 单一权限闸口（`utils/permission.ts`：readOnly → 宿主 approval 服务（`allowed-once` 否则 fail-closed）→ `requiredTokenScopes` 校验），写操作审计事件入 session log；GitHub auth = credentials seam（`apiTokenEnv: GITHUB_TOKEN`）+ `baseUrl` 支持 GHES；review thread = **全生态最全**（读线程 + 回复 + `resolveReviewThread`）；CI = annotations 级（非原始日志）；local git = 无（写码依赖 file/shell 工具）；publish = 仅 changelog 草稿；tests = `smoke.mjs` 离线 stub 冒烟 89 项 + `examples/live-smoke.mjs` + `live-write-smoke.mjs` 真网读写闭环（**无 vitest 单测**）；SKILL.md 无。

**边界结论**：**直接竞争**——它在"工作流编排"这个理念轴上与 dsh-github-skills 正面相撞（README 的"流程知识固化"诉求 = skill 的诉求），但实现路线相反：**代码工具 + 大段常驻 system prompt vs 纯 SKILL.md + progressive disclosure**。能力重叠：`gh_check_ci_status`≈gh-fix-ci 的诊断半段（但无原始日志、无修复）、`gh_reply_comment`/`gh_review_pr` 线程≈gh-address-comments、`gh_generate_release_notes`≈gh-publish 的草稿段。**差异化空间**：① 一次性注入 400 字 prompt 常驻上下文、12 个工具全量可见，无按需披露——skill 的分层披露在长会话中更省上下文；② 它不含 publish 执行与 CI 日志级诊断、无本地 git（dsh-github-skills 的 gh/git fallback 与 gh-publish 仍是空白）；③ 依赖 GitHub 场景专属，而 skill 包可编排其工具（存在即可用）。竞争风险：若用户只装其一，二者在"PR 闭环"诉求上互斥；最佳格局是 skill 路由层把它的 12 个 `gh_*` 工具当能力源（注意与 PerryLink `gh_*` 工具名冲突，需按全名/参数签名区分）。

---

## 4. jkrandom-sudo/dsh-ci-doctor

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 |
| description | CI 失败打开日志前就完成诊断：监视 GitHub Actions 新失败，原始日志转结构化诊断卡，签名账本识别复发 |
| license | **MIT** |
| last push | 2026-08-14T10:16Z（创建 08-14） |
| stars | 3（forks 0） |
| 类型 | 单包 dsh 插件（TypeScript，npm `dsh-ci-doctor`） |

**内容**：
- **2 个工具**：`ci_watch`（后台 job 轮询**新增**失败 run，基线去重，指数退避，到期给出下一步 `ci_diagnose` 调用）、`ci_diagnose`（结构化诊断卡：归一化错误签名、失败分类 test/build/lint/typecheck/dependency/network/permission/timeout/infra、可疑文件、截断日志摘录）
- **GitHub auth**：复用 `gh` CLI 会话（`gh auth login`）——零 token 处理
- **CI logs**：**唯一把原始日志做深度结构化的仓库**（`gh api` 取日志 → 签名归一化 → 签名账本持久化于 `ci_doctor` storage unit，复发失败显示 `seen 3×`）
- **write approval**：无写能力——read-only by contract（`repositoryWrites:false` 标记 + invariant 伴生包）
- **review thread / PR / publish / local git**：全部无
- **tests**：`tests/` 6 个 vitest spec（带 4 份真实日志 fixture）
- **SKILL.md**：无

**边界结论**：**高度互补**。它是 gh-fix-ci 的天然"诊断引擎"：skill 负责判断何时需要诊断/如何修复，ci-doctor 提供日志级诊断纵深（签名、分类、账本）——dsh-github-skills 缺的正是原始日志能力。重叠为零或极浅（仅"读 CI 状态"这一点与 gh_check_ci_status/gh_review 重叠，但深度碾压）。差异化空间：把 `ci_watch`/`ci_diagnose` 编排进 gh-fix-ci 的"诊断→定位→修复→验证"闭环，可填补生态中"日志级诊断"空白。

---

## 5. lonelymoon87/dsh-gitflow

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 |
| description | Git status, diff, commit, pull request, and worktree workflows for DSH（README 澄清：PR 创建/push/worktree **明确不在 MVP**） |
| license | **MIT** |
| last push | 2026-08-14T02:54Z（创建 08-13） |
| stars | 2（forks 0） |
| 类型 | 单包 dsh 插件（GitHub Releases 分发 tarball，未发 npm） |

**内容**：
- **★ 7 个仓库中唯一带 SKILL.md 的**：`skills/gitflow-commit/SKILL.md`，经 `ctx.skills.register({ name:'gitflow-commit', source:'bundled', userInvocable:true, modelInvocable:false })` 注册 —— **验证了"插件内捆绑 SKILL.md"这一模式在 DSH 生态可行**（`inject` 含 `skills` 服务）
- **工具**：`git_status` / `git_diff`（staged|unstaged）/ `git_log` / `git_commit`（仅已暂存，审批门控）/ `git_branch`；`checkpoint_list` / `checkpoint_restore`（委托 dsh-turn-rewind Change Ledger 服务，可选 `autoCheckpoint`）
- **命令**：`/commit`（调度 gitflow-commit skill → 用户可见的暂存审查流程）；另有 `ctx.systemPrompt.section('tool:gitflow')` 常驻约束
- **local git**：**核心能力**——绝不隐式 stage/push/删分支/跳过 hooks，参数 shell-quoted，提交信息走 stdin，全部经宿主 shell 服务
- **GitHub auth / review / CI / publish**：全无（纯本地 git）
- **write approval**：`tools/pre-execute` 门控（git_commit/分支/restore 一律 ask）
- **tests**：`tests/` 2 个文件（manifest、plugin），用真实临时 git 仓库验证
- **SKILL.md**：有（1 个：gitflow-commit）

**边界结论**：**互补 + 模式参照**。它是 dsh-github-skills"git fallback 层"的现成实现（status/diff/commit 正是 skill 缺 gh 工具时的回退路径），且其单一微 skill（"审查暂存变更再提交"）证明了 SKILL.md 打包/用户可调用/模型不可调用的注册方式——dsh-github-skills 可对照其 `skills.register` 用法。重叠：仅"git fallback"这一点，且是补强而非竞争。差异化空间：其 skill 是单点提交流程，dsh-github-skills 的 umbrella 路由 + 4 skill 组合是更大粒度的编排。

---

## 6. BrambleXu/dsh-revdiff

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 |
| description | DSH 原生交互式 Git diff 审查，结构化批注回传当前 Agent 会话 |
| license | **MIT** |
| last push | 2026-08-14T06:57Z（创建 08-14） |
| stars | 2（forks 0） |
| 类型 | 单包 dsh 插件（TypeScript，本地 checkout 安装） |

**内容**：
- **命令**：`/revdiff`（及 `--staged/--unstaged/--base <ref>/-- path`），**交互式终端 TUI** 浏览 files/hunks/lines，`a/e/d/s` 增删改提批注（issue/suggestion/question/praise），提交经 `agent.followup()` 带 provenance 回当前会话
- **local git**：读取 tracked 工作树/暂存/未暂存/base 变更的 unified diff（`git diff`），**无任何 GitHub API**
- **review thread / CI / publish / GitHub auth**：全无（批注模型为本项目自持）
- **write approval**：不直接写 GitHub；批注走 `agent.followup` 进入会话 → 由宿主工具链正常审批
- **tests**：`tests/` 3 个 vitest spec
- **SKILL.md**：无
- 灵感来自 pi-diff-review / umputun/revdiff，但为独立实现

**边界结论**：**基本不重叠、可共存**。它是"人机协同的本地 diff 审阅 TUI"，交互模型（人在终端逐行打标）与 dsh-github-skills 的 agent 驱动 GitHub 评论闭环（gh-address-comments）完全不同面：前者审**未上 PR 的本地改动**，后者处理**PR 上已存在的评论线程**。差异化空间：其批注回传机制（followup + provenance）是 skill 可消费的输入源——若用户先 `/revdiff` 得出批注，再走 skill 落地为 PR 评论，恰成上游。

---

## 7. Lixiaoyiao/deepseek-harness-action

| 项 | 值 |
|---|---|
| HTTP | meta 200 · README(main) 200 · contents 200 · tree 200 · action.yml 200 |
| description | Community GitHub Action for DSH — AI Code Review · CI Diagnosis · Auto Fix · Issue → PR |
| license | **MIT** |
| last push | 2026-08-15T08:20Z（**7 个中最活跃**，创建 08-14） |
| stars | **11（最高）**（forks 1） |
| 类型 | **GitHub Action（node24 + `dist/index.js`），不是 dsh 插件**——在 CI 里跑 DeepSeek Harness |

**内容**：
- **部署形态**：`action.yml` 输入 `deepseek-api-key` / `github-token`（仅 controller 侧）/ `allow-write` / `command`（`auto|review|diagnose|fix|implement`）/ `isolation: docker` / `test-commands` 等；输出 `conclusion/operation/summary/result-json` 等 17 项
- **能力**：PR 自动审查（summary + 行内评论）、CI 失败诊断（读 checks + **原始日志**）、`@dsh fix`（trusted-write 改码并跑验证）、issue `implement` → PR；sticky 进度评论（bot ID 校验防伪造）
- **write approval**：CI 信任模型（`allow-write:"true"` + untrusted/trusted-read/trusted-write 三档 profile + docker 隔离 + 验证命令），**非人工审批缝**（无 `ctx.approval` 语义）
- **review thread**：行内评论可发，无回复/resolve
- **CI logs**：**有**（diagnose 读取失败 checks 与 logs，与 ci-doctor 同级）
- **publish**：无
- **tests**：`test/` 28 个 vitest 文件（**全生态最大测试套件**）+ E2E 发布校验
- **SKILL.md**：无（`assets/dsh/*.patch.yml` 是 DSH 运行时 profile 补丁，非 skill）

**边界结论**：**在 CI 场景直接竞争、在对话场景互补**。它与 claude-code-action/codex-action 同类，把 DSH 塞进 GitHub Actions，覆盖 review/diagnose/fix/implement 全链——与 dsh-github-skills 的"能力面"高度重合，但**触发面完全不同**（GitHub 事件驱动、headless、一次性 vs 对话内、长会话、渐进披露）。PerryLink README 明示规划 v2 companion（`dsh-github-action`），说明该生态位已被盯上。差异化空间：dsh-github-skills 的 4 个 skill 可作为该 action 内部 DSH 运行时的 prompt 资产（skill 目录可随 action 分发），把"对话内编排"下沉为"CI 内编排"；反之，action 的日志级诊断与写修复经验可反哺 skill 的 prompt 设计。

---

## 汇总：7 仓库许可证清单

| 仓库 | License（API `license.spdx_id`） |
|---|---|
| PerryLink/dsh-github | **Apache-2.0** |
| kaziii/dsh-github-connector | MIT |
| ZariaEcho/dsh-github-workflow | MIT |
| jkrandom-sudo/dsh-ci-doctor | MIT |
| lonelymoon87/dsh-gitflow | MIT |
| BrambleXu/dsh-revdiff | MIT |
| Lixiaoyiao/deepseek-harness-action | MIT |

6/7 为 MIT，仅 PerryLink/dsh-github 为 Apache-2.0（注意其源码分发/再许可差异）。dsh-github-skills 若参考/编排这些实现，MIT 侧可直接引用；Apache-2.0 侧需保留 NOTICE 与许可头。

---

## 生态全景一句话

7 个仓库 = **5 个代码型工具插件（PerryLink / kaziii / ZariaEcho / jkrandom / dsh-gitflow）+ 1 个交互式本地 diff 审阅插件（BrambleXu）+ 1 个 CI 端 GitHub Action（Lixiaoyiao）**；其中仅 dsh-gitflow 附带 1 个 SKILL.md，ZariaEcho 明确定性为"工具 + system prompt 注入"。**dsh-github-skills 是生态中唯一纯编排层**：与 PerryLink（完整 GitHub 操作）和 ZariaEcho（工作流工具集）为竞争面，其余为互补能力源；差异化空间集中在 publish 执行（全生态空白）、原始 CI 日志诊断编排（jkrandom/Lixiaoyiao 可当引擎）、以及"能力无关的路由 + progressive disclosure"这一无代码定位。
