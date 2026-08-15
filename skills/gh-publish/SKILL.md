---
name: gh-publish
description: Publish task-scoped changes to GitHub as a pull request, including fork-based external contributions. Use for branch, commit, push, or PR workflows; draft PR is the default.
---

# GitHub Publish

Publish task-scoped changes to GitHub as a pull request, including
fork-based external contributions. This is the only flow in the pack that
performs remote writes by design: the publish request itself is the
explicit intent.

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
   stated.
7. **Open PR.** Check for an existing PR first. Use correct
   target/base/head and fork semantics. Draft is the default unless the
   user explicitly wants ready-for-review. Prefer a suitable visible
   PR-create capability; `gh` fallback. Body from the actual diff,
   template, and validation.
8. **Verify published result.** Re-read the PR and verify target/base/
   head, changed-file scope, and available checks. If the published state
   differs from the intended scope, report it — do not declare success.
9. **Report.** Branch, commit, PR, validation/check state, and any
   uncertainty.

## Safety

- Never publish unrelated or ambiguous changes.
- Merging and branch deletion require separate explicit intent.
