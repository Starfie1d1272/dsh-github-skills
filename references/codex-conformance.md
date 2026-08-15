# Codex GitHub Upstream Conformance

Maintainer-facing record of how this pack maps onto the OpenAI Codex GitHub
plugin, produced by the final conformance audit. The goal is **workflow
semantics**, not copy-identical text. Any future change to a skill should be
checked against this matrix so intentional differences are not accidentally
"fixed" back toward Codex, and genuine gaps are not introduced silently.

## Baselines (pinned at audit time)

| Baseline | Identity |
|---|---|
| Local installed Codex GitHub plugin | `~/.codex/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/` (cache mtime 2026-07-10) |
| Public upstream commit | `openai/plugins@4c2b32e42cf50cea9599bb8a167c1db759e6ce40` (2026-06-23; latest commit touching `plugins/github` at audit time) |
| Local vs public file diff | identical for `github/SKILL.md`, `gh-address-comments/*`, `gh-fix-ci/*`; **only `yeet/SKILL.md` differs** (local: branch `agent/{desc}`, PR title `{desc}`; public: branch `codex/{desc}`, PR title `[codex] {desc}`) — branding only, no workflow-semantic change |

The public plugin declares a GitHub MCP server (`.mcp.json`,
`bearer_token_env_var: GITHUB_PAT_TOKEN`) that the local 0.1.8 install does
not carry; neither is relevant to DSH (see Intentional omissions).

## Behavior matrices

Verdict legend: `equivalent` · `equivalent via DSH capability` ·
`intentionally different` · `intentionally omitted` · `GAP`.

### 1. `github` umbrella

| Behavior | Codex local/public | dsh-github-skills | Verdict |
|---|---|---|---|
| Resolve operating context first | yes | yes | equivalent |
| Identify repo / PR / issue / local branch | yes | yes | equivalent |
| Classify: triage / review / CI / publish | yes | yes | equivalent |
| Route immediately once intent is clear | yes | yes | equivalent |
| Umbrella does not duplicate specialist workflows | yes | yes | equivalent |
| Structured GitHub capability first | connector app first | best visible DSH GitHub tool first | equivalent via DSH capability |
| Align connector state with local checkout | yes | yes | equivalent |
| Never pretend a capability exists | ask for repo, don't invent search | catalog detection, no invented tool names | equivalent |
| Final output: inspected / state / next | yes | yes | equivalent |
| Tool-name collisions across providers | n/a (single connector) | match exact full name + signature + description (`gh_*` shared by ZariaEcho/PerryLink) | DSH-specific addition |

### 2. `gh-address-comments`

| Behavior | Codex | dsh-github-skills | Verdict |
|---|---|---|---|
| Explicit repo + PR | yes | yes | equivalent |
| PR URL | yes | yes | equivalent |
| Current-branch PR | head repo via `headRepositoryOwner/headRepository` | PR canonical URL → **target repo** | intentionally different (see fork PR note) |
| Fork / cross-repo PR | "works by reading head repo" — queries head repo | queries the repo that owns the PR (target) | intentionally different (corrected upstream bug) |
| Three layers: conversation comments / reviews / reviewThreads | yes | yes | equivalent |
| Thread fields: isResolved, isOutdated, path, line, diffSide, startLine, startDiffSide, originalLine, originalStartLine, resolvedBy, comments, pagination | yes | yes | equivalent |
| Only unresolved actionable feedback is acted on | yes | yes | equivalent |
| Explicit thread classification | not hard-coded | 7 classes (actionable/informational/approval/resolved/outdated/duplicate/ambiguous) | DSH-specific addition |
| "Address the review" authorizes local edits | yes | yes, without mechanical re-asking | equivalent |
| Remote writes (reply/resolve/submit review/push) need explicit ask | yes | yes | equivalent |
| Comment asking for explanation → draft response, not forced code change | yes | yes | equivalent |

**Fork PR note (high-priority audit item).** Codex `fetch_comments.py`
resolves the current-branch PR from `headRepositoryOwner/headRepository`
and queries `repository(owner, name) { pullRequest(number) }` with it. For a
fork PR the PR object — including its reviewThreads — lives in the
**target** repository, not the fork head; querying the head repo can return
`null` or, worse, an unrelated PR with the same number. `gh` 2.97 exposes no
`baseRepository` JSON field, but the canonical PR `url` always identifies
the target repo. `fetch-review-threads.mjs` therefore prefers the URL and
falls back to the head repo only for same-repository PRs. This is an
intentional correction of upstream behavior.

