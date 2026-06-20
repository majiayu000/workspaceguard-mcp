import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { VERSION } from "../version.js";
import { AuditLog } from "../audit/audit-log.js";
import type { WorkspaceGuardConfig } from "../config/config.js";
import { FileService } from "../files/file-service.js";
import { getGitDiff, getGitStatus } from "../git/git-service.js";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";
import { runShellCommand } from "../shell/shell-runner.js";
import { WorkspaceRegistry } from "../workspace/workspace-registry.js";
import { errorResult, textResult } from "./responses.js";

type HttpTransport = StreamableHTTPServerTransport;
type HeaderRequest = IncomingMessage & {
  method: string;
  body?: unknown;
  header(name: string): string | undefined;
};
type JsonResponse = ServerResponse & {
  headersSent: boolean;
  json(body: unknown): void;
  status(code: number): JsonResponse;
};

export function createWorkspaceGuardServer(config: WorkspaceGuardConfig): McpServer {
  const server = new McpServer(
    {
      name: "workspaceguard",
      title: "WorkspaceGuard",
      version: VERSION,
    },
    {
      instructions:
        "Use WorkspaceGuard as a structured local workspace runtime. Open a workspace before file or shell operations. Treat shell access as local machine access, not a sandbox.",
    },
  );

  registerCoreTools(server, config);
  return server;
}

export async function serveStdio(config: WorkspaceGuardConfig): Promise<void> {
  const server = createWorkspaceGuardServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function createHttpApp(config: WorkspaceGuardConfig) {
  const app = createMcpExpressApp({ host: config.host });
  const transports = new Map<string, HttpTransport>();

  app.get("/healthz", (_req: HeaderRequest, res: JsonResponse) => {
    res.json({ ok: true, name: "workspaceguard", version: VERSION });
  });

  app.all("/mcp", async (req: HeaderRequest, res: JsonResponse) => {
    if (!authorizeRequest(req.header("authorization"), config.bearerToken)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }

    try {
      const sessionId = req.header("mcp-session-id");
      const initializeRequest = req.method === "POST" && isInitializeRequest(req.body);
      let transport: HttpTransport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Unknown MCP session" },
            id: null,
          });
          return;
        }
      } else if (initializeRequest) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, transport);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };

        const server = createWorkspaceGuardServer(config);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid MCP session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  return app;
}

export async function serveHttp(config: WorkspaceGuardConfig): Promise<void> {
  const app = createHttpApp(config);
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => resolve());
    server.on("error", reject);
  });
  console.error(`workspaceguard listening on http://${config.host}:${config.port}/mcp`);
}

