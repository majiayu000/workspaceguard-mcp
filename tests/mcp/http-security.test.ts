import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOriginAllowed,
  authorizeBearer,
  isOriginAllowed,
} from "../../src/mcp/http-security.js";

test("authorizeBearer rejects requests when no token is configured", () => {
  assert.equal(authorizeBearer(undefined, undefined), false);
  assert.equal(authorizeBearer("Bearer anything", undefined), false);
});

test("authorizeBearer requires the exact bearer token when configured", () => {
  assert.equal(authorizeBearer("Bearer secret-token", "secret-token"), true);
  assert.equal(authorizeBearer("Bearer wrong-token", "secret-token"), false);
});

test("authorizeBearer rejects missing Authorization header", () => {
  assert.equal(authorizeBearer(undefined, "secret-token"), false);
});

test("authorizeBearer rejects non-Bearer Authorization schemes", () => {
  assert.equal(authorizeBearer("Basic secret-token", "secret-token"), false);
  assert.equal(authorizeBearer("bearer secret-token", "secret-token"), false);
  assert.equal(authorizeBearer("secret-token", "secret-token"), false);
});

test("authorizeBearer rejects length-mismatched bearer tokens", () => {
  assert.equal(authorizeBearer("Bearer short", "secret-token"), false);
  assert.equal(authorizeBearer("Bearer secret-token-extra", "secret-token"), false);
});

test("authorizeBearer rejects equal-length mismatched bearer tokens", () => {
  assert.equal(authorizeBearer("Bearer secret-taken", "secret-token"), false);
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
