# Third-Party Notices

This project is licensed under the Apache License, Version 2.0 (see
[LICENSE](LICENSE)). Some content is adapted from, or designed after, the
official OpenAI Codex GitHub plugin. This file documents that provenance as
required by the Apache License, Version 2.0, Section 4.

## OpenAI Codex GitHub plugin

| Item | Value |
|---|---|
| Upstream repository | https://github.com/openai/plugins |
| Source path | `plugins/github/` |
| Upstream commit (reference) | `4c2b32e42cf50cea9599bb8a167c1db759e6ce40` (2026-06-23) |
| Local installed reference | `~/.codex/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/` |
| License of specialist skills | Apache-2.0 (per-directory `LICENSE.txt` in `skills/gh-address-comments`, `skills/gh-fix-ci`, `skills/yeet`) |
| Plugin manifest license field | MIT (plugin-level metadata; the repository ships no root license file) |

### Adapted / reimplemented files in this project

| This project | Upstream counterpart | Relationship |
|---|---|---|
| `skills/gh-address-comments/SKILL.md` | `plugins/github/skills/gh-address-comments/SKILL.md` | Adapted structure and guardrails (Apache-2.0 attribution applies) |
| `skills/gh-address-comments/scripts/fetch-review-threads.mjs` | `plugins/github/skills/gh-address-comments/scripts/fetch_comments.py` | Independent Node reimplementation of the GraphQL thread-fetch behavior; not a byte-level translation |
| `skills/gh-fix-ci/SKILL.md` | `plugins/github/skills/gh-fix-ci/SKILL.md` | Adapted structure and guardrails (Apache-2.0 attribution applies) |
| `skills/gh-fix-ci/scripts/inspect-pr-checks.mjs` | `plugins/github/skills/gh-fix-ci/scripts/inspect_pr_checks.py` | Independent Node reimplementation (gh field-drift fallback, job-log fallback, bounded snippets) |
| `skills/gh-publish/SKILL.md` | `plugins/github/skills/yeet/SKILL.md` | Adapted safety structure; renamed `yeet` → `gh-publish`; branch/commit conventions intentionally differ (`dsh/` suggestion vs `agent/`/`codex/`) |
| `skills/gh-publish/scripts/publish-preflight.mjs` | — (no upstream counterpart) | New read-only scope-evidence helper, this project's own work |
| `skills/github/SKILL.md` | `plugins/github/skills/github/SKILL.md` | Design-informed reimplementation of the umbrella-router concept; no per-file upstream license exists, so this is an independent implementation |

The upstream umbrella `github` skill carries no per-directory license file;
only the plugin manifest declares MIT. The `github` skill in this project is
therefore an independent implementation informed by the upstream *design*
(router pattern), not a copy.

## Design-informed references (no code copied)

The following DSH ecosystem projects were studied for capability-boundary
analysis only. No code or license text from them is included in this
package. They are listed as compatibility/reference projects:

| Project | License (per GitHub API) |
|---|---|
| PerryLink/dsh-github | Apache-2.0 |
| kaziii/dsh-github-connector | MIT |
| ZariaEcho/dsh-github-workflow | MIT |
| jkrandom-sudo/dsh-ci-doctor | MIT |
| lonelymoon87/dsh-gitflow | MIT |
| BrambleXu/dsh-revdiff | MIT |
| Lixiaoyiao/deepseek-harness-action | MIT |

## Notices

- This project is not affiliated with, or endorsed by, OpenAI or any of the
  projects listed above.
- The `yeet` skill name is not used; the publish workflow ships as
  `gh-publish`.
- All helper scripts in this project are original Node.js implementations
  and are covered by this project's Apache-2.0 license, with upstream
  attribution as documented above.

For the full provenance and the list of intentionally changed behaviors, see
[references/upstream-notes.md](references/upstream-notes.md).
