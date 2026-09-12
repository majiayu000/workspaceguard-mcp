import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, loadProxyConfig } from "../../src/config/config.js";

test("loadConfig parses CLI options", () => {
  const config = loadConfig(
    [
      "--transport",
      "http",
      "--host",
      "127.0.0.1",
      "--port",
      "9999",
      "--allowed-roots",
      "/tmp,/var/tmp",
      "--allowed-origins",
      "https://chatgpt.com,https://gemini.google.com",
      "--bearer-token",
      "secret-token",
    ],
    {},
  );

  assert.equal(config.transport, "http");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9999);
  assert.equal(config.authMode, "bearer");
  assert.deepEqual(config.allowedRoots, ["/tmp", "/var/tmp"]);
  assert.deepEqual(config.allowedOrigins, ["https://chatgpt.com", "https://gemini.google.com"]);
  assert.equal(config.bearerToken, "secret-token");
});

test("loadConfig rejects invalid transport", () => {
  assert.throws(() => loadConfig(["--transport", "websocket"], {}), /Invalid transport/);
});

test("loadConfig requires bearer auth for HTTP transport", () => {
  assert.throws(
    () => loadConfig(["--transport", "http"], {}),
    /WORKSPACEGUARD_TOKEN or --bearer-token is required/,
  );
});

test("loadConfig allows stdio without bearer auth", () => {
  const config = loadConfig(["--transport", "stdio"], {});

  assert.equal(config.transport, "stdio");
  assert.equal(config.authMode, "bearer");
  assert.equal(config.bearerToken, undefined);
});

test("loadConfig parses OAuth dev HTTP options", () => {
  const config = loadConfig(
    [
      "--transport",
      "http",
      "--auth-mode",
      "oauth-dev",
      "--public-base-url",
      "https://workspaceguard.example/",
      "--oauth-approval-code",
      "approve-local",
      "--oauth-scopes",
      "workspace:read,workspace:write",
    ],
    {},
  );

  assert.equal(config.authMode, "oauth-dev");
  assert.equal(config.publicBaseUrl, "https://workspaceguard.example");
  assert.equal(config.oauthApprovalCode, "approve-local");
  assert.deepEqual(config.oauthScopes, ["workspace:read", "workspace:write"]);
  assert.deepEqual(config.oauthPublicClients, [
    {
      clientId: "https://chatgpt.com/oauth/client.json",
      redirectUris: ["https://chatgpt.com/oauth/callback"],
    },
  ]);
});

test("loadConfig parses OAuth public client allowlist overrides", () => {
  const config = loadConfig(
    [
      "--transport",
      "http",
      "--auth-mode",
      "oauth-dev",
      "--public-base-url",
      "https://workspaceguard.example",
      "--oauth-approval-code",
      "approve-local",
      "--oauth-public-clients",
      "https://client.example/oauth.json|https://client.example/callback|https://client.example/alt",
    ],
    {},
  );

  assert.deepEqual(config.oauthPublicClients, [
    {
      clientId: "https://client.example/oauth.json",
      redirectUris: ["https://client.example/callback", "https://client.example/alt"],
    },
  ]);
});

test("loadConfig requires OAuth metadata inputs for OAuth dev HTTP mode", () => {
  assert.throws(
    () => loadConfig(["--transport", "http", "--auth-mode", "oauth-dev"], {}),
    /public-base-url is required/,
  );
  assert.throws(
    () =>
      loadConfig(
        ["--transport", "http", "--auth-mode", "oauth-dev", "--public-base-url", "https://workspaceguard.example"],
        {},
      ),
    /oauth-approval-code is required/,
  );
});

test("loadProxyConfig parses secure proxy options", () => {
  const config = loadProxyConfig(
    [
      "--host",
      "127.0.0.1",
      "--port",
      "9998",
      "--target-url",
      "http://127.0.0.1:8787/mcp",
      "--target-bearer-token",
      "inner-token",
      "--auth-mode",
      "bearer",
      "--bearer-token",
      "outer-token",
    ],
    {},
  );

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9998);
  assert.equal(config.authMode, "bearer");
  assert.equal(config.targetUrl, "http://127.0.0.1:8787/mcp");
  assert.equal(config.targetBearerToken, "inner-token");
  assert.equal(config.bearerToken, "outer-token");
});
