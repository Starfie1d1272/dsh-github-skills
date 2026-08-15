# Upstream Notes — OpenAI Codex GitHub Plugin Reference

This file records what was inspected on this machine and upstream, what was
borrowed, and what was intentionally changed. It exists so that every
adaptation and every "design informed by" claim is traceable.

## Sources inspected

### Local installed Codex GitHub plugin (runtime reference)

| Item | Value |
|---|---|
| Install root | `~/.codex/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/` |
| Version | `0.1.8-2841cf9749ae` (per `.codex-plugin/plugin.json`) |
| Cache mtime | 2026-07-10 |
| Manifest | `.codex-plugin/plugin.json` (name `github`, author OpenAI, `license: "MIT"`) |
| App binding | `.app.json` → `connector_76869538009648d5b282a4bb21c3d157` (GitHub connector app) |

Files:

| Path (relative to install root) | SHA-256 | Note |
|---|---|---|
| `skills/github/SKILL.md` | `81dbdd90934fe86a79ddc4790fd211e5fca866302a74090ad153395f56f2bd42` | umbrella router |
| `skills/github/agents/openai.yaml` | `b5757b2531a1cae7a25a0b437dabd222f81e3deb901e5ef931e967e2d81c7efa` | agent interface metadata |
| `skills/gh-address-comments/SKILL.md` | `c1ebc337357402f7faabafe712e0c463981a65f736453efe52abd305bcb74769` | review feedback specialist |
| `skills/gh-address-comments/scripts/fetch_comments.py` | `d7bc64f6b26f7482f9ca9dd7c923a5b8b20e1ef13491ae2d9052cd208a7c1ad1` | GraphQL thread fetcher |
| `skills/gh-address-comments/LICENSE.txt` | `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd` | Apache-2.0 |
| `skills/gh-fix-ci/SKILL.md` | `7621a3560d788fb221d25f9753233fe0c393c5cfe63167c88b11f027c277b1f8` | CI diagnosis specialist |
| `skills/gh-fix-ci/scripts/inspect_pr_checks.py` | `9459e5b03f86785d184a83e5cd8d621b832e918ec04158a2962d867785812c6c` | checks/log inspector |
| `skills/gh-fix-ci/LICENSE.txt` | (Apache-2.0, 201 lines) | Apache-2.0 |
| `skills/yeet/SKILL.md` | `e93c6ea769ba673d30749a981cd8ad75b687f454e3c8e2e45e7cfcbd412df12c` | publish specialist (local variant) |
| `skills/yeet/LICENSE.txt` | (Apache-2.0, 201 lines) | Apache-2.0 |

Other copies found on this machine (same content, different purpose):

- `~/.codex/vendor_imports/skills/skills/.curated/gh-address-comments`, `.../gh-fix-ci` — vendored copies
- `~/.codex/.tmp/plugins/plugins/github/` — transient extracted repo copy
- `~/.codex/.tmp/plugins-backup-slAQnY/repo/plugins/github/` — transient backup copy

### Public openai/plugins (provenance / license reference)

| Item | Value |
|---|---|
| Repo | https://github.com/openai/plugins |
| Default branch | `main` |
| Latest commit touching `plugins/github` (at inspection time) | `4c2b32e42cf50cea9599bb8a167c1db759e6ce40` (2026-06-23, "[codex] Add GitHub MCP support for API-key sessions (#356)") |
| Root license file | **none** — the repository ships no root LICENSE; the GitHub plugin's specialist skill directories carry their own `LICENSE.txt` (Apache-2.0) |
| Plugin manifest license field | `"license": "MIT"` (plugin-level metadata) |

Byte-identical between the local 0.1.8 cache and upstream `main` at inspection
time: `skills/github/SKILL.md`, `skills/gh-address-comments/SKILL.md`,
`skills/gh-address-comments/scripts/fetch_comments.py`, `skills/gh-fix-ci/SKILL.md`,
`skills/gh-fix-ci/scripts/inspect_pr_checks.py`.

Diverging file: `skills/yeet/SKILL.md`. Local 0.1.8 uses branch
`agent/{description}` and PR title `{description}`; upstream `main` uses branch
`codex/{description}` and PR title `[codex] {description}`. The local installed
version is treated as the runtime behavior reference; upstream `main` is the
provenance reference.

## Licensing conclusion

- The **umbrella `github` skill has no per-file license**; only the plugin
  manifest declares MIT. We therefore treat the umbrella as *design-informed*:
  our `github` skill is an independent implementation of the same routing
  concept, not a copy.
