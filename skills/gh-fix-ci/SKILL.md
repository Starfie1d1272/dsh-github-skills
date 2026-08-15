---
name: gh-fix-ci
description: Debug or fix failing GitHub Actions checks on a pull request: gather real check and log evidence, propose a root cause from that evidence, then apply a minimal local fix and verify. Use when the user asks why CI failed or wants failing checks fixed. External CI providers are report-only.
---

# GitHub Actions CI Fix

Use when the task is failing GitHub Actions checks on a pull request.
Session capabilities may provide PR metadata and changed files; Actions
**logs** are a `gh` workflow — use the bundled
`scripts/inspect-pr-checks.mjs` (handles gh field drift and job-log
fallbacks), or manual `gh pr checks` / `gh run view` steps. External CI
providers (Buildkite, CircleCI, ...) are report-only: check name + URL +
state, never their logs. The root cause must cite real log/diff evidence —
never fabricate a failure reason from one error string.

## Workflow

1. **Verify `gh` auth** in the repo (`gh auth status`; repo + workflow
   scopes). If unauthenticated, ask the user to run `gh auth login` before
   continuing.
2. **Resolve the PR.** Use the given number/URL, else the current branch
   via `gh pr view --json number,url`.
3. **Inspect failing checks (GitHub Actions only).**
   `node scripts/inspect-pr-checks.mjs --repo . --pr <n> --json` (relative
   to this skill's directory). Per failing check it extracts provider,
   run/job ids, run metadata, log snippet/tail, and pending or unavailable
   log states — facts only; **you** decide the root cause from them. If a
   visible session capability (e.g. `ci_diagnose`) offers deeper structured
   diagnosis, prefer it for that part.
4. **Summarize failures:** failing check name, run URL, concise log
   snippet; call out missing or pending logs explicitly. Do not over-claim.
5. **Fix mode (only when the user asked to fix).** Apply the minimal change
   tied directly to the root cause — no re-asking for local edits — run the
   most relevant local verification for the touched area, then re-check
   status. If the failure is clearly unrelated to the local diff, say so
   before proposing code changes.
6. **Report:** evidence, root cause, changed files, local verification,
   and residual risk (unverified steps, flaky checks, external failures).

## Remote write boundary

Local edits are allowed under "fix the CI" intent. Pushing, re-running a
workflow, and commenting on the PR require an explicit user request or the
host approval gate.
