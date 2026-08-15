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

### Fixed (post-conformance adversarial hardening)

Security hardening:

- **Credential-bearing remote URL leak (high):** `publish-preflight.mjs`
  emitted `git remote get-url origin` verbatim; an https remote with
  userinfo credentials (`https://user:TOKEN@github.com/...`) reached
  stdout. All helper output now passes through `lib/redact.mjs` conservative
  redaction (GitHub token shapes + https URL userinfo password; ssh `git@`
  forms untouched), with stable placeholders.
- **Secret-like remote content (high):** untrusted PR comments, review
  thread bodies, and CI logs that contain pasted tokens are redacted before
  they reach model-visible output; gh/git error stderr passes through the
  same redaction. `references/safety-model.md` now states the accurate
  contract (never actively extracts; redacts known patterns; treats remote
  content as untrusted) instead of over-claiming.

Correctness:

- **Unequal pagination (high):** `fetch-review-threads.mjs` fetched all
  three collections in one query; once one collection finished, later pages
  re-requested it without a cursor and re-appended page one (reproduced:
  3/1/2 pages → comments/reviews/threads duplicated). Each collection now
  paginates with its own query and cursor; a finished collection is never
  requested again.
- **Thread comments > 100 (medium):** a thread's comments were silently
  truncated at 100. The helper now records `commentsTruncated` +
  `commentsPageInfo` per thread instead of claiming a complete view.
- **External CI misclassification (medium):** generic `/runs/<id>` URLs
  (CircleCI, self-hosted CI) were treated as GitHub Actions. Detection now
  requires the canonical `/actions/runs/<id>` path (github.com and GHES);
  external CI is never log-diagnosed and never calls run/job APIs.
- **Cross-repo PR context (medium):** with a PR URL for a different
  repository, `gh run view`/job logs still bound to the local checkout.
  All repo-bound gh queries now carry an explicit `-R <owner/repo>` resolved
  from the PR target (URL, numeric-PR local repo, or current-branch PR
  canonical URL).
- **Worktree scope signals (medium):** `mixedWorktree` only fired for
  staged + (unstaged|untracked); unstaged + untracked slipped through. The
  preflight now emits objective signals (`hasStaged`/`hasUnstaged`/
  `hasUntracked`, `partiallyStagedFiles`, `multipleChangeClasses`,
  `scopeNeedsInspection`) and redefines `mixedWorktree` as any two change
  classes present; the skill still judges scope from diff + task intent.

Tests & infrastructure:

- **Protocol-aware fake gh:** the fake now matches GraphQL pages by the
  cursor actually passed in argv, verifies `-R` repo bindings
  (`expectedRepo`), and fails loudly on unknown cursors/collections instead
  of returning canned sequences by call count.
- Adversarial regressions: unequal 3/1/2 pagination, 100+1 boundary, one
  collection empty, thread comments >100, `/runs/123` external, CircleCI
  URL, GHES canonical, local-repo-A + PR-URL-B cross-repo, credential
  remote URL, pasted tokens in comments/CI logs/gh stderr.
- New `lib/redact.mjs` unit tests (9 cases incl. idempotence and prose
  preservation).
- **Release engineering:** added `.github/workflows/ci.yml` (Node 22.19 +
  24 matrix, unit/safety tests, package validation, disposable-profile
  install smoke against pinned DSH rc.6), `repository`/`bugs`/`homepage`
  metadata, `prepublishOnly` (tests + package validation; install smoke
  deliberately excluded because it needs a live DSH install), and truthful
  README install sections (npm path marked "available after npm release";
  local tarball path is the currently available one).
