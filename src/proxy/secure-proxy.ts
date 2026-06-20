import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createHttpAuthenticator } from "../auth/http-auth.js";
import { registerOAuthDevRoutes } from "../auth/oauth-http-routes.js";
import type { WorkspaceGuardProxyConfig } from "../config/config.js";
import { assertOriginAllowed } from "../mcp/http-security.js";
import { VERSION } from "../version.js";

type HeaderRequest = IncomingMessage & {
  method: string;
  body?: unknown;
  header(name: string): string | undefined;
  url?: string;
};

type HttpResponse = ServerResponse & {
  headersSent: boolean;
  json(body: unknown): void;
  setHeader(name: string, value: string | number | readonly string[]): HttpResponse;
  status(code: number): HttpResponse;
};

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createSecureProxyApp(config: WorkspaceGuardProxyConfig) {
  const app = createMcpExpressApp({ host: config.host });
  const authenticator = createHttpAuthenticator(config);

  if (authenticator.oauthProvider) {
    registerOAuthDevRoutes(app, authenticator.oauthProvider);
  }

  app.get("/healthz", (_req: HeaderRequest, res: HttpResponse) => {
    res.json({ ok: true, name: "workspaceguard-proxy", version: VERSION, targetUrl: config.targetUrl });
  });

  app.all("/mcp", async (req: HeaderRequest, res: HttpResponse) => {
    try {
      assertOriginAllowed(req.header("origin"), config.allowedOrigins);
    } catch (error) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32003,
          message: error instanceof Error ? error.message : "Origin not allowed",
        },
        id: null,
      });
      return;
    }

    if (!authenticator.authorize(req.header("authorization"))) {
      const challengeHeader = authenticator.challengeHeader();
      if (challengeHeader) res.setHeader("WWW-Authenticate", challengeHeader);
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }

    try {
      const upstreamResponse = await fetch(targetUrlForRequest(config.targetUrl, req), {
        method: req.method,
        headers: upstreamHeaders(req, config.targetBearerToken),
        body: await upstreamBody(req),
      });
      res.statusCode = upstreamResponse.status;
      for (const [header, value] of upstreamResponse.headers.entries()) {
        if (!HOP_BY_HOP_RESPONSE_HEADERS.has(header.toLowerCase())) {
          res.setHeader(header, value);
        }
      }
      res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({
          jsonrpc: "2.0",
          error: {
            code: -32002,
            message: error instanceof Error ? error.message : "Proxy upstream error",
          },
          id: null,
        });
      }
    }
  });

  return app;
}

export async function serveSecureProxy(config: WorkspaceGuardProxyConfig): Promise<void> {
  const app = createSecureProxyApp(config);
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => resolve());
    server.on("error", reject);
  });
  console.error(`workspaceguard proxy listening on http://${config.host}:${config.port}/mcp`);
}

function targetUrlForRequest(targetUrl: string, req: HeaderRequest): string {
  const target = new URL(targetUrl);
  const incoming = new URL(req.url ?? "/mcp", "http://localhost");
  target.search = incoming.search;
  return target.toString();
}

function upstreamHeaders(req: HeaderRequest, targetBearerToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  copyHeader(req, headers, "accept");
  copyHeader(req, headers, "content-type");
  copyHeader(req, headers, "mcp-session-id");
  copyHeader(req, headers, "last-event-id");
  if (targetBearerToken !== undefined) {
    headers.authorization = `Bearer ${targetBearerToken}`;
  }
  return headers;
}

function copyHeader(req: HeaderRequest, headers: Record<string, string>, name: string): void {
  const value = req.header(name);
  if (value !== undefined) headers[name] = value;
}

async function upstreamBody(req: HeaderRequest): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body !== undefined) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks).toString("utf8");
}
