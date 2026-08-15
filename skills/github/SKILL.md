---
name: github
description: General GitHub triage for repositories, issues, and pull requests: inspect or summarize state and handle scoped metadata actions. Use when no review-feedback, CI, or publish specialist clearly matches.
---

# GitHub

General entrypoint for GitHub triage. Resolve context, classify the request,
and route specialist work early. Do not re-implement specialist workflows
here.

## Capability policy

Use the most specific visible capability whose documented semantics cover
the need. Provider names and tool-name prefixes do not imply capability.
Use local git for local checkout facts; use `gh` only where no suitable
structured capability covers the operation. Never assume an unavailable
capability exists.

## Routing

- general repository / issue / PR triage → stay here
- review feedback → `gh-address-comments`
- failing GitHub Actions → `gh-fix-ci`
- branch / commit / push / PR publication, including fork contribution
  → `gh-publish`

When a specialist matches, load it with `skill()` and let it own the
workflow.

Mixed requests may require multiple specialists. Complete review or CI
domain work before publishing; `gh-publish` does not replace those
workflows.

## Triage

1. **Resolve context.** Repo, PR/issue number, or URL given by the user
   wins; for "this branch" / "the current PR", resolve the local git
   context first. Ask if still ambiguous.
2. **Gather** the state relevant to the request (issue/PR metadata,
   comments, checks) from visible capabilities or `gh`.
3. **Classify** and handle here, or load the matching specialist and let
   it own the workflow.
4. **Report** the state and the next action.

Scoped metadata actions (labels, reactions, issue edits) may be applied
here only when explicitly requested; everything else routes.

## Boundaries

- Flat comments are not review-thread state (see `gh-address-comments`).
- No CI-log claim without actual logs (see `gh-fix-ci`).
- Remote writes need explicit user intent or the host approval boundary.

## Examples

- "Summarize the open PRs in this repo." → stay here
- "Address the review comments on PR 482." → `gh-address-comments`
- "Why is CI failing on this branch?" → `gh-fix-ci`
- "Fork awesome-foo, update its README, and open a PR." → `gh-publish`
