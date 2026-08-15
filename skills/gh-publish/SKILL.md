---
name: gh-publish
description: Publish local changes to GitHub as a pull request. Confirm scope, branch, stage only the intended files, commit, verify, push, and open a draft PR using existing DSH capabilities with gh/git fallbacks.
whenToUse: User explicitly asks to commit, push, open a PR, publish changes, "send these changes as a PR", or complete the local-to-GitHub publish flow.
---

# GitHub Publish Changes

Use this skill **only** when the user explicitly wants the full publish flow
from the local checkout: scope confirmation, branch setup if needed,
staging, commit, verification, push, and opening a pull request. This is the
only flow in the pack that performs remote writes by design — the publish
request itself is the explicit intent.

## Prerequisites

- `gh` installed and authenticated (`gh auth status`); ask the user to run
  `gh auth login` otherwise.
- A local git repository with a clear understanding of which changes belong
  in the PR.

## Strict order

1. **Resolve the git root.** `git rev-parse --show-toplevel`.
2. **Inspect the working tree.**
   - Run `git status --porcelain` and inspect the actual diff before
     staging anything.
   - Prefer the bundled read-only `scripts/publish-preflight.mjs` for
     deterministic scope evidence: git root, branch, detached state,
     default branch, origin/upstream, staged/unstaged/untracked files,
     diff stat, ahead/behind, and a `mixedWorktree` flag.
3. **Identify the intended scope.**
   - Which files belong to this task? If the tree is mixed, separate
     task-owned paths from unrelated user changes.
   - **Partially staged files** (same path staged AND unstaged, porcelain
     `MM`): the already-staged content is a scope candidate, but re-running
     `git add <file>` would sweep the user's unstaged hunks in too. Never
     blindly re-add such a file. Stage only what you can attribute to the
     task (e.g. `git add -p` for specific hunks); if the hunks cannot be
     reliably separated, stop before any remote publish and report the
     scope ambiguity.
   - **Untracked files** are not automatically irrelevant and not
     automatically in scope: include them only when they clearly belong to
     the task, and say so.
4. **Branch strategy.**
   - If already on a suitable feature branch, stay on it.
   - If on a default branch (main/master/...), create a new branch. Suggest
     `dsh/<short-description>` by default, but follow the repository's own
     branch conventions when it documents one. Do not force a fixed prefix.
5. **Stage only the intended changes.**
   - **Hard rule:** never default to `git add -A` on a mixed worktree.
   - Stage explicit paths that clearly belong to the task. If scope cannot
     be separated reliably, stop before any remote publish and report the
     scope ambiguity.
   - `git add -A` only when the whole worktree is confirmed in scope.
6. **Commit.**
   - Terse commit message derived from the actual diff and task intent.
   - Follow the target repository's conventions; do not force a language or
     a `[dsh]`/branded prefix.
   - Never bypass git hooks (`--no-verify` is off-limits).
7. **Verify.**
   - Run only the most relevant checks (test/typecheck/lint/build for the
     touched area). Do not globally install large toolchains just because a
     tool is missing; use the project's existing package workflow when one
     exists.
8. **Push.**
   - Push to the branch's **tracked remote** when one exists (preflight
     `upstream`, e.g. `origin/feature`), otherwise to `origin`. Never assume
     the remote is named `origin`; if no push remote can be resolved, stop
     and report the blocker.
   - `git push -u <remote> <current-branch>` — only after the user asked for
     the publish flow.
   - No `--force` unless the user explicitly requests it and you state the
     risk.
9. **Open a draft PR.**
   - **Check for an existing PR first:** `gh pr view --json number,url`.
     If the current branch already has a PR, do **not** create a second one
     — report it and continue on that PR (or ask the user whether to update
     it). Creating a duplicate PR is a remote write the user did not ask
     for.
   - Default to **draft** unless the user asked for a ready-for-review PR.
   - Prefer an existing DSH GitHub PR-create capability if visible
     (`gh_create_draft_pr`, `github_pr_create`, `pr_create`, ...).
   - Otherwise `gh pr create --draft --fill --head <current-branch>`.
   - Derive `head` from `git branch --show-current`; derive `base` from the
     user request or the remote default branch
     (`gh repo view --json defaultBranchRef`).
   - PR title/body: synthesize from user intent + actual diff + commit +
     repo PR template + linked issue. Real Markdown prose: what changed, why
     it changed, user/developer impact, root cause when it is a fix, and the
     checks used to validate it. Follow the target repo's conventions; no
     forced language or prefix. When using the `gh` CLI fallback, write the
     body to a temp file so real newlines survive the command line.
10. **Fork / cross-repo.**
    - Detect fork semantics early (preflight `origin` URL vs the target
      repo; `gh pr view --json isCrossRepository`). If the head repo differs
      from the target repo, do not assume a same-repo PR.
    - Push the branch to the fork remote (`git push -u <fork-remote>
      <branch>`), then create the PR against the target repo with
      `gh pr create --draft --head <fork-owner>:<branch> --repo
      <target-owner>/<target-repo>` (or a connector flow that supports
      cross-repo heads).
    - If fork semantics cannot be resolved reliably, **fail closed**: report
      the limitation instead of assuming same-repo.
11. **Summarize.**
    - Branch, commit SHA, PR target, validation run, and anything the user
      still needs to confirm.

## Write safety

- Never stage unrelated user changes silently.
- Never push without confirming scope when the worktree is mixed.
- Default to a draft PR.
- If the repository does not appear connected to an accessible GitHub
  remote, stop and explain the blocker.
- Merging and branch deletion are never part of this flow; they remain
  explicit user actions.
