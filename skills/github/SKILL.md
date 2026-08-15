---
name: github
description: Triage and orient GitHub repository, pull request, and issue work, then route to a specialist workflow. Use for general GitHub help, PR or issue summaries, or repository context before a specialist takes over. Unresolved review feedback routes to gh-address-comments; failing checks route to gh-fix-ci; any task that ends in a branch, commit, push, or opened PR — including a fork-based contribution to a repository you do not control — routes to gh-publish.
---

# GitHub

Umbrella entrypoint for GitHub work in this skill pack. Its only jobs are to
resolve context, classify the request, and route immediately to a specialist
(load it with the `skill` tool). It does not run a specialist workflow itself.

This pack is capability-agnostic: for structured repository / issue / PR
data, use whatever GitHub capabilities are already visible in this session's
tool catalog; use local `git` and `gh` for what they cover best
(current-branch PR discovery, branch/commit/push, review-thread GraphQL,
Actions logs). Never assume a capability exists: call only tools that are
actually in the catalog, matched by their full name and documented
capability, and fall back to `gh`/`git` otherwise. Keep session state and
the local checkout aligned — "this branch" or "the current PR" means
resolving the local repo and branch first.

## Routing

1. **Resolve the operating context first.** A repository, PR/issue number,
   or URL given by the user wins. For "this branch" / "the current PR",
   resolve local git context and `gh pr view --json number,url`. If the
   repository is still ambiguous after local inspection, ask for the repo
   identifier; never invent a repo-search flow.
2. **Classify, then act.**
   - `repo or PR triage` — summarize PRs, issues, patches, comments,
     labels, reactions, or repository state. Handle here.
   - `review follow-up` — unresolved review threads, requested changes,
     inline review feedback. Route to `gh-address-comments`.
   - `CI debugging` — failing checks, Actions logs, CI root-cause analysis.
     Route to `gh-fix-ci`.
   - `publish changes` — anything that ends in a branch, commit, push, or
     opened PR, in this repository or as a fork contribution to another
     repository. Route to `gh-publish`.
3. **Mixed requests** follow their widest specialist path; state which path
   you took and why.

## Triage output

- Concise summary of the repository / PR / issue state and the next likely
  action.
- For write actions, restate the exact PR, issue, label, or reaction target
  before applying it; writes still need explicit user intent or the host
  approval gate.
- Actions logs are a `gh` workflow (see `gh-fix-ci`); flat comments are not
  review-thread state (see `gh-address-comments`). Never imply otherwise.

## Examples

- "Summarize the open PRs in this repo and tell me what needs attention."
- "Help with this PR."
- "Address the review comments on PR 482." → `gh-address-comments`
- "Why is CI failing on this branch?" → `gh-fix-ci`
- "Fork awesome-foo, update its README, and open a PR." → `gh-publish`
