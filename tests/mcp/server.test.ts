import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
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
  await writeFile(join(project, "README.md"), "hello workspaceguard\n", "utf8");
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

    const expectedToolNames = [
      "directory_list",
      "echo",
      "file_edit",
      "file_read",
      "file_write",
      "git_diff",
      "git_status",
      "policy_describe",
      "search_text",
      "shell_run",
      "snapshot_create",
      "task_start",
      "task_status",
      "task_update",
      "verification_run",
      "workspace_open",
      "workspace_status",
      "workspaceguard_info",
    ];
    for (const toolName of expectedToolNames) {
      assert.ok(toolNames.includes(toolName), `missing ${toolName}`);
    }

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

    const workspaceId = String(structured?.workspaceId);
    const taskResult = await client.callTool({
      name: "task_start",
      arguments: { workspaceId, objective: "Test MCP task runtime" },
    });
    assert.equal(taskResult.isError, undefined);
    const task = taskResult.structuredContent as { taskId?: unknown } | undefined;
    assert.match(String(task?.taskId), /^task_/);

    const snapshotResult = await client.callTool({
      name: "snapshot_create",
      arguments: { workspaceId, reason: "mcp integration" },
    });
    assert.equal(snapshotResult.isError, undefined);
    const snapshot = snapshotResult.structuredContent as
      | { snapshotId?: unknown; files?: unknown }
      | undefined;
    assert.match(String(snapshot?.snapshotId), /^snapshot_/);
    assert.ok(Array.isArray(snapshot?.files));
  } finally {
    await client.close();
    await server.close();
  }
});
