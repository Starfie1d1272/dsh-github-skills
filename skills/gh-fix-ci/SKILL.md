---
name: gh-fix-ci
description: Diagnose or fix failing GitHub Actions checks from real check and log evidence. Use when the user asks why CI failed or wants failing checks fixed; non-Actions CI is report-only.
---

# GitHub Actions CI Fix

Diagnose or fix failing GitHub Actions checks from real check and log
evidence.

## Evidence

- Establish the root cause only from real check state, logs, and diff
  evidence; never fabricate a failure reason from a single error string.
- Use a visible capability for PR metadata and checks when it is
  semantically sufficient; use a capability that exposes actual logs when
  available; otherwise use `scripts/inspect-pr-checks.mjs` or `gh`.
- Non-Actions CI is report-only: check name + URL + state, never their
  logs.
- Missing, pending, or inconclusive logs are uncertainty — report them as
  such, do not guess.

## Workflow

1. **Resolve the PR** (given number/URL, or current branch via local git
   context; ask if still ambiguous).
2. **Gather failing-check evidence** (see Evidence) and summarize failures
   with run URLs and log snippets.
3. **Diagnose-only requests** get a root cause and explanation only.
4. **Fix mode** (only when the user asked to fix): apply the minimal local
   change tied directly to the root cause, run the most relevant local
   verification, then recheck the status. If the failure is clearly
   unrelated to the local diff, say so before proposing code changes.
5. **Report**: evidence, root cause, changed files, verification run, and
   residual risk.

## Remote write boundary

Local edits are allowed under "fix the CI" intent. Pushing, re-running a
workflow, and commenting on the PR require explicit user request or the
host approval boundary.
