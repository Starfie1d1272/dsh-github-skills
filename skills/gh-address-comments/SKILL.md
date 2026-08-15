---
name: gh-address-comments
description: Address GitHub pull request review feedback: inspect unresolved review threads and requested changes with thread-aware reads (resolved/outdated state, inline anchors), classify what is actionable, implement the selected fixes locally, and report. Use when the user wants to work through PR review comments, requested changes, or says "address the review".
---

# GitHub PR Comment Handler

Work through requested changes on a GitHub pull request. Thread-aware review
data is a `gh api graphql` problem unless a session capability genuinely
preserves `reviewThreads` state (resolved/outdated/anchors) — flat comment
surfaces never do.

If `gh` auth is missing or fails mid-run, check `gh auth status` and ask the
user to run `gh auth login`; report the blocker (missing scope, missing PR
context, CLI auth) instead of guessing a root cause.

## Workflow

1. **Resolve the PR.** Repo + PR number/URL from the user, or the current
   branch (local git context, then `gh pr view --json number,url`). Ask if
   still ambiguous.
2. **Fetch the complete review context.** Use a visible session capability
   for PR metadata and patch context when one exists. Use the bundled
   `scripts/fetch-review-threads.mjs` whenever the task depends on
   unresolved threads, inline locations, or resolution state. Keep three
   layers distinct:
   - **conversation comments** (top-level issue comments),
   - **reviews** (APPROVED / CHANGES_REQUESTED / COMMENTED submissions),
   - **reviewThreads** (inline threads with `isResolved` / `isOutdated` and
     file/line anchors).
   A thread reported with `commentsTruncated: true` is not complete. Never
   collapse threads into flat comments or claim thread state from a flat
   read.
3. **Classify every thread:** actionable (asks for a concrete change),
   informational, approval, already resolved (`isResolved`), outdated
   (`isOutdated`), duplicate, or ambiguous.
4. **Cluster actionable threads** by file or behavior area; keep each change
   traceable to the thread or cluster it addresses.
5. **Implement.**
   - "Address the review" / "fix the review comments" authorizes local edits
     for every unresolved actionable thread — do not mechanically re-ask.
   - Analysis-only requests ("look at the review") get analysis only.
   - A comment asking for an explanation gets a drafted response, not a
     forced code change.
   - If threads conflict or a change would cause a regression, surface the
     tradeoff before editing.
6. **Verify** with the most relevant checks for the touched area
   (test/typecheck/lint/build). Never claim verification you did not run.
7. **Report** addressed threads (with file/line), intentionally unaddressed
   and why, ambiguous items, checks run, and remaining risk.

## Remote write boundary

Local edits are not GitHub writes. Unless the user explicitly asked to
reply, resolve threads, submit a review, push, or update the PR, do none of
those — stop at the local result.
