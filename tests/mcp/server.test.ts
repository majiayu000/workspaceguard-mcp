import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorkspaceGuardServer } from "../../src/mcp/server.js";
import { createToolContext } from "../../src/mcp/tool-context.js";

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
    allowedOrigins: [],
    stateDir: join(root, ".state"),
  });
  const client = new Client({ name: "workspaceguard-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();

    const expectedToolNames = [
      "checkpoint_create",
      "directory_list",
      "drift_check",
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

    const checkpointResult = await client.callTool({
      name: "checkpoint_create",
      arguments: {
        workspaceId,
        snapshotId: String(snapshot?.snapshotId),
        label: "MCP integration checkpoint",
        taskId: String(task?.taskId),
        reason: "test checkpoint",
      },
    });
    assert.equal(checkpointResult.isError, undefined);
    const checkpoint = checkpointResult.structuredContent as
      | { checkpointId?: unknown; snapshotId?: unknown; taskId?: unknown; label?: unknown }
      | undefined;
    assert.match(String(checkpoint?.checkpointId), /^checkpoint_/);
    assert.equal(checkpoint?.snapshotId, snapshot?.snapshotId);
    assert.equal(checkpoint?.taskId, task?.taskId);
    assert.equal(checkpoint?.label, "MCP integration checkpoint");

    const initialDriftResult = await client.callTool({
      name: "drift_check",
      arguments: { workspaceId, baselineReason: "mcp baseline" },
    });
    assert.equal(initialDriftResult.isError, undefined);
    const initialDrift = initialDriftResult.structuredContent as
      | { baselineSnapshotId?: unknown; currentSnapshotId?: unknown; changed?: unknown; added?: unknown[] }
      | undefined;
    assert.equal(initialDrift?.baselineSnapshotId, undefined);
    assert.match(String(initialDrift?.currentSnapshotId), /^snapshot_/);
    assert.equal(initialDrift?.changed, false);
    assert.deepEqual(initialDrift?.added, []);

    const writeResult = await client.callTool({
      name: "file_write",
      arguments: { workspaceId, path: "notes.txt", content: "tracked drift\n" },
    });
    assert.equal(writeResult.isError, undefined);

    const changedDriftResult = await client.callTool({
      name: "drift_check",
      arguments: { workspaceId, currentReason: "after file_write" },
    });
    assert.equal(changedDriftResult.isError, undefined);
    const changedDrift = changedDriftResult.structuredContent as
      | {
          baselineSnapshotId?: unknown;
          currentSnapshotId?: unknown;
          changed?: unknown;
          added?: Array<{ path?: unknown }>;
          modified?: unknown[];
          deleted?: unknown[];
        }
      | undefined;
    assert.match(String(changedDrift?.baselineSnapshotId), /^snapshot_/);
    assert.match(String(changedDrift?.currentSnapshotId), /^snapshot_/);
    assert.equal(changedDrift?.changed, true);
    assert.deepEqual(
      changedDrift?.added?.map((entry) => entry.path),
      ["notes.txt"],
    );
    assert.deepEqual(changedDrift?.modified, []);
    assert.deepEqual(changedDrift?.deleted, []);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP servers can share runtime context across sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspaceguard-shared-context-"));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "README.md"), "shared context\n", "utf8");

  const config = {
    transport: "stdio" as const,
    host: "127.0.0.1",
    port: 8787,
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir: join(root, ".state"),
  };
  const context = createToolContext(config);
  const serverA = createWorkspaceGuardServer(config, context);
  const serverB = createWorkspaceGuardServer(config, context);
  const clientA = new Client({ name: "workspaceguard-test-a", version: "0.0.0" });
  const clientB = new Client({ name: "workspaceguard-test-b", version: "0.0.0" });
  const [clientTransportA, serverTransportA] = InMemoryTransport.createLinkedPair();
  const [clientTransportB, serverTransportB] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    serverA.connect(serverTransportA),
    clientA.connect(clientTransportA),
    serverB.connect(serverTransportB),
    clientB.connect(clientTransportB),
  ]);

  try {
    const openResult = await clientA.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });
    assert.equal(openResult.isError, undefined);
    const opened = openResult.structuredContent as
      | { workspaceId?: unknown; root?: unknown }
      | undefined;
    const workspaceId = String(opened?.workspaceId);
    assert.match(workspaceId, /^ws_/);

    const statusResult = await clientB.callTool({
      name: "workspace_status",
      arguments: { workspaceId },
    });
    assert.equal(statusResult.isError, undefined);
    const status = statusResult.structuredContent as
      | { workspace?: { workspaceId?: unknown; root?: unknown } }
      | undefined;

    assert.equal(status?.workspace?.workspaceId, workspaceId);
    assert.equal(status?.workspace?.root, await realpath(project));
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.close();
    await serverB.close();
  }
});

test("MCP failed tool calls append audit events", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspaceguard-mcp-audit-"));
  const project = join(root, "project");
  const stateDir = join(root, ".state");
  await mkdir(project);
  await writeFile(join(project, "existing.txt"), "original\n", "utf8");

  const server = createWorkspaceGuardServer({
    transport: "stdio",
    host: "127.0.0.1",
    port: 8787,
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir,
  });
  const client = new Client({ name: "workspaceguard-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const openResult = await client.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });
    assert.equal(openResult.isError, undefined);
    const opened = openResult.structuredContent as { workspaceId?: unknown } | undefined;
    const workspaceId = String(opened?.workspaceId);

    const fileWriteResult = await client.callTool({
      name: "file_write",
      arguments: {
        workspaceId,
        path: "existing.txt",
        content: "secret-content-that-must-not-be-audited",
        overwrite: false,
      },
    });
    assert.equal(fileWriteResult.isError, true);

    const shellRunResult = await client.callTool({
      name: "shell_run",
      arguments: {
        workspaceId,
        command: "node",
        args: ["secret-arg-that-must-not-be-audited"],
        workingDirectory: "missing-directory",
      },
    });
    assert.equal(shellRunResult.isError, true);

    const auditEvents = (await readFile(join(stateDir, "audit.jsonl"), "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const failedFileWrite = auditEvents.find(
      (event) => event.tool === "file_write" && event.status === "failed",
    );
    assert.equal(failedFileWrite?.workspaceId, workspaceId);
    assert.equal(failedFileWrite?.path, "existing.txt");
    assert.equal(typeof failedFileWrite?.at, "string");
    assert.match(String(failedFileWrite?.error), /File already exists/);
    assert.ok(!JSON.stringify(failedFileWrite).includes("secret-content-that-must-not-be-audited"));

    const failedShellRun = auditEvents.find(
      (event) => event.tool === "shell_run" && event.status === "failed",
    );
    assert.equal(failedShellRun?.workspaceId, workspaceId);
    assert.equal(failedShellRun?.command, "node");
    assert.equal(typeof failedShellRun?.at, "string");
    assert.match(String(failedShellRun?.error), /does not exist/);
    assert.ok(!JSON.stringify(failedShellRun).includes("secret-arg-that-must-not-be-audited"));
  } finally {
    await client.close();
    await server.close();
  }
});
