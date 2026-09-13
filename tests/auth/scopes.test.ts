import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_WORKSPACE_SCOPES,
  assertHasAnyScope,
  assertHasScope,
  assertToolAllowed,
  hasScope,
  parseScopeString,
  requiredScopeForTool,
  requiredScopesForTool,
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
  assert.equal(requiredScopeForTool("drift_check"), WORKSPACE_SCOPE_WRITE);
  assert.equal(requiredScopeForTool("git_status"), WORKSPACE_SCOPE_SHELL);
  assert.equal(requiredScopeForTool("git_diff"), WORKSPACE_SCOPE_SHELL);
  assert.deepEqual(requiredScopesForTool("workspace_open"), [...ALL_WORKSPACE_SCOPES]);

  assert.doesNotThrow(() => assertToolAllowed(["workspace:read"], "file_read"));
  assert.throws(() => assertToolAllowed(["workspace:read"], "file_write"), /workspace:write/);
  assert.throws(() => assertToolAllowed(["workspace:read"], "drift_check"), /workspace:write/);
  assert.throws(() => assertToolAllowed(["workspace:write"], "shell_run"), /workspace:shell/);
  assert.doesNotThrow(() => assertToolAllowed(["workspace:shell"], "shell_run"));
  assert.doesNotThrow(() => assertToolAllowed(["workspace:write"], "drift_check"));
  assert.throws(() => assertToolAllowed(["workspace:read"], "git_status"), /workspace:shell/);
  assert.throws(() => assertToolAllowed(["workspace:read"], "git_diff"), /workspace:shell/);
  assert.doesNotThrow(() => assertToolAllowed(["workspace:shell"], "git_status"));
  assert.doesNotThrow(() => assertToolAllowed(["workspace:shell"], "git_diff"));
});

test("workspace_open accepts any workspace capability scope", () => {
  assert.doesNotThrow(() => assertToolAllowed(["workspace:read"], "workspace_open"));
  assert.doesNotThrow(() => assertToolAllowed(["workspace:write"], "workspace_open"));
  assert.doesNotThrow(() => assertToolAllowed(["workspace:shell"], "workspace_open"));
  assert.throws(
    () => assertToolAllowed([], "workspace_open"),
    /requires one of workspace:read, workspace:write, workspace:shell/,
  );
  assert.doesNotThrow(() =>
    assertHasAnyScope(["workspace:write"], [...ALL_WORKSPACE_SCOPES]),
  );
});

test("assertToolAllowed fails closed for unmapped tools", () => {
  assert.equal(requiredScopeForTool("totally_unknown_tool"), undefined);
  assert.throws(
    () => assertToolAllowed(["workspace:read", "workspace:write", "workspace:shell"], "totally_unknown_tool"),
    /unknown tool totally_unknown_tool/,
  );
});

test("resolveGrantedScopes prefers request ALS, then override, then full scopes", () => {
  assert.deepEqual([...resolveGrantedScopes()].sort(), [...ALL_WORKSPACE_SCOPES].sort());
  assert.deepEqual([...resolveGrantedScopes(["workspace:read"])], ["workspace:read"]);
  runWithGrantedScopes(["workspace:write"], () => {
    assert.deepEqual([...resolveGrantedScopes(["workspace:read"])], ["workspace:write"]);
  });
});