function registerCoreTools(server: McpServer, config: WorkspaceGuardConfig): void {
  const workspaces = new WorkspaceRegistry({ allowedRoots: config.allowedRoots });
  const auditLog = new AuditLog(join(config.stateDir, "audit.jsonl"));
  const files = new FileService(config.allowedRoots);

  server.registerTool(
    "workspaceguard_info",
    {
      title: "WorkspaceGuard info",
      description: "Return WorkspaceGuard runtime configuration summary.",
      inputSchema: {},
      outputSchema: {
        name: z.string(),
        version: z.string(),
        transport: z.string(),
        allowedRoots: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async () =>
      textResult(`WorkspaceGuard ${VERSION}`, {
        name: "workspaceguard",
        version: VERSION,
        transport: config.transport,
        allowedRoots: config.allowedRoots,
      }),
  );

  server.registerTool(
    "policy_describe",
    {
      title: "Describe active policy",
      description: "Show the current local policy profile for this WorkspaceGuard server.",
      inputSchema: {},
      outputSchema: {
        result: z.string(),
        shell: z.string(),
        writes: z.string(),
        restore: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async () =>
      textResult("Default policy: local owner, narrow roots, shell allowed with audit in future milestones.", {
        result: "default",
        shell: "allowed_with_timeout",
        writes: "workspace_only",
        restore: "not_implemented",
      }),
  );

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Development smoke-test tool.",
      inputSchema: {
        message: z.string().describe("Message to echo."),
      },
      outputSchema: {
        result: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ message }) => {
      try {
        return textResult(message, { result: message });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "workspace_open",
    {
      title: "Open workspace",
      description: "Open an allowed local checkout workspace and return a workspaceId.",
      inputSchema: {
        path: z.string().describe("Workspace path inside an allowed root."),
        mode: z.enum(["checkout"]).optional().describe("Workspace mode. v0.1 supports checkout only."),
      },
      outputSchema: {
        workspaceId: z.string(),
        root: z.string(),
        mode: z.string(),
        openedAt: z.string(),
        instructionFiles: z.array(z.unknown()),
        availableInstructionFiles: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const workspace = await workspaces.openWorkspace(input);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "workspace_open",
          workspaceId: workspace.workspaceId,
          root: workspace.root,
        });
        return textResult(`Opened workspace ${workspace.workspaceId}`, asStructured(workspace));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "workspace_status",
    {
      title: "Workspace status",
      description: "Return a known workspace by id, or list open workspaces when workspaceId is omitted.",
      inputSchema: {
        workspaceId: z.string().optional(),
      },
      outputSchema: {
        workspaces: z.array(z.unknown()).optional(),
        workspace: z.unknown().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        if (workspaceId) {
          const workspace = workspaces.resolveWorkspace(workspaceId);
          return textResult(`Workspace ${workspace.workspaceId} is open.`, { workspace });
        }
        const openWorkspaces = workspaces.listWorkspaces();
        return textResult(`${openWorkspaces.length} workspace(s) open.`, { workspaces: openWorkspaces });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "shell_run",
    {
      title: "Run shell command",
      description: "Run a structured command array inside an open workspace. This is real local execution.",
      inputSchema: {
        workspaceId: z.string(),
        command: z.string().describe("Executable name or absolute executable path."),
        args: z.array(z.string()).default([]).describe("Command arguments. No shell interpolation is used."),
        workingDirectory: z.string().optional().describe("Directory relative to the workspace root."),
        timeoutMs: z.number().int().positive().max(300_000).default(30_000),
      },
      outputSchema: {
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number().nullable(),
        signal: z.string().nullable(),
        durationMs: z.number(),
        timedOut: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, command, args, workingDirectory, timeoutMs }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const cwd = workingDirectory
          ? (await resolvePathWithinAllowedRoots(workingDirectory, [workspace.root], {
              baseDir: workspace.root,
              mustExist: true,
            })).path
          : workspace.root;
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "shell_run",
          workspaceId,
          command,
          argsLength: args.length,
          cwd,
        });
        const result = await runShellCommand({ command, args, cwd, timeoutMs });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "shell_run_result",
          workspaceId,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        });
        return textResult(result.stdout || result.stderr || `exit ${result.exitCode}`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "git_status",
    {
      title: "Git status",
      description: "Run git status --porcelain=v1 inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
      },
      outputSchema: {
        porcelain: z.string(),
        exitCode: z.number().nullable(),
        stderr: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await getGitStatus({ cwd: workspace.root });
        return textResult(result.porcelain || "Clean working tree.", asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "git_diff",
    {
      title: "Git diff",
      description: "Run git diff --no-color inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
      },
      outputSchema: {
        diff: z.string(),
        exitCode: z.number().nullable(),
        stderr: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await getGitDiff({ cwd: workspace.root });
        return textResult(result.diff || "No diff.", asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "file_read",
    {
      title: "Read file",
      description: "Read a UTF-8 file inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        path: z.string(),
        content: z.string(),
        totalLines: z.number(),
        returnedLines: z.number(),
        offset: z.number(),
        limited: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, path, offset, limit }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.readFile({ workspaceRoot: workspace.root, path, offset, limit });
        return textResult(result.content, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "directory_list",
    {
      title: "List directory",
      description: "List a directory inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string().default("."),
      },
      outputSchema: {
        path: z.string(),
        entries: z.array(z.object({ name: z.string(), type: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, path }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.listDirectory({ workspaceRoot: workspace.root, path });
        return textResult(`${result.entries.length} entrie(s).`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_text",
    {
      title: "Search text",
      description: "Search for a literal text pattern inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        pattern: z.string(),
        path: z.string().optional(),
        maxResults: z.number().int().nonnegative().max(1000).optional(),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            path: z.string(),
            line: z.number(),
            text: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, pattern, path, maxResults }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.searchText({ workspaceRoot: workspace.root, pattern, path, maxResults });
        return textResult(`${result.matches.length} match(es).`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "file_write",
    {
      title: "Write file",
      description: "Create or overwrite a UTF-8 file inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        content: z.string(),
        overwrite: z.boolean().default(false),
      },
      outputSchema: {
        path: z.string(),
        bytes: z.number(),
        created: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, path, content, overwrite }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "file_write",
          workspaceId,
          path,
          bytes: Buffer.byteLength(content, "utf8"),
          overwrite,
        });
        const result = await files.writeFile({ workspaceRoot: workspace.root, path, content, overwrite });
        return textResult(`Wrote ${result.bytes} byte(s).`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "file_edit",
    {
      title: "Edit file",
      description: "Replace an exact text block that appears exactly once in a workspace file.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        oldText: z.string(),
        newText: z.string(),
      },
      outputSchema: {
        path: z.string(),
        replacements: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, path, oldText, newText }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "file_edit",
          workspaceId,
          path,
          oldBytes: Buffer.byteLength(oldText, "utf8"),
          newBytes: Buffer.byteLength(newText, "utf8"),
        });
        const result = await files.editFile({ workspaceRoot: workspace.root, path, oldText, newText });
        return textResult(`Edited ${result.path}.`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function authorizeRequest(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  return header === `Bearer ${token}`;
}

function asStructured(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
