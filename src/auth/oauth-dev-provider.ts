import { createHash, randomUUID } from "node:crypto";

import { timingSafeEqualString } from "../security/timing-safe.js";

export interface OAuthDevProviderConfig {
  readonly publicBaseUrl: string;
  readonly approvalCode: string;
  readonly scopes: readonly string[];
  readonly codeTtlMs?: number;
  readonly tokenTtlMs?: number;
  readonly now?: () => Date;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly scope: string;
}

type AuthorizationCodeRecord = {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  readonly expiresAtMs: number;
};

type AccessTokenRecord = {
  readonly token: string;
  readonly scope: string;
  readonly expiresAtMs: number;
};

export class OAuthDevProvider {
  private readonly publicBaseUrl: string;
  private readonly approvalCode: string;
  private readonly scopes: readonly string[];
  private readonly codeTtlMs: number;
  private readonly tokenTtlMs: number;
  private readonly now: () => Date;
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();

  constructor(config: OAuthDevProviderConfig) {
    this.publicBaseUrl = stripTrailingSlash(config.publicBaseUrl);
    this.approvalCode = config.approvalCode;
    this.scopes = config.scopes;
    this.codeTtlMs = config.codeTtlMs ?? 5 * 60_000;
    this.tokenTtlMs = config.tokenTtlMs ?? 60 * 60_000;
    this.now = config.now ?? (() => new Date());
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.publicBaseUrl,
      authorization_servers: [this.publicBaseUrl],
      scopes_supported: this.scopes,
      bearer_methods_supported: ["header"],
      resource_documentation: `${this.publicBaseUrl}/healthz`,
    };
  }

  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.publicBaseUrl,
      authorization_endpoint: `${this.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.publicBaseUrl}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: this.scopes,
    };
  }

  wwwAuthenticateHeader(): string {
    return `Bearer resource_metadata="${this.publicBaseUrl}/.well-known/oauth-protected-resource", scope="${this.scopes.join(" ")}"`;
  }

  renderAuthorizePage(params: URLSearchParams): string {
    const error = params.has("approval_code") ? "<p class=\"error\">Invalid approval code.</p>" : "";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authorize WorkspaceGuard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 680px; margin: 48px auto; line-height: 1.5; }
    label, input, button { display: block; width: 100%; box-sizing: border-box; }
    input { padding: 10px; margin: 8px 0 16px; }
    button { padding: 10px; }
    .error { color: #b00020; }
  </style>
</head>
<body>
  <h1>Authorize WorkspaceGuard</h1>
  <p>Enter the local approval code configured for this WorkspaceGuard server.</p>
  ${error}
  <form method="get" action="/oauth/authorize">
    ${hiddenInputs(params)}
    <label for="approval_code">Approval code</label>
    <input id="approval_code" name="approval_code" type="password" autocomplete="one-time-code" required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
  }

  approveAuthorization(params: URLSearchParams): URL {
    const approvalCode = required(params, "approval_code");
    if (!timingSafeEqualString(approvalCode, this.approvalCode)) {
      throw new Error("Invalid approval code.");
    }

    const responseType = required(params, "response_type");
    if (responseType !== "code") {
      throw new Error(`Unsupported response_type: ${responseType}`);
    }

    const codeChallengeMethod = required(params, "code_challenge_method");
    if (codeChallengeMethod !== "S256") {
      throw new Error("Only PKCE S256 code_challenge_method is supported.");
    }

    const clientId = required(params, "client_id");
    const redirectUri = required(params, "redirect_uri");
    const codeChallenge = required(params, "code_challenge");
    const scope = normalizeScope(params.get("scope"), this.scopes);
    const code = `wg_code_${randomUUID()}`;
    this.authorizationCodes.set(code, {
      code,
      clientId,
      redirectUri,
      codeChallenge,
      scope,
      expiresAtMs: this.now().getTime() + this.codeTtlMs,
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    const state = params.get("state");
    if (state !== null) redirect.searchParams.set("state", state);
    return redirect;
  }

  exchangeCode(params: URLSearchParams): TokenResponse {
    const grantType = required(params, "grant_type");
    if (grantType !== "authorization_code") {
      throw new Error(`Unsupported grant_type: ${grantType}`);
    }

    const code = required(params, "code");
    const record = this.authorizationCodes.get(code);
    this.authorizationCodes.delete(code);
    if (record === undefined) {
      throw new Error("Unknown or already used authorization code.");
    }
    if (record.expiresAtMs <= this.now().getTime()) {
      throw new Error("Authorization code expired.");
    }

    const clientId = required(params, "client_id");
    const redirectUri = required(params, "redirect_uri");
    if (clientId !== record.clientId || redirectUri !== record.redirectUri) {
      throw new Error("Authorization code client or redirect_uri mismatch.");
    }

    const verifier = required(params, "code_verifier");
    if (!timingSafeEqualString(pkceS256(verifier), record.codeChallenge)) {
      throw new Error("PKCE verification failed.");
    }

    const token = `wg_at_${randomUUID()}`;
    this.accessTokens.set(token, {
      token,
      scope: record.scope,
      expiresAtMs: this.now().getTime() + this.tokenTtlMs,
    });

    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.floor(this.tokenTtlMs / 1000),
      scope: record.scope,
    };
  }

  verifyBearerHeader(header: string | undefined): boolean {
    if (header === undefined || !header.startsWith("Bearer ")) return false;
    const token = header.slice("Bearer ".length);
    const record = this.accessTokens.get(token);
    if (record === undefined) return false;
    if (record.expiresAtMs <= this.now().getTime()) {
      this.accessTokens.delete(token);
      return false;
    }
    return true;
  }
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function required(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (value === null || value.length === 0) {
    throw new Error(`Missing OAuth parameter: ${key}`);
  }
  return value;
}

function normalizeScope(rawScope: string | null, allowedScopes: readonly string[]): string {
  if (rawScope === null || rawScope.trim().length === 0) return allowedScopes.join(" ");
  const requested = rawScope.split(/\s+/).filter(Boolean);
  const unsupported = requested.filter((scope) => !allowedScopes.includes(scope));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported OAuth scope(s): ${unsupported.join(", ")}`);
  }
  return requested.join(" ");
}

function hiddenInputs(params: URLSearchParams): string {
  return Array.from(params.entries())
    .filter(([key]) => key !== "approval_code")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n    ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
