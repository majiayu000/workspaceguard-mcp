# ADR 0001: TypeScript Node Runtime

**Status**: Proposed  
**Date**: 2026-06-20

## Context

WorkspaceGuard needs to expose a host-neutral MCP server for local coding
workspaces. It must support stdio and Streamable HTTP, define many JSON-schema
tools, run on macOS/Linux/Windows, and iterate quickly across ChatGPT, Claude,
Gemini, Grok, and custom MCP clients.

## Decision

Use TypeScript on Node.js 22 LTS for the initial implementation.

## Alternatives

### TypeScript / Node.js

Pros:

- Strong MCP SDK fit.
- Natural JSON schema and HTTP integration.
- Easy npm distribution and stdio usage.
- Fast iteration for host compatibility.

Cons:

- Runtime dependency on Node.
- Process and filesystem security requires discipline and tests.

Decision: chosen for v0.1.

### Rust

Pros:

- Strong single-binary story.
- Strong type and memory safety.
- Good for hardened filesystem/process boundaries.

Cons:

- More friction around MCP SDK maturity and host-specific examples.
- Slower iteration for early product shape.

Decision: defer until runtime hardening becomes the main bottleneck.

### Go

Pros:

- Single binary.
- Good process and HTTP primitives.
- Simple deployment.

Cons:

- JSON schema and MCP SDK ergonomics are less compelling for rapid iteration.
- Less aligned with ChatGPT Apps-style future UI work.

Decision: reject for v0.1.

## Consequences

- The package should publish an npm binary named `workspaceguard`.
- Security-sensitive helpers must be centralized and heavily tested.
- Shell command execution must use structured process APIs where possible.
- A later Rust or Go daemon can replace the runtime if v1 needs stronger
  isolation or simpler enterprise deployment.
