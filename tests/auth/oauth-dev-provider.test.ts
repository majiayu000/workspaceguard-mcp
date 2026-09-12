import assert from "node:assert/strict";
import test from "node:test";

import { OAuthDevProvider, pkceS256 } from "../../src/auth/oauth-dev-provider.js";

test("OAuthDevProvider publishes metadata and exchanges PKCE authorization codes", () => {
  const provider = new OAuthDevProvider({
    publicBaseUrl: "https://workspaceguard.example",
    approvalCode: "approve-local",
    scopes: ["workspace:read", "workspace:write"],
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.deepEqual(provider.protectedResourceMetadata(), {
    resource: "https://workspaceguard.example",
    authorization_servers: ["https://workspaceguard.example"],
    scopes_supported: ["workspace:read", "workspace:write"],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://workspaceguard.example/healthz",
  });
  assert.equal(
    provider.authorizationServerMetadata().authorization_endpoint,
    "https://workspaceguard.example/oauth/authorize",
  );

  const verifier = "verifier-value";
  const authorizeParams = new URLSearchParams({
    response_type: "code",
    client_id: "https://chatgpt.com/oauth/client.json",
    redirect_uri: "https://chatgpt.com/oauth/callback",
    code_challenge: pkceS256(verifier),
    code_challenge_method: "S256",
    scope: "workspace:read workspace:write",
    state: "state-123",
    approval_code: "approve-local",
  });
  const redirect = provider.approveAuthorization(authorizeParams);
  const code = redirect.searchParams.get("code");
  assert.match(String(code), /^wg_code_/);
  assert.equal(redirect.searchParams.get("state"), "state-123");

  const token = provider.exchangeCode(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://chatgpt.com/oauth/callback",
      code_verifier: verifier,
    }),
  );

  assert.match(token.access_token, /^wg_at_/);
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.scope, "workspace:read workspace:write");
  assert.equal(provider.verifyBearerHeader(`Bearer ${token.access_token}`), true);
  assert.deepEqual(provider.authenticateBearerHeader(`Bearer ${token.access_token}`), {
    scopes: ["workspace:read", "workspace:write"],
  });
});

test("OAuthDevProvider rejects reused codes and invalid approval codes", () => {
  const provider = new OAuthDevProvider({
    publicBaseUrl: "https://workspaceguard.example",
    approvalCode: "approve-local",
    scopes: ["workspace:read"],
  });
  const verifier = "verifier";
  const redirect = provider.approveAuthorization(
    new URLSearchParams({
      response_type: "code",
      client_id: "client",
      redirect_uri: "https://client.example/callback",
      code_challenge: pkceS256(verifier),
      code_challenge_method: "S256",
      approval_code: "approve-local",
    }),
  );
  const code = String(redirect.searchParams.get("code"));

  provider.exchangeCode(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "client",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }),
  );
  assert.throws(
    () =>
      provider.exchangeCode(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: "client",
          redirect_uri: "https://client.example/callback",
          code_verifier: verifier,
        }),
      ),
    /Unknown or already used authorization code/,
  );

  assert.throws(
    () =>
      provider.approveAuthorization(
        new URLSearchParams({
          response_type: "code",
          client_id: "client",
          redirect_uri: "https://client.example/callback",
          code_challenge: pkceS256("verifier"),
          code_challenge_method: "S256",
          approval_code: "wrong",
        }),
      ),
    /Invalid approval code/,
  );
});

test("OAuthDevProvider authenticates narrow-scope tokens with persisted scopes", () => {
  const provider = new OAuthDevProvider({
    publicBaseUrl: "https://workspaceguard.example",
    approvalCode: "approve-local",
    scopes: ["workspace:read", "workspace:write", "workspace:shell"],
  });
  const verifier = "narrow-verifier";
  const redirect = provider.approveAuthorization(
    new URLSearchParams({
      response_type: "code",
      client_id: "client",
      redirect_uri: "https://client.example/callback",
      code_challenge: pkceS256(verifier),
      code_challenge_method: "S256",
      scope: "workspace:read",
      approval_code: "approve-local",
    }),
  );
  const token = provider.exchangeCode(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: String(redirect.searchParams.get("code")),
      client_id: "client",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }),
  );

  assert.equal(token.scope, "workspace:read");
  assert.deepEqual(provider.authenticateBearerHeader(`Bearer ${token.access_token}`), {
    scopes: ["workspace:read"],
  });
});
