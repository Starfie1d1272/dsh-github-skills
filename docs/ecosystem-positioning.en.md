# Positioning dsh-github-skills: from Codex GitHub Skills to the DSH workflow layer

[简体中文](ecosystem-positioning.md) | **English**

> This document answers one question: **DSH already has several GitHub plugins, so why does `dsh-github-skills` exist?**
>
> Short answer: providers and tool plugins mainly answer “what can the agent call?” `dsh-github-skills` answers “which capability should be used for a real engineering task, in what order, under what evidence requirements, when must the workflow stop, and how should it fall back safely when a capability is missing?”

`dsh-github-skills` was not designed from scratch as another set of GitHub prompts. Its main semantic baseline is the **official OpenAI Codex GitHub plugin**, adapted for DeepSeek Harness (DSH): multiple capability providers, host approval, progressive-disclosure Skills, and CLI fallbacks.

## 1. Why this layer exists

The DSH ecosystem already contains projects for GitHub authentication, Issue / PR / Review / CI tools, local Git operations, GitHub MCP, CI diagnosis, SCM UI, and higher-level workflow tools.

Those projects mainly answer:

> **What can DSH do?**

A coding agent still needs workflow decisions: distinguish triage from Review, CI and publish work; preserve Review Thread semantics; refuse to infer a CI root cause without real evidence; keep local edits separate from remote GitHub writes; stage only task-owned changes; avoid duplicate PRs; and handle fork targets and remotes correctly.

Those are workflow-semantics, routing, evidence and safety problems rather than missing API endpoints.

## 2. Upstream baseline: the official Codex GitHub plugin

The original workflow structure maps closely to four Codex paths:

| Codex GitHub plugin | dsh-github-skills | Purpose |
|---|---|---|
| `github` | `github` | umbrella routing and context resolution |
| `gh-address-comments` | `gh-address-comments` | address PR Review feedback |
| `gh-fix-ci` | `gh-fix-ci` | diagnose or fix GitHub Actions from real evidence |
| `yeet` | `gh-publish` | safely commit, push and open a PR |

The goal is workflow-semantic conformance, not copy-identical text. A pinned audit is maintained in [`references/codex-conformance.md`](../references/codex-conformance.md), including the reviewed upstream version / commit, equivalent behavior, intentional DSH adaptations, hardening, and the gap ledger.

> **The project starts from a traceable official Codex workflow baseline, then adapts it explicitly for DSH instead of inventing a new GitHub workflow model from scratch.**

## 3. Why Codex cannot simply be copied

DSH may expose the same semantic capability through different sources, including `kaziii/dsh-github-connector`, `PerryLink/dsh-github`, `ZariaEcho/dsh-github-workflow`, `dsh-ci-doctor`, `dsh-gitflow`, GitHub MCP, or local `gh` / `git`.

The policy is therefore:

1. prefer the most semantically sufficient capability actually visible in the current session;
2. never infer semantics from a provider name or tool prefix alone;
3. step down only when a structured capability is insufficient;
4. use `gh`, `git`, or bundled zero-dependency helpers as the final fallback;
5. fallbacks may reduce convenience, never evidence or safety requirements.

> **Codex is the workflow-semantic baseline; the DSH adaptation re-targets those semantics to a multi-provider runtime.**

## 4. Where it sits in the ecosystem

![dsh-github-skills architecture and ecosystem position](assets/dsh-github-skills-architecture.png)

```text
GitHub / GitHub Actions / local Git
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ capability providers                         │
│ kaziii · PerryLink · ZariaEcho · GitHub MCP │
│ dsh-ci-doctor · dsh-gitflow · gh / git      │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ dsh-github-skills                            │
│ semantics · routing · evidence · safety      │
└──────────────────────────────────────────────┘
                 │
                 ▼
          DSH Coding Agent
```

The project is intentionally complementary to providers. Better providers should reduce CLI fallback and make the workflow layer more structured, not make it obsolete.

## 5. The four current Skills

- `github`: umbrella GitHub triage and early routing.
- `gh-address-comments`: thread-aware PR Review handling with local-fix / remote-write separation.
- `gh-fix-ci`: evidence-based GitHub Actions diagnosis and minimal fixes; external CI is report-only by default.
- `gh-publish`: task-scoped branch / staging / commit / push / Draft PR publication with mixed-worktree, fork and existing-PR safeguards.

## 6. Relationship to other DSH projects

| Project | Main role | Relationship |
|---|---|---|
| `kaziii/dsh-github-connector` | provider, auth, UI, structured PR / Review / CI capabilities | strongly complementary |
| `PerryLink/dsh-github` | GitHub model tools, approval-gated writes, Review / CI | complementary capability source |
| `ZariaEcho/dsh-github-workflow` | higher-level GitHub tools | partially overlapping surface, still composable by semantics |
| `jkrandom-sudo/dsh-ci-doctor` | specialist CI diagnosis | complementary evidence source |
| `lonelymoon87/dsh-gitflow` | local Git capabilities | complementary local capability source |
| GitHub MCP | standardized GitHub tool source | complementary; not replaced |
| `gh` / `git` | CLI infrastructure | final fallback |

The project does not optimize for tool count or API coverage.

## 7. Quality without expensive continuous model runs

Real model routing is non-deterministic and repeated end-to-end coding tasks are expensive. The maintenance strategy therefore prioritizes low-cost, repeatable and auditable evidence:

1. pin an official Codex GitHub-plugin baseline;
2. audit workflow-semantic conformance;
3. record every intentional divergence;
4. unit-test deterministic helpers and safety invariants;
5. use synthetic fixtures as behavioral specifications;
6. keep real model tasks optional for targeted manual reproduction or release spot checks.

The synthetic fixtures are not presented as deterministic LLM benchmarks.

## 8. What this project intentionally does not become

It is not another GitHub REST / GraphQL client, OAuth provider, SCM sidebar, GitHub MCP replacement, built-in token manager, general-purpose coding agent, or API-coverage toolbox.

> **Providers give DSH capabilities. `dsh-github-skills` teaches the agent how to compose those capabilities correctly and safely.**

## 9. Near-term direction

The near-term priority is not adding Skills quickly. It is to strengthen the current layer:

1. evolve the capability matrix from known provider/tool names toward semantic capabilities;
2. track DSH provider evolution and compatibility;
3. preserve the behavior and safety quality of the four existing Skills;
4. add a new Skill only when it represents a clear, independent and auditable workflow semantic;
5. prefer PR readiness / merge readiness as a future candidate over duplicating more GitHub APIs.

## 10. Further reading

- [`references/codex-conformance.md`](../references/codex-conformance.md)
- [`references/capability-matrix.md`](../references/capability-matrix.md)
- [`references/safety-model.md`](../references/safety-model.md)
- [`references/ecosystem-analysis.md`](../references/ecosystem-analysis.md)
- [`references/upstream-notes.md`](../references/upstream-notes.md)
- [`references/routing-fixture.md`](../references/routing-fixture.md)

`dsh-github-skills` is an unofficial community project for DeepSeek Harness. It is not affiliated with or endorsed by deepseek-ai, OpenAI, or GitHub. Attribution and reimplementation notes are in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).