import type { IncomingMessage, ServerResponse } from "node:http";
import type { OAuthDevProvider } from "./oauth-dev-provider.js";

type HeaderRequest = IncomingMessage & {
  body?: unknown;
  header(name: string): string | undefined;
  query?: Record<string, string | string[]>;
  url?: string;
};

type HttpResponse = ServerResponse & {
  json(body: unknown): void;
  send(body: string): void;
  status(code: number): HttpResponse;
};

type RouteApp = {
  get(path: string, handler: (req: HeaderRequest, res: HttpResponse) => void | Promise<void>): void;
  post(path: string, handler: (req: HeaderRequest, res: HttpResponse) => void | Promise<void>): void;
};

export function registerOAuthDevRoutes(app: RouteApp, provider: OAuthDevProvider): void {
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(provider.protectedResourceMetadata());
  });

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(provider.authorizationServerMetadata());
  });

  app.get("/oauth/authorize", (req, res) => {
    const params = requestSearchParams(req);
    if (!params.has("approval_code")) {
      res.status(200).send(provider.renderAuthorizePage(params));
      return;
    }

    try {
      const redirect = provider.approveAuthorization(params);
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
    } catch {
      res.status(400).send(provider.renderAuthorizePage(params));
    }
  });

  app.post("/oauth/token", async (req, res) => {
    try {
      const params = await requestBodyParams(req);
      res.json(provider.exchangeCode(params));
    } catch (error) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: error instanceof Error ? error.message : "Invalid OAuth token request.",
      });
    }
  });
}

export async function requestBodyParams(req: HeaderRequest): Promise<URLSearchParams> {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.body as Record<string, unknown>)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }

  if (typeof req.body === "string") return new URLSearchParams(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function requestSearchParams(req: HeaderRequest): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams;
}
