# dsh-github-skills

English | [简体中文](README.zh-CN.md)

> **This is not a GitHub API plugin.** It is a skill pack that teaches DeepSeek
> Harness how to work *through* GitHub engineering workflows: PR triage,
> review feedback, CI diagnosis, and safe publish — composing whatever
> GitHub/Git capabilities are already available and falling back to `gh`/`git`
> when necessary.

*Unofficial community plugin for DeepSeek Harness (DSH). Not affiliated with
or endorsed by deepseek-ai, OpenAI, or GitHub.*

[![npm version](https://img.shields.io/npm/v/dsh-github-skills.svg)](https://www.npmjs.com/package/dsh-github-skills)
[![CI](https://img.shields.io/github/actions/workflow/status/Starfie1d1272/dsh-github-skills/ci.yml?branch=main)](https://github.com/Starfie1d1272/dsh-github-skills/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/Starfie1d1272/dsh-github-skills)](LICENSE)

## What it does

A skill-first, connector-agnostic workflow layer for GitHub in DSH. It ships
four skills that load only when invoked (progressive disclosure) and adapt to
whatever GitHub/Git capabilities your session already exposes:

| Skill | What it does |
|---|---|
| `github` | Umbrella router: resolves repo/PR/issue/branch context, classifies intent, and routes to the right specialist immediately. |
| `gh-address-comments` | Processes PR review feedback: thread-aware reads (resolved/outdated/anchors), classification, and local fixes with a strict remote-write boundary. |
| `gh-fix-ci` | Diagnoses or fixes failing GitHub Actions checks from real log evidence; external CI providers are report-only. |
| `gh-publish` | Safely publishes local changes: scope confirmation, branch, staging (never blind `git add -A`), commit, verify, push, draft PR. |

**Why it exists:** DSH already has several GitHub/Git capability providers —
what the ecosystem lacked is the workflow layer: routing, policy, safety
boundaries, and fallbacks. This pack provides that layer without reimplementing
any GitHub API.

## Install

Requires a DSH profile (the `web` profile is the GUI one). Choose one path:

### Global `dsh` CLI

```sh
dsh plugin --profile web add dsh-github-skills
dsh web
```

### Without a global DSH install: npx

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-github-skills
npx @deepseek-ai/dsh web
```

- `npx` needs no global DSH installation.
- The official `dsh plugin` command manages profile dependencies with `pnpm`,
  so **`pnpm` must still be on `PATH`**.
- Your Node runtime must satisfy the package `engines`
  (`^22.19.0 || >=24.0.0`).

### From GitHub (development / exact commit)

```sh
dsh plugin --profile web add github:Starfie1d1272/dsh-github-skills#<commit>
```

npx equivalent:

```sh
npx @deepseek-ai/dsh plugin --profile web add github:Starfie1d1272/dsh-github-skills#<commit>
```

- Pin a commit (`#<sha>`) so a later push cannot silently change what runs.
- This package is pure JavaScript with **no build/prepare step**, so a git
  install has no missing-build-artifact problem (no TypeScript `lib/` output,
  no `allowBuilds` prompt).
- For normal installations, prefer the npm package above; use a
  commit-pinned GitHub source for unreleased or auditable snapshots.

### Local tarball (advanced)

```sh
npm pack
dsh plugin --profile web add ./dsh-github-skills-0.1.0.tgz
```

---

**Availability:** npm installation is available in released versions
starting with `v0.1.0`. For unreleased commits, use the GitHub commit-pin or
local tarball installation paths.

## Uninstall

```sh
dsh plugin --profile web remove dsh-github-skills
```

or with npx:

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-github-skills
```

The profile's `dsh.profile.bundles` list is reconciled automatically by the
official plugin manager; no files are left behind in `~/.dsh`.

## Requirements

### Runtime / installation

- Node.js `^22.19.0 || >=24.0.0` (checked by `engines`).
- `pnpm` on `PATH` (used by the official `dsh plugin` command).
- DeepSeek Harness `dsh` — globally or via `npx`; the reviewed/tested baseline
  is `@deepseek-ai/dsh@0.1.0-rc.6`.

### Workflow fallbacks (per-feature)

- `git` — required by local workflows (preflight, publish).
- `gh` CLI (GitHub CLI) with an authenticated session — required by the
  bundled helpers that need GitHub-side reads (`gh-address-comments` review
  threads, `gh-fix-ci` Actions logs) and by CLI fallback paths.

If your DSH session already exposes sufficient structured GitHub capabilities,
not every workflow necessarily depends on `gh`; the skills prefer existing
capabilities and fall back to `gh`/`git` only where needed.

## Quick start

After installation, just say:

```text
"What's the state of PR 482?"            → github (triage)
"Address the review comments on this PR" → gh-address-comments
"Why is CI failing on my branch?"        → gh-fix-ci
"Commit these changes and open a draft PR" → gh-publish
"Fork awesome-foo, update its README, and open a PR" → gh-publish
```

Mixed requests may load multiple specialists — complete review or CI work
before publishing:

```text
"Fix the review comments, then push"     → gh-address-comments + gh-publish
"Fix CI, then open a PR"                 → gh-fix-ci + gh-publish
```

## Safety

See [references/safety-model.md](references/safety-model.md) for the normative
rules. Highlights:

- The helpers **never actively extract** a raw credential (`gh auth token` is
  never invoked) and **never store credentials**; every output path redacts
  known credential shapes (GitHub token prefixes, https remote URL userinfo)
  with stable placeholders before model-visible output. Untrusted remote
  content — comments, CI logs, gh/git stderr — is treated as untrusted and
  redacted for credential-shaped material.
- Analysis requests never become writes: "look at the review" does not reply
  or resolve; "why did CI fail" does not push a fix.
- "Address the review" authorizes **local** edits only; remote writes need
  explicit intent or the host approval gate.
- A mixed worktree is never staged with `git add -A`; scope ambiguity stops
  the publish flow.
- No force push, no default merge, no branch deletion, no hook bypass.
- Fallbacks are capability-equivalent and never safety-reducing.

## Compatibility

- Reviewed/tested baseline: `@deepseek-ai/dsh@0.1.0-rc.6`. CI runs the full
  unit/safety suite plus a real disposable-profile install smoke on Node
  22.19 and Node 24.
- Later DSH releases may work but do **not** automatically become a supported
  baseline; the current contract audit only shows the interfaces are still
  compatible at audit time, not a promise for future versions.
- The skills are connector-agnostic by design: they adapt to whatever
  GitHub/Git capabilities the host session exposes.

## Architecture

```
lib/index.js            minimal bundle shim: registers a read-only SkillProvider
skills/<name>/SKILL.md  four skills; catalog renders name + description only, bodies load on demand
skills/*/scripts/       zero-dependency Node helpers (thread reads, CI evidence,
                        publish preflight)
references/             capability matrix, safety model, upstream notes,
                        conformance record, GitHub MCP reference, routing fixture
```

The only code is the shim: it registers the four SKILL.md bundles on
`ctx.skills` (bundled rank, lazy body reload, directory `resourceBase`). It
registers no GitHub API tools and manages no credentials.

**Optional GitHub MCP:** GitHub's official MCP server can be wired into DSH
as an additional structured capability source. The skills then pick its
tools by semantics like any other visible capability. See
[references/github-mcp.md](references/github-mcp.md) for the DSH profile
configuration; this package does not configure MCP servers or manage
credentials.

## Ecosystem relations

| Project | Role | Relationship |
|---|---|---|
| [kaziii/dsh-github-connector](https://github.com/kaziii/dsh-github-connector) | GitHub provider/auth (Device Flow)/UI | Complementary; its auth/UI surface is what this pack does not do. |
| [PerryLink/dsh-github](https://github.com/PerryLink/dsh-github) | Approval-gated GitHub model tools | Complementary/competitive; skills prefer its tools when installed, then fall back to `gh`. |
| [ZariaEcho/dsh-github-workflow](https://github.com/ZariaEcho/dsh-github-workflow) | Higher-level GitHub toolset | Not a replacement; skills can route to its tools when present. |
| [jkrandom-sudo/dsh-ci-doctor](https://github.com/jkrandom-sudo/dsh-ci-doctor) | CI diagnosis primitive | Complementary; `gh-fix-ci` prefers `ci_diagnose` when visible. |
| [lonelymoon87/dsh-gitflow](https://github.com/lonelymoon87/dsh-gitflow) | Local git primitive | Complementary; its tools are the git fallback layer. |
| [BrambleXu/dsh-revdiff](https://github.com/BrambleXu/dsh-revdiff) | Interactive local diff review | Largely disjoint; can feed a publish flow upstream. |
| [Lixiaoyiao/deepseek-harness-action](https://github.com/Lixiaoyiao/deepseek-harness-action) | GitHub Action running DSH in CI | Different trigger surface (events vs conversation). |

This project is the **workflow brain / routing / safe composition** layer; it
deliberately does not compete on tool surface with any of the above.

## Upstream attribution

The workflow structure is informed by the official
[OpenAI Codex GitHub plugin](https://github.com/openai/plugins/tree/main/plugins/github)
(installed locally as version `0.1.8-2841cf9749ae`). Adapted/reimplemented
content is attributed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
detailed in [references/upstream-notes.md](references/upstream-notes.md).
Helpers are independent Node reimplementations, not Python translations. This
project is not affiliated with, or endorsed by, OpenAI.

## Development

```sh
npm test                 # unit, safety, structure, redaction, package tests
npm run pack:check       # npm pack allowlist + isolated install + shim registration
npm run test:smoke       # end-to-end disposable-profile install (real dsh + pnpm)
```

## License

Apache-2.0. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
