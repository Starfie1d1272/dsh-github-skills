# dsh-github-skills

> **This is not a GitHub API plugin.** It is a skill pack that teaches DeepSeek
> Harness how to work *through* GitHub engineering workflows. It composes
> whatever GitHub/Git capabilities are already available in your session and
> falls back to `gh`/`git` when necessary.

dsh-github-skills is a **skill-first, connector-agnostic workflow
orchestration layer** for DeepSeek Harness (DSH). It ships four skills — an
umbrella router plus three specialist workflows (review feedback, CI
diagnosis, safe publish) — modeled on the proven progressive-disclosure
structure of the official OpenAI Codex GitHub plugin, adapted to DSH's
capability model.

## Why this exists

DSH already has several GitHub/Git capability providers (see
[Relations to existing projects](#relations-to-existing-projects)). What the
ecosystem lacked was the **workflow layer**: routing, policy, safety
boundaries, and fallbacks that turn raw capabilities into reliable
engineering workflows. Capabilities are abundant; workflows are not.

This pack fills that gap with:

- **skill-first** — four `SKILL.md` bundles, catalog = name + description,
  full workflows load only on invocation (progressive disclosure). No
  resident system prompt, no hundred-token prompt bloat.
- **connector-agnostic** — no dependency on any single DSH GitHub provider;
  skills detect what is actually visible in the current tool catalog and use
  the most specialized capability first, stepping down to `gh`/`git`.
- **fail-closed for remote writes** — analysis never becomes a write; every
  remote mutation requires explicit user intent or the DSH approval gate.
- **local-first where the checkout matters** — publish scope confirmation is
  deterministic (`publish-preflight.mjs`), and a mixed worktree is never
  blindly staged with `git add -A`.

## What this is / is not

| Is | Is not |
|---|---|
| A workflow/skill orchestration layer for GitHub | A new GitHub REST/GraphQL client |
| A router over existing DSH GitHub/Git/CI capabilities | A new OAuth / PAT / device-flow implementation |
| A safe publish-flow guide with deterministic preflight | A new generic issue/PR/search toolset |
| Node helpers for thread-aware reads, CI evidence, publish scope | A new GitHub Action |
| Apache-2.0, zero runtime dependencies | A modification of DeepSeek Harness core |

## The four skills

| Skill | Purpose | Routes to / uses |
|---|---|---|
| [`github`](skills/github/SKILL.md) | Umbrella router: resolve context, classify intent, route immediately | `gh-address-comments`, `gh-fix-ci`, `gh-publish` |
| [`gh-address-comments`](skills/gh-address-comments/SKILL.md) | Process PR review feedback: thread-aware reads, classification, local fixes | `scripts/fetch-review-threads.mjs` (GraphQL via `gh`) |
| [`gh-fix-ci`](skills/gh-fix-ci/SKILL.md) | Diagnose or fix GitHub Actions failures from real log evidence | `scripts/inspect-pr-checks.mjs` |
| [`gh-publish`](skills/gh-publish/SKILL.md) | Safe local → GitHub publish: scope, branch, stage, commit, verify, push, draft PR | `scripts/publish-preflight.mjs` (read-only) |

### `github` — umbrella router

Triggers: "look at this PR", "what's happening on GitHub", "check this
issue", "what needs handling on the current PR", "why did CI fail", "send
these changes as a PR".

It resolves the operating context (repo / PR / issue / branch), classifies
the intent into *general triage*, *review feedback*, *CI debugging*, or
*publish changes*, and **routes immediately** to the matching specialist
skill instead of duplicating their work.

### `gh-address-comments` — review feedback

Fetches the complete review context and keeps three layers distinct:
top-level **conversation comments**, **review submissions**, and **inline
review threads** (with `isResolved`, `isOutdated`, `path`, `line`,
`diffSide`, `startLine`). Flat comments are never treated as full
review-thread state.

Threads are classified (actionable / informational / approval / resolved /
outdated / duplicate / ambiguous), clustered by file or behavior area, and
addressed locally with traceability. "Address the review" authorizes local
edits to unresolved actionable threads; it never authorizes replying,
resolving, pushing, or any other remote write by itself.

### `gh-fix-ci` — CI diagnosis

Only GitHub Actions checks enter automatic log diagnosis; external CI
providers (Buildkite, CircleCI, ...) are **report-only** (name + URL +
state). `inspect-pr-checks.mjs` extracts bounded failure evidence (run/job
ids, metadata, snippet/tail) with gh field-drift and job-log fallbacks —
and reports pending or unavailable logs honestly. The agent decides root
cause from evidence; the script never fabricates one.

### `gh-publish` — safe publish

The only skill that performs remote writes by design (that is the explicit
publish intent). Strict order: resolve git root → inspect status/diff →
identify scope → branch strategy → stage **only intended files** (never
default `git add -A` on a mixed worktree) → commit (hooks respected, no
force) → relevant verification → push with upstream → **draft PR** (existing
DSH PR capability first, `gh pr create` fallback). Fork/cross-repo heads use
`gh pr create`. Branch/commit/PR conventions follow the target repository —
no forced prefixes or languages.

## Architecture

```
dsh-github-skills/
  package.json            # DSH bundle contract: dsh.bundle.patch
  cordis.patch.yml        # mounts the one shim row
  lib/index.js            # minimal shim: registers a read-only skill provider
  skills/
    github/SKILL.md                     # umbrella router
    gh-address-comments/SKILL.md
    gh-address-comments/scripts/fetch-review-threads.mjs
    gh-fix-ci/SKILL.md
    gh-fix-ci/scripts/inspect-pr-checks.mjs
    gh-publish/SKILL.md
    gh-publish/scripts/publish-preflight.mjs
  references/
    capability-matrix.md   # which capability for which job, and the fallback order
    safety-model.md        # normative hard rules
    upstream-notes.md      # Codex GitHub plugin provenance and intentional changes
  tests/                   # structure/unit/safety/package tests + install smoke
```

The only code is `lib/index.js`: a deliberately thin bundle shim that
registers the four SKILL.md bundles on `ctx.skills` (read-only, lazy body
loading, directory `resourceBase`). It registers **no** GitHub API tools and
manages **no** credentials.

## Capability resolution

See [references/capability-matrix.md](references/capability-matrix.md) for
the full matrix. The rule, in order:

1. Use the most specialized **existing DSH capability** visible in the
   current catalog (e.g. `gh_get_repo_context`, `gh_analyze_issue`,
   `github_pr_read`, `pr_create`, `ci_diagnose`, `git_status`, ...).
2. Otherwise step down to a broader existing capability.
3. Finally fall back to `gh`/`git` and this pack's Node helpers.
4. Never pretend a capability exists; never invent a tool name.

## Relations to existing projects

| Project | Role in the ecosystem | Relationship to this pack |
|---|---|---|
| [kaziii/dsh-github-connector](https://github.com/kaziii/dsh-github-connector) | GitHub service / provider / auth (Device Flow) / Web UI layer | Complementary. Its credential/UI surface is exactly what this pack does not do. |
| [PerryLink/dsh-github](https://github.com/PerryLink/dsh-github) | GitHub model tools with approval-gated writes | Complementary/competitive. When its `gh_*`/`pr_*`/`issue_*` tools are installed, skills prefer them, then fall back to `gh`. |
| [ZariaEcho/dsh-github-workflow](https://github.com/ZariaEcho/dsh-github-workflow) | Higher-level GitHub toolset (12 tools + resident system prompt) | **Not a replacement.** This pack provides skill orchestration / progressive disclosure; if its tools are installed, the skills can route to them. |
| [jkrandom-sudo/dsh-ci-doctor](https://github.com/jkrandom-sudo/dsh-ci-doctor) | CI diagnosis primitive (`ci_diagnose`, log signatures) | Complementary. `gh-fix-ci` prefers `ci_diagnose` when visible for deep structured diagnosis. |
| [lonelymoon87/dsh-gitflow](https://github.com/lonelymoon87/dsh-gitflow) | Local git primitive (status/diff/commit/branch; no stage/push/PR) | Complementary. Its tools are the git fallback layer; publish still uses controlled `git` for stage/push. |
| [BrambleXu/dsh-revdiff](https://github.com/BrambleXu/dsh-revdiff) | Interactive local diff review TUI | Largely disjoint; its annotated reviews can feed a publish flow upstream. |
| [Lixiaoyiao/deepseek-harness-action](https://github.com/Lixiaoyiao/deepseek-harness-action) | GitHub Action running DSH in CI | Different trigger surface (events vs conversation). Skills can double as prompt assets inside CI runtimes. |

This project is the **workflow brain / routing / safe composition** layer. It
deliberately does not compete on tool surface with any of the above.

## Install

Requirements:

- DeepSeek Harness `dsh` 0.1.0-rc.6 or compatible (skill registry with
  `ctx.skills`)
- Node.js `^22.19.0 || >=24.0.0`
- `pnpm` (the profile plugin manager)
- `gh` CLI (GitHub CLI), authenticated (`gh auth status`) for GitHub-side work
- `git` for local workflows

### From npm (available after npm release)

```sh
dsh plugin --profile web add dsh-github-skills
```

This becomes the primary install path once the package is published to the
npm registry.

### From GitHub / local tarball (currently available)

The package is not yet published to npm; this is the current install path.
From a local checkout:

```sh
npm pack
dsh plugin --profile web add ./dsh-github-skills-0.1.0.tgz
```

or install the tarball produced by the release artifacts directly.

Restart the profile, then the four skills appear in the model's skill
catalog (`github`, `gh-address-comments`, `gh-fix-ci`, `gh-publish`) and
load on invocation.

### Uninstall

```sh
dsh plugin --profile web remove dsh-github-skills
```

The profile's `dsh.profile.bundles` list is reconciled automatically; no
files are left behind in `~/.dsh`.

## Safety

See [references/safety-model.md](references/safety-model.md) for the
normative rules. Highlights:

- Credentials never enter skill output, logs, temp files, PR bodies,
  commits, or error messages; `gh auth token` is never invoked.
- Analysis requests never become writes: "look at the review" does not reply
  or resolve; "why did CI fail" does not push a fix.
- "Address the review" authorizes **local** edits only; remote writes need
  explicit intent or the host approval gate.
- A mixed worktree is never staged with `git add -A`; scope ambiguity stops
  the publish flow.
- No force push, no default merge, no branch deletion, no hook bypass.
- Fallbacks are capability-equivalent and never safety-reducing.

## Examples

```text
"What's the state of PR 482?"            → github (triage)
"Address the review comments on this PR" → gh-address-comments
"Why is CI failing on my branch?"        → gh-fix-ci
"Commit these changes and open a draft PR" → gh-publish
```

## Compatibility

- Verified against `@deepseek-ai/dsh` 0.1.0-rc.6 (this repo's CI runs the
  full unit/safety suite plus a real disposable-profile install smoke on
  Node 22.19 and Node 24).
- Node 22.19+ and Node 24 are the supported runtime range.
- The pack does **not** claim compatibility with every DSH version; the
  install smoke test pins the contract to the version it verifies.
- The skills are connector-agnostic by design: they adapt to whatever
  GitHub/Git capabilities the host session exposes, so the pack keeps
  working as the DSH provider ecosystem evolves.

## Upstream attribution

The workflow structure is informed by the official
[OpenAI Codex GitHub plugin](https://github.com/openai/plugins/tree/main/plugins/github)
(installed locally as version `0.1.8-2841cf9749ae`). Specialist skill
directories in that plugin carry Apache-2.0 licenses; adapted/reimplemented
content is attributed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
and detailed in [references/upstream-notes.md](references/upstream-notes.md).
This project is not affiliated with or endorsed by OpenAI. Helpers are
independent Node reimplementations, not Python translations.

## Development / tests

```sh
npm test                # structure, unit, safety, package tests (node:test, zero deps)
node tests/install-smoke.mjs   # end-to-end disposable-profile install verification
```

Test coverage:

- **Skill structure** — frontmatter, names, descriptions, broken links,
  umbrella routing targets.
- **Helper unit tests** — thread pagination/state/errors/auth, check
  field-drift/log fallbacks/external CI, preflight against real disposable
  git repos (clean/dirty/staged/mixed/detached/ahead-behind/no-origin).
- **Safety regressions** — zero-write audit for read workflows and
  preflight, fake-token containment, no shell interpolation, mixed-worktree
  handling, external CI never log-diagnosed.
- **Package validation** — `npm pack` contents, bundle contract, installed
  shim registers all four skills.
- **Install smoke** — real `dsh plugin add` into a disposable profile, then
  discovery + body loading through the real `ctx.skills` registry.

## License

Apache-2.0. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
