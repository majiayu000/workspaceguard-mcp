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

Minimum server settings:

```bash
WORKSPACEGUARD_BIND_HOST=127.0.0.1
WORKSPACEGUARD_PORT=8787
WORKSPACEGUARD_PUBLIC_BASE_URL=https://your-tunnel.example.com
WORKSPACEGUARD_ALLOWED_ROOTS=$HOME/work
WORKSPACEGUARD_REMOTE_AUTH=oauth
```

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
| ChatGPT | Streamable HTTP | OAuth/bearer | workspace open, edit, show diff |
| Grok | Streamable HTTP or SSE adapter | bearer header | read-only tools first |
