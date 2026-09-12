import assert from "node:assert/strict";
import test from "node:test";

import { OAuthDevProvider, pkceS256 } from "../../src/auth/oauth-dev-provider.js";

const chatgptClient = {
  clientId: "https://chatgpt.com/oauth/client.json",
  redirectUris: ["https://chatgpt.com/oauth/callback"],
};

const testClient = {
  clientId: "client",
  redirectUris: ["https://client.example/callback"],
};

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
    client_id: chatgptClient.clientId,
    redirect_uri: chatgptClient.redirectUris[0]!,
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
      client_id: chatgptClient.clientId,
      redirect_uri: chatgptClient.redirectUris[0]!,
      code_verifier: verifier,
    }),
  );

  assert.match(token.access_token, /^wg_at_/);
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.scope, "workspace:read workspace:write");
  assert.equal(provider.verifyBearerHeader(`Bearer ${token.access_token}`), true);
});

test("OAuthDevProvider rejects reused codes and invalid approval codes", () => {
  const provider = new OAuthDevProvider({
    publicBaseUrl: "https://workspaceguard.example",
    approvalCode: "approve-local",
    scopes: ["workspace:read"],
    publicClients: [testClient],
  });
  const verifier = "verifier";
  const redirect = provider.approveAuthorization(
    new URLSearchParams({
      response_type: "code",
      client_id: testClient.clientId,
      redirect_uri: testClient.redirectUris[0]!,
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
      client_id: testClient.clientId,
      redirect_uri: testClient.redirectUris[0]!,
      code_verifier: verifier,
    }),
  );
  assert.throws(
    () =>
      provider.exchangeCode(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: testClient.clientId,
          redirect_uri: testClient.redirectUris[0]!,
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
          client_id: testClient.clientId,
          redirect_uri: testClient.redirectUris[0]!,
          code_challenge: pkceS256("verifier"),
          code_challenge_method: "S256",
          approval_code: "wrong",
        }),
      ),
    /Invalid approval code/,
  );
});

test("OAuthDevProvider rejects unregistered client_id and redirect_uri before issuing codes", () => {
  const provider = new OAuthDevProvider({
    publicBaseUrl: "https://workspaceguard.example",
    approvalCode: "approve-local",
    scopes: ["workspace:read"],
    publicClients: [chatgptClient],
  });
  const challenge = pkceS256("verifier");

  assert.throws(
    () =>
      provider.approveAuthorization(
        new URLSearchParams({
          response_type: "code",
          client_id: "https://attacker.example/client.json",
          redirect_uri: chatgptClient.redirectUris[0]!,
          code_challenge: challenge,
          code_challenge_method: "S256",
          approval_code: "approve-local",
        }),
      ),
    /Unregistered OAuth client_id/,
  );

  assert.throws(
    () =>
      provider.approveAuthorization(
        new URLSearchParams({
          response_type: "code",
          client_id: chatgptClient.clientId,
          redirect_uri: "https://attacker.example/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          approval_code: "approve-local",
        }),
      ),
    /Unregistered OAuth redirect_uri/,
  );

  // Prefix / case / query variants must not match; allowlist is exact-string only.
  assert.throws(
    () =>
      provider.approveAuthorization(
        new URLSearchParams({
          response_type: "code",
          client_id: chatgptClient.clientId,
          redirect_uri: `${chatgptClient.redirectUris[0]!}/`,
          code_challenge: challenge,
          code_challenge_method: "S256",
          approval_code: "approve-local",
        }),
      ),
    /Unregistered OAuth redirect_uri/,
  );
});
