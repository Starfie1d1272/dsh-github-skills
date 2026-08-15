# GitHub MCP Reference (optional)

GitHub's official [github-mcp-server](https://github.com/github/github-mcp-server)
is an **optional structured backend** for this pack. Nothing in this package
requires it: the four skills compose whatever GitHub/Git capabilities are
already visible in the session and fall back to `gh`/`git` when needed. This
reference explains how to make GitHub MCP tools visible to DSH when you want
them.

> This package does **NOT** auto-edit DSH profiles, does **NOT** configure
> MCP servers, and does **NOT** manage credentials. Wiring an MCP server is
> a profile configuration step you perform yourself (via the official `dsh
> plugin` tooling / profile file); this pack only consumes the tools that
> end up in the session's tool catalog.

## DSH MCP client (current supported transport)

DeepSeek Harness ships an MCP client bridge,
[`@deepseek-ai/dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client).
The reviewed baseline (`0.1.0-rc.6`) supports two transports: **`stdio`**
and **`streamable-http`**. Declare one plugin instance per MCP server in
the profile's `cordis.yml`:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: docker
    args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server']
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: !!js process.env.GITHUB_PAT
```

## GitHub MCP server

- Official repo: [github/github-mcp-server](https://github.com/github/github-mcp-server)
  (docs: `README.md`, `docs/server-configuration.md`, `docs/github-app-auth.md`).
- **Auth**: OAuth, or a GitHub Personal Access Token via the
  `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable (PAT takes
  precedence over OAuth).
- **Credentials come from environment / secrets only — never hard-code a
  token into a profile file.** `!!js process.env.<NAME>` keeps the secret in
  the environment. This package never reads tokens out of `gh` and never
  stores credentials (see `references/safety-model.md`).
- **Prefer read-only / limited toolsets where suitable**: `--read-only`
  exposes only read-only tools; `--toolsets repos,issues,pull_requests,...`
  (or `GITHUB_TOOLSETS`) limits the surface to what you need. The server
  docs note that enabling only needed toolsets "can help the LLM with tool
  choice and reduce the context size".
- **Avoid loading every GitHub MCP tool unnecessarily**: every registered
  MCP tool's schema is model-visible and costs context on every request
  while it is registered (DSH mcp-client docs: "Data-dependent schema cost
  is paid on every request while the tools are registered").

## Verifying visibility

After the profile boots with the MCP entry, the GitHub tools appear in the
session's tool catalog under server-qualified names
`mcp__github__<tool>` (e.g. `mcp__github__create_pull_request`). Verify by
checking that the running session's catalog actually lists the
`mcp__github__*` tools (e.g. via the session tool list, or `dsh --profile
<profile> --dump-config` showing the mcp row). Only tools the model can
actually observe are usable; a server that fails to connect registers
nothing.

## How the core skills use them

Core skills choose MCP tools by **documented semantics**, exactly like any
other visible capability: use the most specific visible tool whose
documented semantics cover the need. Provider names and tool-name prefixes
(including `mcp__*`) do not imply capability. MCP tools that mirror
`gh`/`git` surfaces are fine to use when visible and semantically
sufficient; otherwise the skills fall back to `gh`/`git` and this pack's
bundled helpers.
