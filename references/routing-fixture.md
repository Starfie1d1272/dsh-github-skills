# Routing Fixture (v0.2.0)

Observational routing guidance for the four skills in this pack. These
examples document the **intended** routing contract for the model-facing
catalog (which renders `name` + `description` only). They are **not
deterministic unit tests**: LLM routing is non-deterministic and depends on
the live catalog, session context, and model. Static tests in this
repository never claim to prove routing.

| # | User request | Expected routing |
|---|---|---|
| 1 | "看看这个 PR 现在什么状态" / "What's the state of this PR?" | `github` |
| 2 | "把这些 review comments 修掉" / "Address the review comments" | `gh-address-comments` |
| 3 | "为什么 GitHub Actions 挂了" / "Why did GitHub Actions fail?" | `gh-fix-ci` |
| 4 | "fork 外部仓库改 README 然后开 PR" / "Fork an external repo, change its README, open a PR" | `gh-publish` |
| 5 | "修完 review 然后 push" / "Fix the review, then push" | `gh-address-comments` + `gh-publish` |
| 6 | "修 CI 后提交 PR" / "Fix CI, then open a PR" | `gh-fix-ci` + `gh-publish` |
| 7 | "把这个 branch push 上去就行，先别开 PR" / "Push this branch, don't open a PR" | `gh-publish` (push, then stop — no PR) |

## Mixed requests

Cases 5 and 6 are mixed requests: more than one specialist may be required.
Complete review or CI domain work before publishing; `gh-publish` does not
replace those workflows. The umbrella may load multiple specialists for a
single request.

## Running a real routing smoke

If a live DSH session with a real model is available, run the fixture as a
model-routing smoke: issue each request and record which skill the model
loads via `skill()`. Treat the results as **observational,
non-deterministic evidence** — never as a pass/fail unit test. A useful
acceptance heuristic: the majority of runs pick the expected specialist(s);
misses are reviewed against the descriptions (which carry the routing
signals), not "fixed" by re-pinning exact phrases in tests.
