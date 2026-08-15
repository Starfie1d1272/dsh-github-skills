---
name: gh-address-comments
description: Address actionable GitHub pull request review feedback. Use when the user wants to inspect unresolved review threads, requested changes, or inline review comments on a PR, then implement selected fixes locally.
whenToUse: User asks about PR review feedback, requested changes, inline comments, or says "address the review" or "fix the review comments".
---

# GitHub PR Comment Handler

Use this skill when the user wants to work through requested changes on a
GitHub pull request. Treat thread-aware review data as a `gh api graphql`
problem unless a visible DSH capability genuinely preserves
`reviewThreads` state (resolved/outdated/anchors). Flat comment surfaces
never contain the full review-thread state.

All `gh` commands run through the normal tool boundary (no shell string
interpolation, argv only). If CLI auth is missing, run `gh auth status`
and ask the user to authenticate with `gh auth login` if it fails.

## Workflow

1. **Resolve the PR.**
   - Repo + PR number/URL from the user: use directly.
   - "Current branch PR": resolve local git context, then
     `gh pr view --json number,url,headRepositoryOwner,headRepository`.
   - If still ambiguous, ask for the repo or PR identifier.

2. **Fetch the complete review context.**
   - Use a visible DSH GitHub capability for PR metadata and patch context
     when it exists.
   - Use the bundled `scripts/fetch-review-threads.mjs` whenever the task
     depends on unresolved threads, inline review locations, or resolution
     state. It fetches `reviewThreads`, `isResolved`, `isOutdated`, and
     file/line/diffSide anchors via authenticated `gh api graphql`.
   - Keep the three layers distinct:
     - **conversation comments** (top-level issue comments on the PR),
     - **reviews** (submissions: APPROVED / CHANGES_REQUESTED / COMMENTED),
     - **reviewThreads** (inline threads, each with its own comments).
   - Never collapse threads into flat comments and never claim thread state
     from a flat read.

3. **Classify every thread.**
   - `actionable` — asks for a concrete change.
   - `informational` — question or note; no code change required.
   - `approval` — approving review, not a request.
   - `already resolved` — `isResolved: true`.
   - `outdated` — `isOutdated: true` (comment on old code).
   - `duplicate` — same feedback elsewhere.
   - `ambiguous` — cannot tell what is wanted.

4. **Cluster actionable threads.**
   - Group by file or behavior area.
   - Keep each change traceable to the thread or cluster it addresses.

5. **Implement.**
   - If the user said "address all the review" / "fix the review
     comments", that is authorization to modify local code for every
     unresolved actionable thread. Do not mechanically re-ask "may I start".
   - If the user only asked to look at the review, analyze only — no edits.
   - If a comment asks for an explanation rather than code, draft the
     response instead of forcing a code change.
   - If threads conflict or a change would cause a regression, surface the
     tradeoff before editing.

6. **Verify.**
   - Run the most relevant checks for the changed code
     (test/typecheck/lint/build that matches the touched area).
   - Never claim verification you did not run.

7. **Report.**
   - `addressed` threads (with file/line), `intentionally not addressed`
     and why, `ambiguous` items, tests/checks run, and remaining risk.
   - Local modifications are **not** GitHub writes: unless the user
     explicitly asked to reply, resolve threads, submit a review, push, or
     update the PR, do none of those. Stop at the local result.

## Remote write boundary

| Action | Allowed without an explicit ask? |
|---|---|
| Edit local code | Yes, for actionable threads under "address the review" |
| Reply / comment on GitHub | No |
| Resolve a review thread | No |
| Submit a review | No |
| Push / update PR | No |

If `gh` hits auth or rate-limit issues mid-run, report the blocker
(missing scope / missing PR context / CLI auth) and ask for the missing
identifier or a refreshed `gh auth login`; do not guess a root cause.
