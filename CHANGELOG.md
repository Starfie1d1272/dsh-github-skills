# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-15

### Added

- **Four skills** shipped as DSH `SKILL.md` bundles:
  - `github` — umbrella router (resolve context → classify intent → route).
  - `gh-address-comments` — thread-aware PR review feedback workflow.
  - `gh-fix-ci` — GitHub Actions diagnosis/fix workflow with honest evidence.
  - `gh-publish` — safe local → GitHub publish workflow (scope-confirmed,
    draft-PR-first).
- **Three zero-dependency Node helper scripts**:
  - `fetch-review-threads.mjs` — paginated thread-aware GraphQL read via `gh`.
  - `inspect-pr-checks.mjs` — failing-check facts with gh field-drift and
    job-log fallbacks; external CI is report-only.
  - `publish-preflight.mjs` — strictly read-only git scope evidence
    (git root, branch, detached, default branch, origin, upstream, status,
    staged/unstaged/untracked, diff stat, ahead/behind, `mixedWorktree`).
- **Minimal bundle shim** (`lib/index.js`) — registers the four skills on
  `ctx.skills`; registers no GitHub API tools and manages no credentials.
- **Reference docs** — `references/capability-matrix.md`,
  `references/safety-model.md`, `references/upstream-notes.md`.
- **Test suite** (`node:test`, zero dev dependencies) — skill structure,
  helper unit tests (fake gh/git), safety regressions, package validation,
  and an end-to-end disposable-profile install smoke.
- Apache-2.0 license, THIRD_PARTY_NOTICES with OpenAI Codex GitHub plugin
  provenance, README + README.zh-CN.

### Safety posture

- Remote writes require explicit user intent or the DSH approval gate.
- Mixed worktrees are never staged with `git add -A`.
- Helpers are read-only (except the publish flow itself, which is the
  explicit user intent).
- No `gh auth token` usage; credentials never reach output.

### Fixed (Codex upstream conformance audit)

- **Fork-PR review-thread resolution (high):** current-branch PR resolution
  now targets the repository that owns the PR (canonical PR URL) instead of
  the fork head repo, so reviewThreads queries never hit the wrong
  repository.
- **Partially staged files (medium):** `gh-publish` now documents that an
  `MM` file must never be blindly re-`git add`ed; stage specific hunks or
  report scope ambiguity.
- **Existing PR on branch (medium):** `gh-publish` now checks `gh pr view`
  first and never creates a duplicate PR.
- **Non-origin remotes (medium):** push now prefers the branch's tracked
  remote (preflight `upstream`) instead of hard-coding `origin`.
- **Fork publish (low):** documented pushing to the fork remote and
  `gh pr create --head <fork>:<branch> --repo <target>`, failing closed when
  fork semantics are unclear.
- **Umbrella tool-name collisions (low):** documented exact full-name +
  signature matching for `gh_*` tools shared across providers.
- Added `references/codex-conformance.md` with the pinned upstream baselines
  and the full behavior matrices.
