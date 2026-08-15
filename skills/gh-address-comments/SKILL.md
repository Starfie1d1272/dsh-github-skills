---
name: gh-address-comments
description: Inspect or address GitHub pull request review feedback using thread-aware state. Use for requested changes, unresolved inline review threads, or review comments; fixing feedback authorizes local edits, not GitHub writes.
---

# GitHub PR Review Feedback

Work through requested changes on a GitHub pull request using thread-aware
review state.

## Evidence

- Flat comments are not thread-aware review state (resolved/outdated/
  inline-anchor semantics). Never collapse threads into flat comments.
- Use a visible structured-metadata capability when suitable; use a
  thread-aware capability only if it genuinely preserves resolved/outdated/
  inline-anchor semantics; otherwise use
  `scripts/fetch-review-threads.mjs`.
- Keep conversation comments, reviews, and review threads distinct.
- Incomplete or truncated evidence (`commentsTruncated`) must be reported,
  never presented as a complete view.

## Workflow

1. **Resolve the PR** (given repo + number/URL, or current branch via
   local git context; ask if still ambiguous).
2. **Fetch the complete review context** (see Evidence), then classify
   each thread: actionable, informational, already resolved/outdated, or
   ambiguous.
3. **Cluster actionable threads** by file or behavior area; keep each
   change traceable to the thread or cluster it addresses.
4. **Decide intent.** Analysis-only ("look at the review") gets analysis
   only. Address/fix intent ("address the review") authorizes local edits
   for unresolved actionable threads without mechanically re-asking.
5. **Surface conflicts, ambiguity, or regression risk** before editing.
6. **Verify** with the most relevant local checks for the touched area;
   never claim verification you did not run.
7. **Report** addressed threads (file/line), intentionally unaddressed
   items and why, checks run, and remaining risk.

## Remote write boundary

Local edits are not GitHub writes. Reply, resolve threads, submit a review,
push, or update the PR only on explicit user request or the host approval
boundary. If `gh` auth is missing or fails, report the blocker instead of
guessing.
