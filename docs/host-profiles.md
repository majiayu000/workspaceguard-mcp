# WorkspaceGuard Host Profiles

**Status**: Draft  
**Created**: 2026-06-20

WorkspaceGuard should work through standard MCP tools, not host-specific
features. This document tracks the connection profiles we need to verify.

## Shared Requirements

- Tool list must be deterministic.
- Tool names use snake_case.
- Tool outputs include plain text plus structured JSON.
- Core workflows must not require iframe widgets.
- Remote HTTP profiles require authentication.
- The MCP server must be reachable by the host. Local-only clients can use
  stdio; remote products usually need HTTPS through a tunnel or deployed relay.

## Claude / Local Stdio

Use this for trusted local development.

```json
{
  "mcpServers": {
    "workspaceguard": {
      "command": "workspaceguard",
      "args": ["serve", "--transport", "stdio"]
    }
  }
}
```

## Gemini CLI / Stdio

Gemini CLI supports command-based MCP servers. Recommended for local private
workspaces.

```json
{
  "mcpServers": {
    "workspaceguard": {
      "command": "workspaceguard",
      "args": ["serve", "--transport", "stdio"],
      "trust": true
    }
  }
}
```

## Gemini CLI / Streamable HTTP

Use when testing the remote HTTP path.

```json
{
  "mcpServers": {
    "workspaceguard": {
      "httpUrl": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${WORKSPACEGUARD_TOKEN}"
      },
      "timeout": 30000
    }
  }
}
```

## ChatGPT / Remote HTTP

Use Streamable HTTP behind a public HTTPS URL.

```text
https://your-tunnel.example.com/mcp
```

Option A: expose WorkspaceGuard directly with OAuth-dev for single-user
developer-mode testing.

```bash
WORKSPACEGUARD_OAUTH_APPROVAL_CODE=local-human-code \
workspaceguard serve \
  --transport http \
  --auth-mode oauth-dev \
  --public-base-url https://your-tunnel.example.com \
  --allowed-roots $HOME/work
```

Option B: keep WorkspaceGuard private on localhost and expose only the proxy.

```bash
WORKSPACEGUARD_TOKEN=inner-local-token \
workspaceguard serve \
  --transport http \
  --host 127.0.0.1 \
  --port 8787 \
  --allowed-roots $HOME/work

WORKSPACEGUARD_PROXY_TARGET_TOKEN=inner-local-token \
WORKSPACEGUARD_OAUTH_APPROVAL_CODE=local-human-code \
workspaceguard proxy \
  --target-url http://127.0.0.1:8787/mcp \
  --auth-mode oauth-dev \
  --public-base-url https://your-tunnel.example.com
```

In ChatGPT developer mode, create a connector with the public `/mcp` URL. The
OAuth-dev authorization page asks for the local approval code before issuing an
in-memory bearer token. This is not a production identity provider.

## Grok / Remote MCP

Grok remote MCP tools require a public server URL and support optional
authorization headers.

```json
{
  "server_url": "https://your-tunnel.example.com/mcp",
  "server_label": "workspaceguard",
  "server_description": "Structured local workspace runtime",
  "authorization": "Bearer ${WORKSPACEGUARD_TOKEN}",
  "allowed_tools": [
    "workspace_open",
    "workspace_status",
    "file_read",
    "search_text",
    "git_diff",
    "verification_status"
  ]
}
```

For early Grok testing, prefer a read-only policy profile until write and shell
approvals are verified end to end.

## Compatibility Matrix

| Host | Transport | Auth | v0.1 Test |
| --- | --- | --- | --- |
| Claude local | stdio | environment/config | open workspace, read file, run status |
| Gemini CLI local | stdio | trust local config | open workspace, search, edit fixture |
| Gemini CLI HTTP | Streamable HTTP | bearer header | tool list, read, verification |
| ChatGPT | Streamable HTTP | OAuth-dev or proxy | metadata, token, workspace open |
| Grok | Streamable HTTP or SSE adapter | bearer header | read-only tools first |