### 3. `gh-fix-ci` / `inspect-pr-checks`

| Robustness behavior | Codex (`inspect_pr_checks.py`) | dsh (`inspect-pr-checks.mjs`) | Verdict |
|---|---|---|---|
| gh availability / auth check | yes | yes | equivalent |
| Current PR resolution | `gh pr view --json number` | same | equivalent |
| Explicit PR | yes | yes | equivalent |
| `gh pr checks` JSON field drift fallback | "Available fields" retry | same | equivalent |
| conclusion / state / bucket normalization | failure/cancelled/timed_out/action_required; fail bucket | same sets | equivalent |
| Actions run id extraction | `/actions/runs/(\d+)`, `/runs/(\d+)` | same | equivalent |
| Job id extraction | `/actions/runs/\d+/job/(\d+)`, `/job/(\d+)` | same | equivalent |
| External provider detection | no run id → external, report-only | same; never calls run/log APIs | equivalent |
| Run metadata | `gh run view --json …` | same fields | equivalent |
| Run log retrieval | `gh run view <id> --log` | same | equivalent |
| Pending logs | marker detection ("still in progress", "log will be available…") | same | equivalent |
| Job-log fallback | `gh api /repos/…/jobs/<id>/logs` when run log pending | same | equivalent |
| Zip payload handling | detects `PK` → reports error, no fake success | same | equivalent |
| Failure marker selection | scan from end for error/fail/traceback/… | same markers | equivalent |
| Bounded context snippet | marker ± context, capped at max-lines | same | equivalent |
| Log tail | last max-lines | same | equivalent |
| Malformed JSON handling | explicit error | same | equivalent |
| Exit code semantics | 0 no failures, 1 failures remain | same, plus 2 for blocked/usage | equivalent / intentionally different (DSH adds 2) |
| Workflow: summary → plan → approval → implement | approval before any fix | local fix allowed when the user explicitly says "fix the CI"; diagnosis-only never edits; push/rerun/comment still need explicit intent | intentional UX adaptation |

### 4. `yeet` ↔ `gh-publish`

| Behavior | Codex (yeet local/public) | dsh-github-skills | Verdict |
|---|---|---|---|
| Inspect `git status` first | yes | yes (+ preflight) | equivalent via DSH capability |
| Inspect diff before staging | yes | yes (+ numstat) | equivalent |
| Mixed-worktree detection | ask which files | deterministic `mixedWorktree` flag | equivalent via DSH capability |
| Never default `git add -A` on mixed tree | yes | yes (hard rule) | equivalent |
| Branch strategy | `agent/` (local) / `codex/` (public) prefix | follow repo conventions; `dsh/<desc>` only when none | intentionally different |
| Explicit-file staging | yes | yes, plus **partially staged (`MM`) rule**: never blindly re-`git add` a file with unstaged hunks; `git add -p` or report ambiguity | equivalent + DSH addition |
| Untracked files | — | neither auto-included nor auto-excluded; judged against task scope | DSH addition |
| Commit | terse message | terse, repo conventions, hooks respected | equivalent |
| Relevant checks | yes | yes, minimal scope | equivalent |
| Push | `git push -u origin` | **tracked remote first (preflight `upstream`), never assume `origin`** | intentionally different |
| Draft PR default | yes | yes | equivalent |
| **Existing PR on branch** | not handled | **check `gh pr view` first; never create a duplicate PR** | DSH addition (closes gap) |
| Repo / head / base resolution | connector + `gh repo view` | preflight + `gh repo view --json defaultBranchRef` | equivalent via DSH capability |
| Fork / cross-repo | `gh pr create` fallback | push to fork remote, `gh pr create --head <fork>:<branch> --repo <target>`, **fail closed** when unclear | intentionally different / equivalent |
| PR body real Markdown + newlines | emphasized, temp file | emphasized; temp file for CLI fallback | equivalent |
| Final evidence summary | yes | yes | equivalent |
| `codex/` branch / `[codex]` PR title branding | local yeet drops it; public keeps it | never adopted | intentionally omitted |

## Intentional omissions from Codex

