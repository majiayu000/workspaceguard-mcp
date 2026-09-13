import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { pkceS256 } from "../../src/auth/oauth-dev-provider.js";
import { createHttpApp, createWorkspaceGuardServer } from "../../src/mcp/server.js";
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
    authMode: "bearer",
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir: join(root, ".state"),
    oauthScopes: ["workspace:read", "workspace:write", "workspace:shell"],
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

    const gitStatusTool = tools.tools.find((tool) => tool.name === "git_status");
    const gitDiffTool = tools.tools.find((tool) => tool.name === "git_diff");
    assert.match(String(gitStatusTool?.description), /ordinary Git semantics/);
    assert.doesNotMatch(String(gitStatusTool?.description), /fsmonitor/);
    assert.match(String(gitDiffTool?.description), /ordinary Git semantics/);
    assert.doesNotMatch(String(gitDiffTool?.description), /no-ext-diff|no-textconv|fsmonitor/);

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
    authMode: "bearer" as const,
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir: join(root, ".state"),
    oauthScopes: ["workspace:read", "workspace:write", "workspace:shell"],
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
    authMode: "bearer",
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir,
    oauthScopes: ["workspace:read", "workspace:write", "workspace:shell"],
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

test("HTTP OAuth dev routes expose metadata and issue bearer tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspaceguard-oauth-http-"));
  const app = createHttpApp({
    transport: "http",
    host: "127.0.0.1",
    port: 0,
    authMode: "oauth-dev",
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir: join(root, ".state"),
    publicBaseUrl: "https://workspaceguard.example",
    oauthApprovalCode: "approve-local",
    oauthScopes: ["workspace:read", "workspace:write"],
  });
  const server = await listenApp(app);
  const verifier = "test-verifier";

  try {
    const metadataResponse = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    assert.equal(metadataResponse.status, 200);
    const metadata = (await metadataResponse.json()) as Record<string, unknown>;
    assert.equal(metadata.resource, "https://workspaceguard.example");
    assert.deepEqual(metadata.authorization_servers, ["https://workspaceguard.example"]);

    const unauthorizedResponse = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unauthorizedResponse.status, 401);
    assert.match(
      String(unauthorizedResponse.headers.get("www-authenticate")),
      /oauth-protected-resource/,
    );

    const authorizeUrl = new URL(`${server.url}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", "https://chatgpt.com/oauth/client.json");
    authorizeUrl.searchParams.set("redirect_uri", "https://chatgpt.com/oauth/callback");
    authorizeUrl.searchParams.set("code_challenge", pkceS256(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "state-123");
    const authorizePage = await fetch(authorizeUrl);
    assert.equal(authorizePage.status, 200);
    assert.match(await authorizePage.text(), /Authorize WorkspaceGuard/);

    authorizeUrl.searchParams.set("approval_code", "approve-local");
    const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
    assert.equal(authorizeResponse.status, 302);
    const redirect = new URL(String(authorizeResponse.headers.get("location")));
    const code = redirect.searchParams.get("code");
    assert.match(String(code), /^wg_code_/);
    assert.equal(redirect.searchParams.get("state"), "state-123");

    const tokenResponse = await fetch(`${server.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: "https://chatgpt.com/oauth/client.json",
        redirect_uri: "https://chatgpt.com/oauth/callback",
        code_verifier: verifier,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json()) as { access_token?: string };
    assert.match(String(token.access_token), /^wg_at_/);

    const authorizedMcpResponse = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token.access_token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(authorizedMcpResponse.status, 400);
  } finally {
    await closeServer(server.server);
  }
});

