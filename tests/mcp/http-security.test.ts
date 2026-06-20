import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOriginAllowed,
  authorizeBearer,
  isOriginAllowed,
} from "../../src/mcp/http-security.js";

test("authorizeBearer allows requests when no token is configured", () => {
  assert.equal(authorizeBearer(undefined, undefined), true);
  assert.equal(authorizeBearer("Bearer anything", undefined), true);
});

test("authorizeBearer requires the exact bearer token when configured", () => {
  assert.equal(authorizeBearer("Bearer secret-token", "secret-token"), true);
  assert.equal(authorizeBearer("Bearer wrong-token", "secret-token"), false);
});

test("isOriginAllowed allows requests without an Origin header", () => {
  assert.equal(isOriginAllowed(undefined, []), true);
});

test("isOriginAllowed allows exact origin matches", () => {
  assert.equal(
    isOriginAllowed("https://example.test", ["https://example.test"]),
    true,
  );
});

test("isOriginAllowed allows wildcard origin configuration", () => {
  assert.equal(isOriginAllowed("https://example.test", ["*"]), true);
});

test("assertOriginAllowed throws for denied origins", () => {
  assert.equal(
    isOriginAllowed("https://blocked.test", ["https://example.test"]),
    false,
  );
  assert.throws(
    () => assertOriginAllowed("https://blocked.test", ["https://example.test"]),
    /Origin not allowed: https:\/\/blocked\.test/,
  );
});
