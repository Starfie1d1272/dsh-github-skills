---
name: gh-publish
description: Publish task-scoped changes to GitHub through a branch/commit/push/PR flow, including fork-based external contributions. Use when the user wants changes pushed or a PR opened; draft PR is the default.
---

# GitHub Publish

Remote publication is this skill's primary purpose, so the user's
requested publish scope defines which remote steps are authorized: push
task-scoped changes and, when requested, open a pull request. Pushing
does not imply opening a PR. Fork-based external contributions follow the
same flow from a checkout of the target repository lineage.

Branching and committing are internal steps here, not entry points: use
this skill when the user wants changes pushed or a PR opened.

## Workflow

1. **Resolve target checkout.** Same repository → the relevant existing
   checkout. External contribution → create or reuse the user's fork, and
   work from a checkout/worktree that belongs to the target repository
   lineage — never continue from an unrelated checkout. Ambiguous target,
   fork, or base → stop and report.
2. **Confirm scope.** Inspect the actual status and diff; use
   `scripts/publish-preflight.mjs` when useful. Stage only task-owned
   changes. Mixed task/unrelated hunks → stage selectively. If scope
   cannot be separated reliably, stop before publishing.
3. **Branch.** Keep a suitable existing feature branch, or create a task
   branch from the intended base following the repository's convention.
4. **Commit.** Confirmed scope only; concise message derived from the
   actual diff and task intent. Do not bypass hooks.
5. **Verify.** Run only the relevant existing checks for the touched
   area.
6. **Push.** Push to the appropriate tracked or fork remote; never assume
   `origin`. No force push unless explicitly requested, with the risk
   stated. If the user's requested publish scope ends at push, verify the
   pushed branch, report the result, and stop — do not open a PR.
7. **Open PR, when requested.** Check for an existing PR first. Use
   correct target/base/head and fork semantics. Draft is the default
   unless the user explicitly wants ready-for-review. Prefer a suitable
   visible PR-create capability; `gh` fallback. Body from the actual
   diff, template, and validation.
8. **Verify published result.** Verify the remote branch after push.
   When a PR was opened or updated, also re-read it and verify
   target/base/head, changed-file scope, and available checks. If the
   published state differs from the intended scope, report it — do not
   declare success.
9. **Report.** Branch, commit, PR (when applicable), validation/check
   state, and any uncertainty.

## Safety

- Never publish unrelated or ambiguous changes.
- Opening a PR requires its own intent; pushing alone never creates one.
- Merging and branch deletion require separate explicit intent.
