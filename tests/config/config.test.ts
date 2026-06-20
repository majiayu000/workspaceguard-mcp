import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/config.js";

test("loadConfig parses CLI options", () => {
  const config = loadConfig(
    ["--transport", "http", "--host", "127.0.0.1", "--port", "9999", "--allowed-roots", "/tmp,/var/tmp"],
    {},
  );

  assert.equal(config.transport, "http");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9999);
  assert.deepEqual(config.allowedRoots, ["/tmp", "/var/tmp"]);
});

test("loadConfig rejects invalid transport", () => {
  assert.throws(() => loadConfig(["--transport", "websocket"], {}), /Invalid transport/);
});
