export function authorizeBearer(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  return header === `Bearer ${token}`;
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function assertOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): void {
  if (isOriginAllowed(origin, allowedOrigins)) return;
  throw new Error(`Origin not allowed: ${origin}`);
}
