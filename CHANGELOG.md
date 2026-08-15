# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-16

### Changed

- **Routing and responsibility boundaries rewritten.** All four SKILL.md
  files replaced with compressed, high-signal prompts focused on the routing
  contract and safety invariants rather than edge-case coverage. Total body
  text reduced from 383 (v0.1.2) to **194 lines (−49%)**; the GLM design
  draft landed at 238, and the final pass kept the compression while fixing
  routing semantics.
- **Resident descriptions re-compressed.** The rc.6 model-facing skill
  catalog renders `name` + `description` for skill selection
  (`@deepseek-ai/dsh-tool-skill@0.1.0-rc.6` emits `- name: description`
  entries under a 500-char host cap), so the description is the primary
  router. The final pass re-compressed the descriptions from the GLM draft
  (total 1467 chars; `github` alone was 458) to a resident budget of
  ≤300 chars each (total **772** — below v0.1.2's 851). The `github`
  description no longer restates the specialists' full routing table; all
  four descriptions appear together in the catalog.
- **Mixed specialist composition.** Removed the "mixed requests follow
  their widest specialist path" rule. A mixed request may require multiple
  specialists: complete review or CI domain work before publishing, and
  `gh-publish` does not replace `gh-address-comments` / `gh-fix-ci`.
  Documented in the umbrella, `references/routing-fixture.md`, and the
  README quick start.
- **External-contribution routing corrected (target-checkout semantics).**
  `gh-publish` step 1 now requires that the local checkout belong to the
  target repository lineage: same repo → the relevant existing checkout;
  external contribution → create/reuse the user's fork and work from a
  checkout/worktree of the target repository lineage — never continue from
  an unrelated checkout. The GLM draft described "adding a fork remote to
  the current checkout", which produces an incorrect Git topology when the
  current checkout is unrelated to the target repository.
- **Capability abstraction hardened.** Core SKILL.md files no longer name
  specific community providers/tools (`ci_diagnose`, `dsh-ci-doctor`, ...):
  use the most specific visible capability whose documented semantics cover
  the need; provider names and tool-name prefixes do not imply capability.
  A structure test enforces this.
- **Post-publish verification restored as a completion invariant.**
  `gh-publish` step 8 re-reads the created/updated PR and verifies
  target/base/head, changed-file scope, and available checks; a mismatch is
  reported instead of declaring success.
- **Low-level prompt plumbing removed from `gh-publish`.** Dropped the
  preflight output-field list, the porcelain `MM` tutorial, the `git add -A`
  accident wording, and the fork-remote / `gh` command tutorials; the
  numbered 9-step workflow is retained (scope → branch → commit → verify →
  push → PR → verify published result) with the semantics kept: scope from
  actual diff + task intent, task-owned staging, selective staging of mixed
  hunks, stop on ambiguity, tracked/fork remote, no force by default,
  existing-PR check, draft default, cross-repo semantics, no merge/delete
  by implication.
- **`whenToUse` omitted from all four skills (optional field).** The rc.6
  model-facing catalog renders `name` + `description` only; routing-critical
  information therefore lives in `description`. DSH SkillSummary still
  supports optional `whenToUse` metadata, so its absence here is a design
  choice, not a permanent schema requirement — and the structure test no
  longer asserts that it must be absent.
- **Optional GitHub MCP reference added.** `references/github-mcp.md`
  documents wiring GitHub's official MCP server into DSH
  (`@deepseek-ai/dsh-mcp-client`, stdio / streamable-http), env-only
  credentials, read-only/limited toolsets, the context cost of
  over-registered schemas, visibility verification, and semantics-based
  tool selection. README links to it briefly; no PAT/YAML/setup detail
  lives in the four SKILL.md files.

### Removed

- Inputs/prerequisites section from `gh-fix-ci` (inlined into the workflow).
- Remote write boundary table from `gh-address-comments` (replaced by one
  sentence).
- Connector-first responsibilities list and output expectations section
  from the umbrella (absorbed into the routing and triage sections).
- Provider/tool-name enumeration from all four SKILL.md bodies (capability
  selection is semantics-first).
- The `whenToUse`-absence structure assertion (absence is optional, not a
  schema requirement).

### Tests

- Structure tests now validate stable contracts instead of exact English
  phrases: descriptions parse and are meaningful; every description fits the
  project's resident budget (≤300 chars); the umbrella references all three
  specialists; the `gh-publish` description carries fork/external +
  publish/PR semantics; no SKILL.md hardcodes known community
  provider/tool names; helper references resolve; safety concepts remain
  present (task-owned staging, stop-on-ambiguity, draft default,
  report-only external CI, evidence-backed root cause, remote-write
  boundary).
- Added `references/routing-fixture.md`: six expected-routing examples
  (including two mixed requests). Static tests do not claim to prove LLM
  routing; the fixture documents how to run a real model-routing smoke as
  observational, non-deterministic evidence.

## [0.1.2] - 2026-08-15

### Changed

- Release workflow: `npm publish` now passes `--provenance`, attaching the
  SLSA provenance signature (v0.1.1 was published via the same OIDC path
  but without provenance; immutable published versions cannot be
  retro-signed, hence this patch).

## [0.1.1] - 2026-08-15

### Changed

- npm package metadata: description now reads "Skill-first GitHub workflows
  for DeepSeek Harness: PR triage, review feedback, CI diagnosis, and safe
  publishing."; keywords updated for discovery (`dsh-plugin` first, plus
  `dsh-skill`, `deepseek-harness`, `github`, `github-actions`,
  `code-review`, `agent-skills`, `developer-tools`, `git`).
