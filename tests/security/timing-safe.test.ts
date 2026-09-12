import assert from "node:assert/strict";
import test from "node:test";

import { timingSafeEqualString } from "../../src/security/timing-safe.js";

test("timingSafeEqualString accepts equal strings", () => {
  assert.equal(timingSafeEqualString("secret-token", "secret-token"), true);
});

test("timingSafeEqualString rejects equal-length mismatches", () => {
  assert.equal(timingSafeEqualString("secret-taken", "secret-token"), false);
});

test("timingSafeEqualString rejects length mismatches without early return path", () => {
  assert.equal(timingSafeEqualString("short", "secret-token"), false);
  assert.equal(timingSafeEqualString("secret-token-extra", "secret-token"), false);
  assert.equal(timingSafeEqualString("", "secret-token"), false);
});
