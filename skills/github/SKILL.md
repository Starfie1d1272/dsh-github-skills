---
name: github
description: Triage and orient GitHub repository, pull request, and issue work using whatever GitHub capabilities are already available in this session. Use for general GitHub help, PR or issue summaries, or repository context before choosing a more specific workflow.
whenToUse: User asks to look at a PR, an issue, a repository, or "what is happening on GitHub"; or needs general GitHub triage before a specialist review, CI, or publish workflow.
---

# GitHub

## Overview

This is the umbrella entrypoint for GitHub work in this skill pack. Its only
jobs are to **resolve context**, **classify intent**, and **route
immediately** to a specialist skill. It does not re-implement the specialist
workflows.

This pack is intentionally hybrid and capability-agnostic:

- Use whatever GitHub capabilities are **already visible in this session's
  tool catalog** for structured repository / issue / PR data. Detected
  providers may include `dsh-github-workflow` (`gh_get_repo_context`,
  `gh_analyze_issue`, `gh_create_draft_pr`, ...), `dsh-github`
  (`pr_create`, `gh_review`, `issue_comment`, ...), or
  `dsh-github-connector` (`github_search`, `github_pr_read`, ...).
- Use local `git` and `gh` only for the gaps those capabilities do not
  cover: current-branch PR discovery, branch/commit/push, `gh auth status`,
  review-thread state via GraphQL, and GitHub Actions log inspection.
- Never pretend a capability exists. Only call a tool whose name is actually
  in your current catalog. If none matches, fall back to `gh`/`git`.
- **Tool-name collisions across providers:** the `gh_*` prefix appears in
  more than one provider (e.g. `dsh-github-workflow` and `dsh-github`), and
  their tools are not interchangeable. Match on the **exact full tool name
  plus its parameter signature and description**, and pick the tool whose
  documented capability matches the current need. A same-prefix name from
  another provider is not a reason to call it.
- Keep connector state and the local checkout aligned: if the request is
  about the current branch, resolve the local repo and branch first.

## Routing Rules

1. **Resolve the operating context first.**
   - If the user gave a repository, PR number, issue number, or URL, use it.
   - If the request is about "this branch" / "the current PR", resolve local
     git context (`git rev-parse --show-toplevel`, `git branch
     --show-current`) and use `gh pr view --json number,url` only to
     discover the branch PR.
   - If the repository is still ambiguous after local inspection, ask for
     the repo identifier. Do not invent a repo-search flow.
2. **Classify the request before acting.**
   - `repo or PR triage` — summarize PRs, issues, patches, comments,
     labels, reactions, or repository state. Handle here.
   - `review follow-up` — unresolved review threads, requested changes, or
     inline review feedback. **Route to `gh-address-comments` immediately.**
   - `CI debugging` — failing checks, Actions logs, CI root-cause analysis.
     **Route to `gh-fix-ci` immediately.**
   - `publish changes` — branch, stage, commit, push, open a PR.
     **Route to `gh-publish` immediately.**
3. **Keep the hybrid model consistent after routing.**
   - Existing DSH GitHub capabilities first for PR/issue data.
   - Local `git` and `gh` only for the specific gaps they cover best.

## General Triage Workflow

1. Resolve repository and item scope (repo / PR / issue / local branch).
2. Gather structured context through the best visible capability, or `gh`
   when no suitable tool exists.
3. Decide whether the task stays in triage or becomes a specialist workflow.
4. If it becomes review follow-up, CI debugging, or publish, route to the
   specialist skill and stop duplicating its work here.
5. End with a clear summary: what was inspected, what is certain, what is
   still unknown.

## Output Expectations

- For triage requests, return a concise summary of the repository, PR, or
  issue state and the next likely action.
- For mixed requests, state which specialist path you are taking and why.
- For write actions, restate the exact PR, issue, label, or reaction target
  before applying the change (writes still require explicit user intent or
  the host approval gate).
- Never imply that GitHub Actions logs are available through a capability
  that cannot read them. Log inspection stays a `gh` workflow (see
  `gh-fix-ci`).
- Never treat flat comments as complete review-thread state (see
  `gh-address-comments`).

## Examples

- "Use GitHub to summarize the open PRs in this repo and tell me what needs attention."
- "Help with this PR."
- "Review the latest comments on PR 482 and tell me what is actionable." → route to `gh-address-comments`
- "Debug the failing checks on this branch." → route to `gh-fix-ci`
- "Commit these changes, push them, and open a draft PR." → route to `gh-publish`
