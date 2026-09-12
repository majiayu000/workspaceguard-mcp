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

test("secure proxy rejects tools/call that exceed granted scopes", async () => {
  let upstreamHits = 0;
  const upstream = await listenServer(
    createServer((_req, res) => {
      upstreamHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
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
    const deniedWrite = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": "Bearer outer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "file_write", arguments: {} },
      }),
    });
    assert.equal(deniedWrite.status, 403);
    const deniedBody = (await deniedWrite.json()) as { error?: { message?: string }; id?: unknown };
    assert.match(String(deniedBody.error?.message), /workspace:write/);
    assert.equal(deniedBody.id, 7);
    assert.equal(upstreamHits, 0);

    const allowedRead = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": "Bearer outer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "file_read", arguments: {} },
      }),
    });
    assert.equal(allowedRead.status, 200);
    assert.equal(upstreamHits, 1);
  } finally {
    await closeServer(proxy.server);
    await closeServer(upstream.server);
  }
});

test("secure proxy rejects out-of-scope tools/call inside JSON-RPC batches", async () => {
  let upstreamHits = 0;
  const upstream = await listenServer(
    createServer((_req, res) => {
      upstreamHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
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
    const deniedBatch = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": "Bearer outer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "shell_run", arguments: {} },
        },
      ]),
    });
    assert.equal(deniedBatch.status, 403);
    const deniedBody = (await deniedBatch.json()) as { error?: { message?: string }; id?: unknown };
    assert.match(String(deniedBody.error?.message), /workspace:shell/);
    assert.equal(deniedBody.id, 2);
    assert.equal(upstreamHits, 0);

    const allowedBatch = await fetch(`${proxy.url}/mcp`, {
      method: "POST",
      headers: {
        "authorization": "Bearer outer-token",
        "content-type": "application/json",
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 3, method: "ping" },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "file_read", arguments: {} },
        },
      ]),
    });
    assert.equal(allowedBatch.status, 200);
    assert.equal(upstreamHits, 1);
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