test("MCP tool handlers enforce workspace read/write/shell scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspaceguard-scope-gate-"));
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "README.md"), "scoped\n", "utf8");
  await writeFile(join(project, "AGENTS.md"), "agent instructions\n", "utf8");
  await writeFile(join(project, "CLAUDE.md"), "claude instructions\n", "utf8");

  const config = {
    transport: "stdio" as const,
    host: "127.0.0.1",
    port: 8787,
    authMode: "bearer" as const,
    allowedRoots: [root],
    allowedOrigins: [],
    stateDir: join(root, ".state"),
    oauthScopes: ["workspace:read", "workspace:write", "workspace:shell"],
  };
  const context = createToolContext(config);
  const server = createWorkspaceGuardServer(config, context);
  const client = new Client({ name: "workspaceguard-scope-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const openResult = await client.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });
    assert.equal(openResult.isError, undefined);
    const openStructured = openResult.structuredContent as {
      workspaceId?: unknown;
      instructionFiles?: unknown;
      availableInstructionFiles?: unknown;
    };
    const workspaceId = String(openStructured.workspaceId);
    assert.ok(Array.isArray(openStructured.instructionFiles));
    assert.equal((openStructured.instructionFiles as unknown[]).length, 2);
    assert.deepEqual(openStructured.availableInstructionFiles, ["AGENTS.md", "CLAUDE.md"]);

    context.grantedScopes = ["workspace:read"];
    const readDeniedWrite = await client.callTool({
      name: "file_write",
      arguments: { workspaceId, path: "notes.txt", content: "nope\n" },
    });
    assert.equal(readDeniedWrite.isError, true);
    assert.match(String((readDeniedWrite.structuredContent as { error?: unknown })?.error), /workspace:write/);

    const readDeniedDrift = await client.callTool({
      name: "drift_check",
      arguments: { workspaceId },
    });
    assert.equal(readDeniedDrift.isError, true);
    assert.match(String((readDeniedDrift.structuredContent as { error?: unknown })?.error), /workspace:write/);

    const readDeniedShell = await client.callTool({
      name: "shell_run",
      arguments: { workspaceId, command: "true", args: [] },
    });
    assert.equal(readDeniedShell.isError, true);
    assert.match(String((readDeniedShell.structuredContent as { error?: unknown })?.error), /workspace:shell/);

    const readDeniedGitStatus = await client.callTool({
      name: "git_status",
      arguments: { workspaceId },
    });
    assert.equal(readDeniedGitStatus.isError, true);
    assert.match(String((readDeniedGitStatus.structuredContent as { error?: unknown })?.error), /workspace:shell/);

    const readDeniedGitDiff = await client.callTool({
      name: "git_diff",
      arguments: { workspaceId },
    });
    assert.equal(readDeniedGitDiff.isError, true);
    assert.match(String((readDeniedGitDiff.structuredContent as { error?: unknown })?.error), /workspace:shell/);

    const readOk = await client.callTool({
      name: "file_read",
      arguments: { workspaceId, path: "README.md" },
    });
    assert.equal(readOk.isError, undefined);

    context.grantedScopes = ["workspace:write"];
    const writeOpenOk = await client.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });
    assert.equal(writeOpenOk.isError, undefined);
    const writeOpenStructured = writeOpenOk.structuredContent as {
      instructionFiles?: unknown;
      availableInstructionFiles?: unknown;
    };
    assert.deepEqual(writeOpenStructured.instructionFiles, []);
    assert.deepEqual(writeOpenStructured.availableInstructionFiles, []);

    const writeOk = await client.callTool({
      name: "file_write",
      arguments: { workspaceId, path: "notes.txt", content: "allowed\n" },
    });
    assert.equal(writeOk.isError, undefined);

    const writeDeniedEdit = await client.callTool({
      name: "file_edit",
      arguments: {
        workspaceId,
        path: "notes.txt",
        oldText: "allowed\n",
        newText: "changed\n",
      },
    });
    assert.equal(writeDeniedEdit.isError, true);
    assert.match(String((writeDeniedEdit.structuredContent as { error?: unknown })?.error), /workspace:read/);

    const writeDeniedDrift = await client.callTool({
      name: "drift_check",
      arguments: { workspaceId },
    });
    assert.equal(writeDeniedDrift.isError, true);
    assert.match(String((writeDeniedDrift.structuredContent as { error?: unknown })?.error), /workspace:read/);

    const writeOutsideRoot = await client.callTool({
      name: "workspace_open",
      arguments: { path: "/" },
    });
    assert.equal(writeOutsideRoot.isError, true);
    const writeOutsideError = String((writeOutsideRoot.structuredContent as { error?: unknown })?.error);
    assert.match(writeOutsideError, /outside allowed roots/i);
    assert.doesNotMatch(writeOutsideError, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(writeOutsideError.includes("Allowed roots:"), false);

    const started = await client.callTool({
      name: "task_start",
      arguments: {
        workspaceId,
        objective: "secret objective",
        constraints: ["do not leak"],
      },
    });
    assert.equal(started.isError, undefined);
    const taskId = String((started.structuredContent as { taskId?: unknown }).taskId);

    const writeUpdate = await client.callTool({
      name: "task_update",
      arguments: { taskId, status: "blocked", note: "write-only note" },
    });
    assert.equal(writeUpdate.isError, undefined);
    const writeUpdateStructured = writeUpdate.structuredContent as Record<string, unknown>;
    assert.equal(writeUpdateStructured.taskId, taskId);
    assert.equal(writeUpdateStructured.status, "blocked");
    assert.equal(writeUpdateStructured.objective, "");
    assert.deepEqual(writeUpdateStructured.constraints, []);
    assert.deepEqual(writeUpdateStructured.notes, []);
    assert.doesNotMatch(JSON.stringify(writeUpdateStructured), /secret objective|do not leak|write-only note/);

    const writeDeniedShell = await client.callTool({
      name: "shell_run",
      arguments: { workspaceId, command: "true", args: [] },
    });
    assert.equal(writeDeniedShell.isError, true);
    assert.match(String((writeDeniedShell.structuredContent as { error?: unknown })?.error), /workspace:shell/);

    context.grantedScopes = [];
    const infoDenied = await client.callTool({
      name: "workspaceguard_info",
      arguments: {},
    });
    assert.equal(infoDenied.isError, true);
    assert.match(String((infoDenied.structuredContent as { error?: unknown })?.error), /workspace:read/);

    const policyDenied = await client.callTool({
      name: "policy_describe",
      arguments: {},
    });
    assert.equal(policyDenied.isError, true);
    assert.match(String((policyDenied.structuredContent as { error?: unknown })?.error), /workspace:read/);

    const auditEvents = (await readFile(join(config.stateDir, "audit.jsonl"), "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(
      auditEvents.some(
        (event) =>
          event.tool === "workspaceguard_info" &&
          event.status === "failed" &&
          String(event.error).includes("workspace:read"),
      ),
    );
    assert.ok(
      auditEvents.some(
        (event) =>
          event.tool === "policy_describe" &&
          event.status === "failed" &&
          String(event.error).includes("workspace:read"),
      ),
    );

    context.grantedScopes = ["workspace:shell"];
    const shellOpenOk = await client.callTool({
      name: "workspace_open",
      arguments: { path: project },
    });
    assert.equal(shellOpenOk.isError, undefined);
    const shellOpenStructured = shellOpenOk.structuredContent as {
      instructionFiles?: unknown;
      availableInstructionFiles?: unknown;
    };
    assert.deepEqual(shellOpenStructured.instructionFiles, []);
    assert.deepEqual(shellOpenStructured.availableInstructionFiles, []);

    const shellOk = await client.callTool({
      name: "shell_run",
      arguments: { workspaceId, command: "node", args: ["-e", "process.stdout.write('ok')"] },
    });
    assert.equal(shellOk.isError, undefined);

    const shellGitStatusOk = await client.callTool({
      name: "git_status",
      arguments: { workspaceId },
    });
    assert.equal(shellGitStatusOk.isError, undefined);

    context.grantedScopes = undefined;
    const fullWrite = await client.callTool({
      name: "file_write",
      arguments: { workspaceId, path: "full.txt", content: "full\n" },
    });
    assert.equal(fullWrite.isError, undefined);
  } finally {
    await client.close();
    await server.close();
  }
});

type ListenableApp = {
  listen(port: number, host: string, callback: () => void): Server;
};

async function listenApp(app: ListenableApp): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
    started.on("error", reject);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
