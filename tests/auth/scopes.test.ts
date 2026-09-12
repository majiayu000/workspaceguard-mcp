import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_WORKSPACE_SCOPES,
  assertHasScope,
  assertToolAllowed,
  hasScope,
  parseScopeString,
  requiredScopeForTool,
  resolveGrantedScopes,
  runWithGrantedScopes,
  WORKSPACE_SCOPE_READ,
  WORKSPACE_SCOPE_SHELL,
  WORKSPACE_SCOPE_WRITE,
} from "../../src/auth/scopes.js";

test("parseScopeString splits whitespace-delimited scopes", () => {
  assert.deepEqual(parseScopeString("workspace:read workspace:write"), [
    "workspace:read",
    "workspace:write",
  ]);
  assert.deepEqual(parseScopeString(""), []);
  assert.deepEqual(parseScopeString(null), []);
});

test("hasScope and assertHasScope enforce exact scope membership", () => {
  const granted = ["workspace:read", "workspace:write"];
  assert.equal(hasScope(granted, WORKSPACE_SCOPE_READ), true);
  assert.equal(hasScope(granted, WORKSPACE_SCOPE_SHELL), false);
  assert.doesNotThrow(() => assertHasScope(granted, WORKSPACE_SCOPE_WRITE));
  assert.throws(() => assertHasScope(granted, WORKSPACE_SCOPE_SHELL), /Insufficient scope: requires workspace:shell/);
});

test("assertToolAllowed maps tools to read/write/shell scopes", () => {
  assert.equal(requiredScopeForTool("file_read"), WORKSPACE_SCOPE_READ);
  assert.equal(requiredScopeForTool("file_write"), WORKSPACE_SCOPE_WRITE);
  assert.equal(requiredScopeForTool("shell_run"), WORKSPACE_SCOPE_SHELL);

  assert.doesNotThrow(() => assertToolAllowed(["workspace:read"], "file_read"));
  assert.throws(() => assertToolAllowed(["workspace:read"], "file_write"), /workspace:write/);
  assert.throws(() => assertToolAllowed(["workspace:write"], "shell_run"), /workspace:shell/);
  assert.doesNotThrow(() => assertToolAllowed(["workspace:shell"], "shell_run"));
});

test("resolveGrantedScopes prefers request ALS, then override, then full scopes", () => {
  assert.deepEqual([...resolveGrantedScopes()].sort(), [...ALL_WORKSPACE_SCOPES].sort());
  assert.deepEqual([...resolveGrantedScopes(["workspace:read"])], ["workspace:read"]);
  runWithGrantedScopes(["workspace:write"], () => {
    assert.deepEqual([...resolveGrantedScopes(["workspace:read"])], ["workspace:write"]);
  });
});