| Codex artifact | Why DSH should not copy it |
|---|---|
| OpenAI App connector metadata (`.app.json`) | binds to Codex's connector runtime; DSH has no single connector |
| GitHub MCP declaration (`.mcp.json`, `GITHUB_PAT_TOKEN`) | Codex API-key-session mechanism; DSH auth flows through `gh`/DSH providers |
| Codex agent UI metadata (`agents/openai.yaml`, interface fields) | Codex-specific presentation surface |
| `codex/` branch naming + `[codex]` PR title prefix | branding; this pack follows target-repo conventions |
| Python helpers | DSH guarantees Node; zero-dependency `.mjs` preferred |
| Resident prompt injection | this pack is progressive disclosure; catalog = name + description only |

## DSH-specific additions

- Multi-provider capability matrix (`references/capability-matrix.md`)
- dsh-ci-doctor (`ci_diagnose`) as preferred CI primitive when visible
- dsh-gitflow tools as the git fallback layer
- DSH approval model: remote writes need explicit intent or the host gate
- `ctx.skills` bundle shim (`lib/index.js`) with lazy bodies and directory
  resourceBase
- `publish-preflight.mjs` deterministic scope evidence
- Fork-PR target-repo resolution correction (see above)
- Explicit 7-class thread classification
- Partially-staged (`MM`) staging rules, existing-PR detection, non-origin
  remote handling

## GAP ledger (audit outcome)

All gaps found in this audit were closed in the same audit:

| Severity | Gap | Fix |
|---|---|---|
| high | fork-PR current-branch resolution queried the head repo for reviewThreads | resolve target repo from the PR canonical URL (helper + fork tests) |
| medium | partially staged files had no staging rule | SKILL rule (never blindly re-`git add` an `MM` file) + preflight `MM` test + static assertion |
| medium | existing PR on branch would be blindly re-created | SKILL rule (check `gh pr view`, never duplicate) + static assertion |
| medium | push hard-coded `origin` | SKILL rule (tracked remote first, fail closed) + static assertion |
| low | fork publish lacked push-to-fork-remote guidance | SKILL rule (`git push -u <fork-remote>` + `--head <fork>:<branch> --repo <target>`, fail closed) + static assertion |
| low | multi-provider tool-name collisions under-specified | umbrella wording (exact full name + signature + description) |
| low | CLI-fallback PR body newline handling not stated | SKILL rule (temp file preserves newlines) |

Remaining known differences are all intentional (matrices above). No
critical or high gaps remain.

## Post-conformance adversarial hardening

The conformance audit proves workflow-semantic parity; the adversarial
hardening pass fixed issues that are NOT Codex-conformance gaps — they are
either upstream-equivalent behavior with boundary bugs, DSH-specific helper
bugs, security hardening, or release engineering. They are tracked here so
they are not re-labeled as conformance regressions later:

| Category | Issue | Fix |
|---|---|---|
| security | credential-bearing https remote URL leaked to stdout | `lib/redact.mjs` applied to every helper output path (URL userinfo + token shapes) |
| security | pasted tokens in remote content (comments, CI logs) and gh/git stderr | same redaction with stable placeholders; safety-model wording corrected |
| helper bug | unequal pagination re-appended finished collections | per-collection independent paginators with own cursors |
| helper bug | thread comments >100 silently truncated | explicit `commentsTruncated` + `commentsPageInfo` |
| helper bug | generic `/runs/<id>` misdetected as Actions | strict `/actions/runs/<id>` detection (github.com + GHES) |
| helper bug | run/job queries bound to implicit cwd repo | explicit `-R <owner/repo>` target context everywhere |
| helper semantics | `mixedWorktree` too narrow | objective class signals + redefined conservative flag |
| mock quality | fake returned pages by call count | protocol-aware fake (cursor matching, `-R` verification, fail loud) |
| release eng | no CI, npm-install README overstated | `.github/workflows/ci.yml` (Node 22.19/24), truthful install sections, metadata, `prepublishOnly` |

## Maintaining conformance

- Re-pin the baselines when a new audit runs; record the public commit SHA,
  not "main".
- Before editing a SKILL.md or helper, check the corresponding matrix row:
  preserve the verdict unless the change is itself a deliberate,
  documented divergence.
- New DSH-specific additions belong in this file's addition list, not
  silently in code.