- README (en/zh): added the language navigation links under the title
  (English ↔ 简体中文).
- README (en/zh): GitHub-source install wording is now permanent — prefer
  the npm package for normal installations; a commit-pinned GitHub source
  is for unreleased or auditable snapshots.
- Tests: `package.test.mjs` derives the expected packed version from the
  working tree instead of hard-coding `0.1.0`, so future version bumps no
  longer require test synchronization.
- Release housekeeping: GitHub repository About metadata (description,
  homepage → npm package page, topics incl. `dsh-plugin`) set via `gh repo
  edit`; not a repository file change.
- No functional changes; the release exercises the automated `v*` tag →
  validation → OIDC publish path for the first time.

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

### Fixed (final release review — host context & error boundary)

- **Host-aware target (high):** every helper now resolves and binds ONE
  explicit `{host, owner, repo}` target. `parsePrUrl` keeps the hostname;
  GraphQL uses `gh api graphql --hostname <host>`, checks/run use
  `-R [HOST/]OWNER/REPO` (gh 2.97 syntax), and the job-log API uses
  `gh api --hostname <host> /repos/...`. GHES is fully supported through the
  same path, with `gh auth status --hostname <host>` as the preflight;
  an unresolvable host (e.g. current-branch PR without a canonical URL)
  fails closed instead of silently falling back to another host.
- **Actions provider = path AND host (medium):** canonical
  `/actions/runs/<id>` is necessary but no longer sufficient: the
  details-URL host must equal the target host. `https://ci.example.com/
  actions/runs/123`, `https://evil.example/actions/runs/123`, and a
  github.com URL under a GHES target are all external and never touch
  `gh run`/job-log APIs.
- **Error-boundary redaction (medium):** helper internals stay raw;
  redaction moved to the output/error boundary — every `process.stdout` /
  `process.stderr` write and every diagnostic path sanitizes dynamic text.
  Invalid `--pr`, unknown flags, repo paths, and `--gh-bin` paths carrying
  token-like material can no longer surface raw secrets.
- README safety wording now matches `references/safety-model.md` (never
  actively extracts; redacts known shapes; untrusted content treated as
  untrusted) instead of over-claiming.
