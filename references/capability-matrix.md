# Capability Resolution Matrix

This project is connector-agnostic. It composes whatever GitHub/Git/CI
capabilities are **actually visible in the current DSH tool catalog** and
falls back to `gh`/`git` only where existing capabilities are absent or
insufficient.

The rule, in order:

> 1. Use the most specialized existing DSH capability that matches the need.
> 2. Otherwise step down to a broader existing capability.
> 3. Finally fall back to `gh` CLI / `git` CLI / this pack's Node helpers.
> 4. Never pretend a capability exists. Never invent a tool name. Never
>    silently upgrade a fallback into something it is not.

"Visible" means the model can actually observe the tool in its current
catalog for the current session. The matrix below lists known community
providers; a tool name is usable **only if it appears in the live catalog**.

## 1. Structured repository / issue / PR data

| Capability need | Preferred (DSH tool catalog) | Fallback |
|---|---|---|
| Repo context, issue read/summary, PR metadata, search | ZariaEcho/dsh-github-workflow: `gh_get_repo_context`, `gh_analyze_issue`, `gh_search_related`; PerryLink/dsh-github: `gh_review`, `gh_issue`, `gh_search`; kaziii/dsh-github-connector: `github_search`, `github_issue_read`, `github_pr_read` | `gh repo view`, `gh issue view`, `gh pr view`, `gh search` |
| Flat PR conversation comments | Any provider's comment/issue-comment tool, or `gh api` REST | `gh api repos/{owner}/{repo}/issues/{n}/comments` |
| Review thread state (resolved/outdated/anchors) | A DSH tool that exposes `reviewThreads` semantics | **`gh api graphql` via this pack's `fetch-review-threads.mjs`** — never approximate threads from flat comments |
| Write: comment / reply / resolve / submit review | Provider write tools behind the DSH approval gate | `gh api ... -X POST`, `gh pr comment`, `gh pr review` |

## 2. Local git

| Capability need | Preferred (DSH tool catalog) | Fallback |
|---|---|---|
| status / diff / log / commit / branch | lonelymoon87/dsh-gitflow tools (when visible) — note it deliberately does **not** stage, push, or create PRs | `git status`, `git diff`, `git log`, `git commit`, `git branch` |
| Deterministic preflight scope evidence | **`publish-preflight.mjs`** (read-only) | — |
| stage / push / PR | No existing DSH primitive covers these as a workflow; use controlled `git` CLI + `gh pr create` | — |

`dsh-gitflow`'s explicit non-goals (stage/push/PR) mean the publish flow must
never assume it can do those; the flow uses controlled local `git` CLI and,
after push, an existing DSH PR-create capability or `gh pr create`.

## 3. CI

| Capability need | Preferred (DSH tool catalog) | Fallback |
|---|---|---|
| CI diagnosis on GitHub Actions | jkrandom-sudo/dsh-ci-doctor `ci_diagnose` when visible and suitable | **`inspect-pr-checks.mjs` + `gh`** |
| Non-GitHub Actions providers (Buildkite, CircleCI, ...) | report-only: check name + URL + state | same; never attempt provider-specific log reads |

Rules:

- Only **GitHub Actions** checks enter automatic log diagnosis.
- External CI is **report-only** — name, URL, status — with no fake root cause.
- Pending or unavailable logs are reported honestly; never fabricate a
  failure reason from a bare error string.

## 4. Review threads

| Capability need | Preferred (DSH tool catalog) | Fallback |
|---|---|---|
| `isResolved`, `isOutdated`, thread id, `path`, `line`, `side`, comments | A DSH tool that preserves thread state | **`fetch-review-threads.mjs`** via authenticated `gh api graphql` |

Ordinary issue comments and flat review comments are **not** full
review-thread state and must not be presented as such.

## 5. PR creation

| Capability need | Preferred (DSH tool catalog) | Fallback |
|---|---|---|
| Create PR after push | Existing DSH GitHub PR-create capability (e.g. `gh_create_draft_pr`, `github_pr_create`, `pr_create`) | `gh pr create --draft` |

The full publish flow (scope → branch → stage → commit → verify → push) is
local-first; remote PR creation happens **after** a successful push.

## 6. Authentication

| Need | Preferred | Fallback |
|---|---|---|
| GitHub credentials | Existing DSH GitHub provider credential handling | `gh`'s own auth (`gh auth status`; user runs `gh auth login`) |

This pack never reads tokens out of `gh` (`gh auth token` is avoided), never
stores credentials, and never implements OAuth/device flow.

## Decision procedure for a request

1. Resolve the operating context (repo / PR / issue / branch / local checkout).
2. Classify intent: general triage | review feedback | CI debugging | publish.
3. For specialist intents, route to the matching skill **immediately**.
4. Inside a skill, pick capabilities with the matrix above, in order.
5. If no existing capability matches, use `gh`/`git`/this pack's helpers.
6. Report what was used, what was verified, and what remains uncertain.
