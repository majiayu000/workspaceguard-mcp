import { homedir } from "node:os";
import { resolve } from "node:path";

export type TransportMode = "stdio" | "http";
export type HttpAuthMode = "bearer" | "oauth-dev";

export interface WorkspaceGuardConfig {
  transport: TransportMode;
  host: string;
  port: number;
  authMode: HttpAuthMode;
  allowedRoots: string[];
  allowedOrigins: string[];
  stateDir: string;
  bearerToken?: string;
  publicBaseUrl?: string;
  oauthApprovalCode?: string;
  oauthScopes: string[];
}

export interface WorkspaceGuardProxyConfig {
  host: string;
  port: number;
  authMode: HttpAuthMode;
  targetUrl: string;
  targetBearerToken?: string;
  allowedOrigins: string[];
  bearerToken?: string;
  publicBaseUrl?: string;
  oauthApprovalCode?: string;
  oauthScopes: string[];
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceGuardConfig {
  const args = parseArgs(argv);
  const transport = parseTransport(args.transport ?? env.WORKSPACEGUARD_TRANSPORT ?? "stdio");
  const host = args.host ?? env.WORKSPACEGUARD_BIND_HOST ?? "127.0.0.1";
  const port = parsePort(args.port ?? env.WORKSPACEGUARD_PORT ?? "8787");
  const authMode = parseHttpAuthMode(args.authMode ?? env.WORKSPACEGUARD_AUTH_MODE ?? "bearer");
  const allowedRoots = parseAllowedRoots(args.allowedRoots ?? env.WORKSPACEGUARD_ALLOWED_ROOTS ?? process.cwd());
  const allowedOrigins = parseStringList(args.allowedOrigins ?? env.WORKSPACEGUARD_ALLOWED_ORIGINS ?? "");
  const stateDir = resolvePath(args.stateDir ?? env.WORKSPACEGUARD_STATE_DIR ?? "~/.workspaceguard");
  const bearerToken = (args.bearerToken ?? env.WORKSPACEGUARD_TOKEN)?.trim() || undefined;
  const publicBaseUrl = parseOptionalUrl(args.publicBaseUrl ?? env.WORKSPACEGUARD_PUBLIC_BASE_URL);
  const oauthApprovalCode = (args.oauthApprovalCode ?? env.WORKSPACEGUARD_OAUTH_APPROVAL_CODE)?.trim() || undefined;
  const oauthScopes = parseStringList(
    args.oauthScopes ?? env.WORKSPACEGUARD_OAUTH_SCOPES ?? "workspace:read,workspace:write,workspace:shell",
  );
  validateHttpAuth({ transport, authMode, bearerToken, publicBaseUrl, oauthApprovalCode });

  return {
    transport,
    host,
    port,
    authMode,
    allowedRoots,
    allowedOrigins,
    stateDir,
    bearerToken,
    publicBaseUrl,
    oauthApprovalCode,
    oauthScopes,
  };
}

export function loadProxyConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceGuardProxyConfig {
  const args = parseArgs(argv);
  const host = args.host ?? env.WORKSPACEGUARD_PROXY_BIND_HOST ?? env.WORKSPACEGUARD_BIND_HOST ?? "127.0.0.1";
  const port = parsePort(args.port ?? env.WORKSPACEGUARD_PROXY_PORT ?? "8788");
  const authMode = parseHttpAuthMode(args.authMode ?? env.WORKSPACEGUARD_AUTH_MODE ?? "oauth-dev");
  const targetUrl = parseUrl(
    args.targetUrl ?? env.WORKSPACEGUARD_PROXY_TARGET_URL ?? "http://127.0.0.1:8787/mcp",
    "proxy target URL",
  );
  const targetBearerToken =
    (args.targetBearerToken ?? env.WORKSPACEGUARD_PROXY_TARGET_TOKEN ?? env.WORKSPACEGUARD_TOKEN)?.trim() ||
    undefined;
  const allowedOrigins = parseStringList(args.allowedOrigins ?? env.WORKSPACEGUARD_ALLOWED_ORIGINS ?? "");
  const bearerToken = (args.bearerToken ?? env.WORKSPACEGUARD_PROXY_TOKEN)?.trim() || undefined;
  const publicBaseUrl = parseOptionalUrl(args.publicBaseUrl ?? env.WORKSPACEGUARD_PUBLIC_BASE_URL);
  const oauthApprovalCode = (args.oauthApprovalCode ?? env.WORKSPACEGUARD_OAUTH_APPROVAL_CODE)?.trim() || undefined;
  const oauthScopes = parseStringList(
    args.oauthScopes ?? env.WORKSPACEGUARD_OAUTH_SCOPES ?? "workspace:read,workspace:write,workspace:shell",
  );
  validateHttpAuth({ transport: "http", authMode, bearerToken, publicBaseUrl, oauthApprovalCode });

  return {
    host,
    port,
    authMode,
    targetUrl,
    targetBearerToken,
    allowedOrigins,
    bearerToken,
    publicBaseUrl,
    oauthApprovalCode,
    oauthScopes,
  };
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith("--")) continue;

    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    if (!rawKey) continue;
    const key = kebabToCamel(rawKey);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
      continue;
    }
    parsed[key] = "true";
  }
  return parsed;
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseTransport(value: string): TransportMode {
  if (value === "stdio" || value === "http") return value;
  throw new Error(`Invalid transport: ${value}`);
}

function parseHttpAuthMode(value: string): HttpAuthMode {
  if (value === "bearer" || value === "oauth-dev") return value;
  throw new Error(`Invalid auth mode: ${value}`);
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function parseAllowedRoots(value: string): string[] {
  const roots = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(resolvePath);

  if (roots.length === 0) throw new Error("At least one allowed root is required.");
  return Array.from(new Set(roots));
}

function parseStringList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)));
}

function validateHttpAuth(input: {
  readonly transport: TransportMode;
  readonly authMode: HttpAuthMode;
  readonly bearerToken: string | undefined;
  readonly publicBaseUrl: string | undefined;
  readonly oauthApprovalCode: string | undefined;
}): void {
  if (input.transport !== "http") return;

  if (input.authMode === "bearer" && input.bearerToken === undefined) {
    throw new Error("WORKSPACEGUARD_TOKEN or --bearer-token is required when transport=http.");
  }
  if (input.authMode === "oauth-dev" && input.publicBaseUrl === undefined) {
    throw new Error("WORKSPACEGUARD_PUBLIC_BASE_URL or --public-base-url is required when auth-mode=oauth-dev.");
  }
  if (input.authMode === "oauth-dev" && input.oauthApprovalCode === undefined) {
    throw new Error(
      "WORKSPACEGUARD_OAUTH_APPROVAL_CODE or --oauth-approval-code is required when auth-mode=oauth-dev.",
    );
  }
}

function parseOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return parseUrl(value, "URL");
}

function parseUrl(value: string, label: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL must use http or https.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function resolvePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}
