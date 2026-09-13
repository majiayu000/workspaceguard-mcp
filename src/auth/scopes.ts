import { AsyncLocalStorage } from "node:async_hooks";

export const WORKSPACE_SCOPE_READ = "workspace:read";
export const WORKSPACE_SCOPE_WRITE = "workspace:write";
export const WORKSPACE_SCOPE_SHELL = "workspace:shell";

export const ALL_WORKSPACE_SCOPES = [
  WORKSPACE_SCOPE_READ,
  WORKSPACE_SCOPE_WRITE,
  WORKSPACE_SCOPE_SHELL,
] as const;

export type WorkspaceScope = (typeof ALL_WORKSPACE_SCOPES)[number];

/**
 * MCP tool name → OAuth scopes that satisfy the tool.
 * A caller needs any one of the listed scopes (OR), not all of them.
 */
export const TOOL_REQUIRED_SCOPES: Readonly<Record<string, readonly WorkspaceScope[]>> = {
  workspaceguard_info: [WORKSPACE_SCOPE_READ],
  policy_describe: [WORKSPACE_SCOPE_READ],
  echo: [WORKSPACE_SCOPE_READ],
  // Prerequisite for obtaining a workspaceId; any capability scope may open.
  workspace_open: [...ALL_WORKSPACE_SCOPES],
  workspace_status: [WORKSPACE_SCOPE_READ],
  file_read: [WORKSPACE_SCOPE_READ],
  directory_list: [WORKSPACE_SCOPE_READ],
  search_text: [WORKSPACE_SCOPE_READ],
  // Git status/diff can execute repository filters/hooks; require shell.
  git_status: [WORKSPACE_SCOPE_SHELL],
  git_diff: [WORKSPACE_SCOPE_SHELL],
  task_status: [WORKSPACE_SCOPE_READ],
  snapshot_create: [WORKSPACE_SCOPE_READ],
  file_write: [WORKSPACE_SCOPE_WRITE],
  task_start: [WORKSPACE_SCOPE_WRITE],
  task_update: [WORKSPACE_SCOPE_WRITE],
  checkpoint_create: [WORKSPACE_SCOPE_WRITE],
  shell_run: [WORKSPACE_SCOPE_SHELL],
  verification_run: [WORKSPACE_SCOPE_SHELL],
};

/**
 * Tools that require every listed scope (AND).
 * Used when a mutation also discloses read-protected content or comparison oracles.
 */
export const TOOL_REQUIRED_ALL_SCOPES: Readonly<Record<string, readonly WorkspaceScope[]>> = {
  // Content-match edits disclose whether oldText exists / is unique.
  file_edit: [WORKSPACE_SCOPE_READ, WORKSPACE_SCOPE_WRITE],
  // Drift responses include paths, sizes, and content hashes.
  drift_check: [WORKSPACE_SCOPE_READ, WORKSPACE_SCOPE_WRITE],
};

const grantedScopesStore = new AsyncLocalStorage<ReadonlySet<string>>();

export type AuthenticatedIdentity = {
  readonly scopes: readonly string[];
};

export function parseScopeString(scope: string | undefined | null): string[] {
  if (scope === undefined || scope === null || scope.trim().length === 0) return [];
  return scope.split(/\s+/).filter(Boolean);
}

export function hasScope(granted: Iterable<string>, required: string): boolean {
  for (const scope of granted) {
    if (scope === required) return true;
  }
  return false;
}

export function hasAnyScope(granted: Iterable<string>, required: readonly string[]): boolean {
  for (const scope of required) {
    if (hasScope(granted, scope)) return true;
  }
  return false;
}

export function assertHasScope(granted: Iterable<string>, required: string): void {
  if (hasScope(granted, required)) return;
  throw new Error(`Insufficient scope: requires ${required}`);
}

export function assertHasAnyScope(granted: Iterable<string>, required: readonly string[]): void {
  if (hasAnyScope(granted, required)) return;
  if (required.length === 1) {
    throw new Error(`Insufficient scope: requires ${required[0]}`);
  }
  throw new Error(`Insufficient scope: requires one of ${required.join(", ")}`);
}

export function hasAllScopes(granted: Iterable<string>, required: readonly string[]): boolean {
  if (required.length === 0) return false;
  for (const scope of required) {
    if (!hasScope(granted, scope)) return false;
  }
  return true;
}

export function assertHasAllScopes(granted: Iterable<string>, required: readonly string[]): void {
  if (required.length === 0) {
    throw new Error("Insufficient scope: no scopes configured");
  }
  const missing = required.filter((scope) => !hasScope(granted, scope));
  if (missing.length === 0) return;
  if (missing.length === 1) {
    throw new Error(`Insufficient scope: requires ${missing[0]}`);
  }
  throw new Error(`Insufficient scope: requires all of ${required.join(", ")}`);
}

/** Primary (first) required scope for a tool, if mapped. */
export function requiredScopeForTool(toolName: string): WorkspaceScope | undefined {
  return requiredScopesForTool(toolName)?.[0];
}

export function requiredScopesForTool(toolName: string): readonly WorkspaceScope[] | undefined {
  return TOOL_REQUIRED_ALL_SCOPES[toolName] ?? TOOL_REQUIRED_SCOPES[toolName];
}

export function assertToolAllowed(granted: Iterable<string>, toolName: string): void {
  const allRequired = TOOL_REQUIRED_ALL_SCOPES[toolName];
  if (allRequired !== undefined) {
    assertHasAllScopes(granted, allRequired);
    return;
  }
  const required = TOOL_REQUIRED_SCOPES[toolName];
  if (required === undefined) {
    throw new Error(`Insufficient scope: unknown tool ${toolName}`);
  }
  assertHasAnyScope(granted, required);
}

export function runWithGrantedScopes<T>(scopes: readonly string[], fn: () => T): T {
  return grantedScopesStore.run(new Set(scopes), fn);
}

export function getRequestGrantedScopes(): ReadonlySet<string> | undefined {
  return grantedScopesStore.getStore();
}

export function resolveGrantedScopes(override?: Iterable<string>): ReadonlySet<string> {
  const fromRequest = getRequestGrantedScopes();
  if (fromRequest !== undefined) return fromRequest;
  if (override !== undefined) return new Set(override);
  return new Set(ALL_WORKSPACE_SCOPES);
}

export function assertGrantedToolScope(toolName: string, override?: Iterable<string>): void {
  assertToolAllowed(resolveGrantedScopes(override), toolName);
}
