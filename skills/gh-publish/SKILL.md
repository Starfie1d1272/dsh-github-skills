---
name: gh-publish
description: Publish changes to GitHub as a pull request: confirm scope, branch, stage, commit, verify, push, and open a draft PR. Covers same-repository changes and fork-based contributions to external repositories (fork creation, fork remote, cross-repo PR). Use whenever the task ends in a commit, push, or opened PR, including contributing to a repository you do not control.
---

# GitHub Publish Changes

Use when the task is to get changes onto GitHub as a pull request — in the
current repository or as a fork-based contribution to a repository you do
not control. This is the only flow in the pack that performs remote writes
by design: the publish request itself is the explicit intent.

Prerequisites: `gh` installed and authenticated (`gh auth status`; ask the
user to run `gh auth login` otherwise), and a local git repository — for an
external target, see step 1 for fork setup.

## Workflow

1. **Resolve the target.** Same-repo publish targets the current checkout's
   remote. A fork contribution needs your fork as a remote: if none exists
   yet, create the fork (`gh repo fork <upstream-repo>`) and use the fork
   remote it sets up (or `git remote add fork <fork-url>`). If fork
   semantics cannot be resolved reliably (whose fork, which target repo),
   **fail closed**: report the ambiguity instead of assuming a same-repo PR.
2. **Inspect the working tree.** `git status --porcelain` plus the actual
   diff before staging anything. Prefer the bundled read-only
   `scripts/publish-preflight.mjs` for deterministic scope evidence (git
   root, branch, remotes, staged/unstaged/untracked files, partially staged
   files, diff stat, ahead/behind). Its signals flag *that* the tree needs
   inspection; scope is always judged from the actual diff and task intent.
3. **Identify the intended scope.** Which files belong to this task?
   Untracked files are neither auto-included nor auto-excluded. **Never
   default to `git add -A` on a mixed worktree** — stage explicit paths, or
   `git add -p` for specific hunks. Never blindly re-add a partially staged
   file (porcelain `MM`): that would sweep the user's unstaged hunks in. If
   task-owned changes cannot be reliably separated from unrelated user
   changes, stop before any remote write and report the scope ambiguity.
4. **Branch.** Stay on a suitable feature branch; from a default branch
   (main/master/...) create one — `dsh/<short-description>` unless the
   repository documents its own convention.
5. **Stage and commit.** Stage only the intended changes; commit with a
   terse message derived from the actual diff and task intent, following
   the repository's conventions. Never bypass git hooks (`--no-verify` is
   off-limits).
6. **Verify.** Run only the most relevant checks for the touched area
   (test/typecheck/lint/build); do not globally install large toolchains
   just because a tool is missing.
7. **Push.** Push to the branch's tracked remote when one exists,
   otherwise the resolved target remote — never assume the remote is named
   `origin`; if no push remote resolves, stop and report the blocker. A
   fork contribution pushes the branch to the fork remote
   (`git push -u <fork-remote> <branch>`). No `--force` unless the user
   explicitly requested it and the risk is stated.
8. **Open a draft PR.** Draft unless the user asked for a
   ready-for-review PR.
   - **Check for an existing PR first** (`gh pr view --json number,url`).
     If the branch already has a PR, do **not** create a second one —
     report it and continue on that PR.
   - Prefer a visible session PR-create capability when one matches;
     otherwise `gh pr create --draft --fill --head <current-branch>`, and
     for a fork `--head <fork-owner>:<branch> --repo <target-owner>/<repo>`.
     Write the PR body to a temp file so real newlines survive the command
     line.
   - Derive `base` from the user request or the remote default branch
     (`gh repo view --json defaultBranchRef`). Body: real Markdown prose —
     what changed, why, user/developer impact, root cause when it is a fix,
     and the checks used to validate it.
9. **Summarize.** Branch, commit SHA, PR target, validation run, and
   anything the user still needs to confirm.

## Write safety

- Never stage unrelated user changes silently; never push a mixed worktree
  with unconfirmed scope.
- Default to a draft PR.
- Merging and branch deletion are never part of this flow; they remain
  explicit user actions.
- If no accessible GitHub remote can be resolved, stop and explain the
  blocker.
