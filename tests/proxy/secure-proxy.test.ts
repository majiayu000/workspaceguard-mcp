import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createSecureProxyApp } from "../../src/proxy/secure-proxy.js";

test("secure proxy authenticates public requests and injects upstream bearer token", async () => {
  let upstreamAuthorization: string | undefined;
  let upstreamBody = "";
  const upstream = await listenServer(
    createServer((req, res) => {
      upstreamAuthorization = req.headers.authorization;
      req.on("data", (chunk) => {
        upstreamBody += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "session-1" });
        res.end(JSON.stringify({ ok: true }));
      });
    }),
  );

  const proxyApp = createSecureProxyApp({
    host: "127.0.0.1",
    port: 0,
    authMode: "bearer",
    targetUrl: `${upstream.url}/mcp`,
    targetBearerToken: "inner-token",
    allowedOrigins: [],
    bearerToken: "outer-token",
    oauthScopes: ["workspace:read"],
  });
  const proxy = await listenApp(proxyApp);

  try {
    const unauthorizedResponse = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(unauthorizedResponse.status, 401);

    const authorizedResponse = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": "Bearer outer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    assert.equal(authorizedResponse.status, 200);
    assert.equal(authorizedResponse.headers.get("mcp-session-id"), "session-1");
    assert.equal(upstreamAuthorization, "Bearer inner-token");
    assert.deepEqual(JSON.parse(upstreamBody), { jsonrpc: "2.0", id: 1, method: "ping" });
  } finally {
    await closeServer(proxy.server);
    await closeServer(upstream.server);
  }
});

type ListenableApp = {
  listen(port: number, host: string, callback: () => void): Server;
};

async function listenApp(app: ListenableApp): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
    started.on("error", reject);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function listenServer(server: Server): Promise<{ server: Server; url: string }> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
