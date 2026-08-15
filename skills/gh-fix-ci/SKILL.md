---
name: gh-fix-ci
description: Debug or fix failing GitHub Actions checks on a pull request. Diagnose failing checks and logs first, propose a root cause from real evidence, then apply a minimal local fix and verify.
whenToUse: User asks why CI failed, wants failing checks fixed, or asks to debug GitHub Actions runs for a PR or branch.
---

# GitHub Actions CI Fix

## Overview

Use this skill when the task is specifically about failing GitHub Actions
checks on a pull request.

- Existing DSH GitHub capabilities may provide PR metadata, changed files,
  and check-run state when visible.
- GitHub Actions **logs** are a `gh` workflow: use the bundled
  `scripts/inspect-pr-checks.mjs` (handles gh field drift and job-log
  fallbacks), or manual `gh pr checks` / `gh run view` / `gh api` steps.
- External CI providers (Buildkite, CircleCI, ...) are **report-only**:
  check name + URL + state. Never attempt to read their logs here.
- Root cause must cite real log/diff evidence. Never fabricate a failure
  reason from one error string.

## Inputs

- `--repo <path>` — path inside the target git repository (default `.`)
- `--pr <number-or-url>` — optional; defaults to the current branch PR
- authenticated `gh` for the repo host

## Workflow

1. **Verify `gh` auth.** Run `gh auth status` in the repo. If
   unauthenticated, ask the user to run `gh auth login` (repo + workflow
   scopes) before continuing.
2. **Resolve the PR.**
   - Use the given PR number/URL directly, else current branch PR via
     `gh pr view --json number,url`.
   - When repo and PR are known, fetch PR metadata and changed files through
     the best visible capability.
3. **Inspect failing checks (GitHub Actions only).**
   - Preferred: `node scripts/inspect-pr-checks.mjs --repo . --pr <n> --json`
     (relative to this skill's directory).
   - The script extracts, per failing check: provider (Actions vs
     external), run/job id, run metadata, log snippet/tail, and pending or
     unavailable log states. It only extracts facts; **you** decide the root
     cause.
   - If a visible DSH capability (e.g. `ci_diagnose` from dsh-ci-doctor)
     provides deeper structured CI diagnosis, prefer it for that part.
4. **Scope non-GitHub Actions checks.** If `detailsUrl` is not a GitHub
   Actions run, label it external and report only the URL. Do not attempt
   other providers.
5. **Summarize failures.**
   - Failing check name, run URL, and a concise log snippet.
   - Call out missing or pending logs explicitly. Do not over-claim.
6. **Fix mode (only when the user asked to fix).**
   - If the user said "fix the CI" / "fix the failing checks", apply the
     minimal change tied directly to the root cause — no re-asking for
     local edits.
   - Run the most relevant local verification available (test/typecheck/
     lint/build for the touched area).
   - If the failure is clearly unrelated to the local diff, say so before
     proposing code changes.
7. **Recheck what you can.** Re-run the check inspection for status changes.
8. **Report.**
   - failing check(s), evidence, root cause, changed files, local
     verification, and residual risk (unverified steps, flaky checks,
     external failures).

## Remote write boundary

| Action | Allowed without an explicit ask? |
|---|---|
| Edit local code (root-cause fix) | Yes, under "fix the CI" intent |
| Push | No |
| Re-run a workflow | No |
| Comment on the PR | No |

Pushing, re-running workflows, and commenting require explicit user
request or the host approval gate.
