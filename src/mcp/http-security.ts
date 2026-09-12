import { timingSafeEqualString } from "../security/timing-safe.js";

const BEARER_PREFIX = "Bearer ";

export function authorizeBearer(header: string | undefined, token: string | undefined): boolean {
  if (!token) return false;
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return false;

  const provided = header.slice(BEARER_PREFIX.length);
  return timingSafeEqualString(provided, token);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function assertOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): void {
  if (isOriginAllowed(origin, allowedOrigins)) return;
  throw new Error(`Origin not allowed: ${origin}`);
}
