import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorkspaceGuardServer } from "../../src/mcp/server.js";

test("MCP server exposes core tools and opens a workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspaceguard-mcp-"));
  const project = join(root, "project");
  await mkdir(project);
  const canonicalProject = await realpath(project);

  const server = createWorkspaceGuardServer({
    transport: "stdio",
    host: "127.0.0.1",
    port: 8787,
    allowedRoots: [root],
    stateDir: join(root, ".state"),
  });
  const client = new Client({ name: "workspaceguard-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();

    assert.ok(toolNames.includes("workspace_open"));
    assert.ok(toolNames.includes("file_read"));
    assert.ok(toolNames.includes("shell_run"));
    assert.ok(toolNames.includes("git_diff"));

    const openResult = await client.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });

    assert.equal(openResult.isError, undefined);
    const structured = openResult.structuredContent as
      | { workspaceId?: unknown; root?: unknown }
      | undefined;
    assert.match(String(structured?.workspaceId), /^ws_/);
    assert.equal(structured?.root, canonicalProject);
  } finally {
    await client.close();
    await server.close();
  }
});
