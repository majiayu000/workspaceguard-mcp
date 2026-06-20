import { homedir } from "node:os";
import { resolve } from "node:path";

export type TransportMode = "stdio" | "http";

export interface WorkspaceGuardConfig {
  transport: TransportMode;
  host: string;
  port: number;
  allowedRoots: string[];
  allowedOrigins: string[];
  stateDir: string;
  bearerToken?: string;
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceGuardConfig {
  const args = parseArgs(argv);
  const transport = parseTransport(args.transport ?? env.WORKSPACEGUARD_TRANSPORT ?? "stdio");
  const host = args.host ?? env.WORKSPACEGUARD_BIND_HOST ?? "127.0.0.1";
  const port = parsePort(args.port ?? env.WORKSPACEGUARD_PORT ?? "8787");
  const allowedRoots = parseAllowedRoots(args.allowedRoots ?? env.WORKSPACEGUARD_ALLOWED_ROOTS ?? process.cwd());
  const allowedOrigins = parseStringList(args.allowedOrigins ?? env.WORKSPACEGUARD_ALLOWED_ORIGINS ?? "");
  const stateDir = resolvePath(args.stateDir ?? env.WORKSPACEGUARD_STATE_DIR ?? "~/.workspaceguard");
  const bearerToken = (args.bearerToken ?? env.WORKSPACEGUARD_TOKEN)?.trim() || undefined;
  validateHttpAuth({ transport, bearerToken });

  return {
    transport,
    host,
    port,
    allowedRoots,
    allowedOrigins,
    stateDir,
    bearerToken,
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
  readonly bearerToken: string | undefined;
}): void {
  if (input.transport === "http" && input.bearerToken === undefined) {
    throw new Error("WORKSPACEGUARD_TOKEN or --bearer-token is required when transport=http.");
  }
}

function resolvePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}
