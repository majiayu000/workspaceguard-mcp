import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../version.js";
import type { WorkspaceGuardConfig } from "../config/config.js";
import { registerCoreTools } from "./register-core-tools.js";
import { registerFileTools } from "./register-file-tools.js";
import { registerShellGitTools } from "./register-shell-git-tools.js";
import { registerWorkspaceTools } from "./register-workspace-tools.js";
import { createToolContext } from "./tool-context.js";

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

  const context = createToolContext(config);
  registerCoreTools(server, context);
  registerWorkspaceTools(server, context);
  registerShellGitTools(server, context);
  registerFileTools(server, context);
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

function authorizeRequest(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  return header === `Bearer ${token}`;
}
