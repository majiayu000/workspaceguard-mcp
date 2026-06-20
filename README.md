# WorkspaceGuard

Structured workspace runtime for long-running coding agents.

WorkspaceGuard exposes a real local development workspace through MCP while
adding the missing operational layer: task state, snapshots, checkpoints, drift
detection, verification evidence, audit logs, and structured handoff.

It is host-neutral by design. ChatGPT, Claude, Gemini, Grok, and custom MCP
clients should all use the same core tool contracts.

## What This Is

WorkspaceGuard is not a coding model and not a hidden local agent. The MCP host
does the reasoning. WorkspaceGuard provides controlled workspace capabilities:

- open an allowed workspace
- read, search, edit, and write files
- run terminal commands under policy
- inspect git status and diffs
- create snapshots and checkpoints
- detect workspace drift
- run verification and store evidence
- hand off task state across hosts or sessions

## Design Docs

- [Product spec](docs/workspaceguard-mcp-spec.md)
- [Implementation design](docs/implementation-design.md)
- [Host profiles](docs/host-profiles.md)
- [ADR 0001: TypeScript Node runtime](docs/adr/0001-typescript-node-runtime.md)

## Recommended Build Path

Implemented in the current skeleton:

- MCP server over stdio and Streamable HTTP
- split MCP tool registration modules
- workspace allowlist and instruction loading
- canonical path containment with symlink escape tests
- file read/search/list/write/edit tools
- structured shell runner with timeout and redaction
- git status/diff helpers
- in-memory task runtime tools
- file-manifest snapshots
- checkpoint and drift MCP tools
- verification command execution and freshness checks
- append-only JSONL audit log
- failed MCP tool-call audit events
- required bearer-token and Origin helper for remote HTTP
- OAuth-dev protected resource metadata and PKCE authorization-code flow
- secure HTTP proxy for tunnel/public entrypoints
- shared runtime context across HTTP sessions
- MCP integration test using the SDK in-memory transport

Next build path:

1. Add SQLite-backed state instead of in-memory registries.
2. Replace OAuth-dev with production OAuth issuer integration.
3. Add before/after audit envelopes for every tool call.
4. Verify against ChatGPT, Claude, Gemini, and Grok host profiles.

## Development

```bash
npm install
npm test
npm run build
npx tsc --noEmit
```

Remote HTTP security knobs:

```bash
WORKSPACEGUARD_TOKEN=long-random-token
WORKSPACEGUARD_ALLOWED_ORIGINS=https://chatgpt.com,https://example.com
```

`WORKSPACEGUARD_TOKEN` or `--bearer-token` is required when `--transport http`
is used.

ChatGPT developer-mode HTTP can use the built-in OAuth-dev profile:

```bash
WORKSPACEGUARD_OAUTH_APPROVAL_CODE=local-human-code \
workspaceguard serve \
  --transport http \
  --auth-mode oauth-dev \
  --public-base-url https://your-tunnel.example.com \
  --allowed-roots ~/work
```

Or keep WorkspaceGuard private on localhost and expose a separate proxy:

```bash
WORKSPACEGUARD_TOKEN=inner-local-token \
workspaceguard serve --transport http --allowed-roots ~/work

WORKSPACEGUARD_PROXY_TARGET_TOKEN=inner-local-token \
WORKSPACEGUARD_OAUTH_APPROVAL_CODE=local-human-code \
workspaceguard proxy \
  --target-url http://127.0.0.1:8787/mcp \
  --auth-mode oauth-dev \
  --public-base-url https://your-tunnel.example.com
```

`oauth-dev` is for single-user developer-mode testing. Production deployments
should replace it with a real OAuth issuer and durable token storage.

## Security Baseline

WorkspaceGuard exposes local machine capabilities. It must default to narrow
filesystem roots, localhost binding, explicit remote authentication, canonical
path checks, command policy, redacted logs, and auditable tool calls.

Shell and worktrees are workflow boundaries, not security sandboxes.
