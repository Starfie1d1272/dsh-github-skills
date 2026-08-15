# Safety Model

This document is normative for every skill and script in this package. The
hard rules below are not suggestions; a skill that violates one is broken.

## HARD RULES

### 1. Credentials never leak

GitHub credentials (tokens, PATs, `gh` session material) must never be
written into:

- skill output / model-visible text
- logs
- temp files
- PR bodies
- commits
- error messages

Helper scripts print **stable JSON on stdout** and diagnostics only on
stderr. Any output that could contain a credential is a bug.

### 2. No token extraction

Do not call `gh auth token` to lift a token out of `gh`. Normal runtime never
needs the raw token: reuse the DSH GitHub provider's credential handling or
`gh`'s own authenticated session. A token-extraction call is acceptable only
if some unavoidable compatibility verification explicitly requires it, and
even then it must not reach output.

### 3. Reuse existing credential handling

- DSH GitHub providers own their credential handling; prefer them.
- `gh` owns its own auth; prefer `gh auth status` over re-auth flows.
- This package stores no credentials and implements no OAuth / PAT / device
  flow.

### 4. Remote mutations require explicit intent or an approval gate

Remote mutation includes, but is not limited to:

- commenting / replying
- resolving a review thread
- requesting reviewers
- creating a PR
- pushing
- re-running a workflow
- merging
- closing an issue

Each of these must come from **explicit user intent** or pass through an
existing DSH approval gate. Nothing in this package auto-approves.

### 5. Analysis requests never become writes

| User says | Local edits? | Remote writes? |
|---|---|---|
| "看看 PR review / what does the review say" | No | No |
| "为什么 CI 挂了 / why did CI fail" | No | No |
| "帮我处理 review / address the review" | Yes (unresolved actionable threads) | No, unless the request explicitly includes reply/resolve/push |
| "修掉 CI / fix the failing checks" | Yes (root-cause-related, minimal) | No (push/rerun/comment need separate explicit ask) |
| "发个 PR / publish these changes" | Yes | Yes — this is the explicit publish intent |

"Address the review" authorizes local code changes to all unresolved
actionable threads **without re-asking**, but it does **not** authorize
replying on GitHub, resolving threads, pushing, or any other remote write.

### 6. Never bypass git hooks

Commits created by these workflows run through the repository's own hooks.
Do not use `--no-verify` to dodge hooks.

### 7. No force push by default

`--force` / `--force-with-lease` pushes happen only when the user explicitly
requests them, and the workflow must state the risk (history rewrite,
remote divergence) before doing it.

### 8. No default merge

These workflows do not merge PRs. Merging is always an explicit user action.

### 9. No branch deletion

These workflows never delete branches automatically.

### 10. Fallbacks must be capability-equivalent, never safety-reducing

A fallback replaces one capability with another that can do the same job; it
never silently drops an approval boundary, expands write scope, or leaks
state. If the only fallback would weaken safety, stop and report the blocker
instead.

## Local git safety

- **Mixed worktree rule**: never default to `git add -A`. Stage only paths
  that clearly belong to the current task; if the working tree is mixed and
  scope cannot be reliably separated, stop before any remote publish and
  report the scope ambiguity.
- `publish-preflight.mjs` is strictly read-only. It must not run `git add`,
  `git commit`, `git push`, `git reset`, `git stash`, `git checkout`, or
  `git switch`. Its purpose is turning scope confirmation into deterministic
  evidence.
- Branch strategy honors repository conventions; no hard-coded prefix.
- Commit messages follow the target repository's conventions; no forced
  language.

## Remote write boundaries per skill

| Skill | Remote writes it may perform | Condition |
|---|---|---|
| `github` (umbrella) | none by itself | routes to specialists instead |
| `gh-address-comments` | reply / resolve thread / submit review / push / update PR | explicit user request for that write |
| `gh-fix-ci` | push / rerun workflow / comment | explicit user request or host approval |
| `gh-publish` | commit / push / create draft PR | the explicit publish intent |

## Reporting obligations

Every workflow must end by stating:

- what was resolved/confirmed (repo, PR, branch, item)
- what is **known** vs **inferred** vs **unavailable**
- what was changed (locally and/or remotely)
- what was intentionally not changed and why
- remaining risk (flaky checks, external CI, unverified steps)

## Test obligations

The test suite must prove at least:

- read-only workflows perform no remote mutation (no gh/git write commands
  invoked);
- `publish-preflight.mjs` performs zero writes;
- a fake token never appears in stdout/stderr;
- a mixed worktree never triggers `git add -A`;
- helper argv never passes through a shell string (no shell interpolation);
- external CI checks are never treated as GitHub Actions logs.