- The **specialist skills and their Python scripts carry clear Apache-2.0
  licenses** (`LICENSE.txt` in each directory). Where we adapt their structure
  and guardrails, we retain Apache-2.0 attribution via `THIRD_PARTY_NOTICES.md`.
- Our helper scripts are **independent Node reimplementations** of the
  upstream Python behavior (never byte-level translations), informed by the
  robustness points listed in each skill's SKILL.md. They are covered by this
  project's own license (Apache-2.0) with upstream attribution.
- We make no claim of OpenAI endorsement, and we do not use the "yeet" name
  or the `codex/` branch convention.

## Borrowed design (with attribution)

1. **Umbrella router pattern** — a `github` skill that resolves context,
   classifies intent (triage / review feedback / CI debugging / publish),
   and routes immediately to a specialist skill instead of doing everything.
2. **Thread-aware review reads** — treating inline `reviewThreads`
   (`isResolved`, `isOutdated`, `path`, `line`, `diffSide`, `startLine`) as
   distinct from flat conversation comments and review submissions.
3. **CI diagnosis discipline** — only GitHub Actions checks enter log
   diagnosis; external providers are report-only; pending/missing logs are
   reported honestly; root cause must cite real log/diff evidence.
4. **Publish workflow safety** — local-git scope first, no default
   `git add -A` on a mixed worktree, staged commit → verify → push → draft PR
   ordering, fork/cross-repo handling.

## Intentional changes (this project)

| # | Upstream (Codex) | This project | Why |
|---|---|---|---|
| 1 | Python helpers (`fetch_comments.py`, `inspect_pr_checks.py`) | Node `.mjs` helpers (`fetch-review-threads.mjs`, `inspect-pr-checks.mjs`, `publish-preflight.mjs`), zero runtime deps | DSH guarantees a Node environment; avoids a Python requirement |
| 2 | Codex connector-first abstraction | DSH capability matrix (detect whatever GitHub/Git/CI tools are actually visible; fall back to `gh`/`git`) | DSH has no single GitHub connector; several community providers exist and must be composable |
| 3 | `yeet` skill name | `gh-publish` | Discoverable, semantically stable name; not a Codex-branded term |
| 4 | Codex-specific tool assumptions (connector app, `$github` mentions) | DSH-visible-tool detection from the live tool catalog | The model must not assume a plugin is installed that is not |
| 5 | Single connector preference | Multiple DSH provider compatibility (PerryLink/dsh-github, kaziii/dsh-github-connector, ZariaEcho/dsh-github-workflow, ...) | DSH ecosystem has several providers; the pack must work with any combination |
| 6 | "Ask user to approve" prose inside the skill | DSH host approval boundary: analysis vs. remote write is decided by explicit user intent plus the DSH approval gate | DSH owns approval policy; the skill must not fake its own |
| 7 | Plugin ships a large resident instruction set | No resident system-prompt injection; skills load only on invocation (progressive disclosure) | DSH skill catalog is name+description until invoked |
| 8 | Current-branch PR review reads use the **head** repo (`headRepositoryOwner`/`headRepository`) | `fetch-review-threads.mjs` resolves the **target** repo from the PR canonical URL, falling back to the head repo only for same-repo PRs | A fork PR's reviewThreads belong to the target repository; `gh` exposes no `baseRepository` JSON field, so the PR URL (always target) is the reliable source. Intentional correction of an upstream fork-PR issue |

## How the four skills map

| This project | Upstream counterpart | Relationship |
|---|---|---|
| `skills/github/SKILL.md` | `skills/github/SKILL.md` | Design-informed reimplementation (router concept, DSH-flavored) |
| `skills/gh-address-comments/SKILL.md` + `scripts/fetch-review-threads.mjs` | `skills/gh-address-comments/SKILL.md` + `scripts/fetch_comments.py` | Adapted structure + independent Node reimplementation |
| `skills/gh-fix-ci/SKILL.md` + `scripts/inspect-pr-checks.mjs` | `skills/gh-fix-ci/SKILL.md` + `scripts/inspect_pr_checks.py` | Adapted structure + independent Node reimplementation |
| `skills/gh-publish/SKILL.md` + `scripts/publish-preflight.mjs` | `skills/yeet/SKILL.md` | Adapted safety structure, renamed, plus new deterministic preflight script (no upstream counterpart) |
