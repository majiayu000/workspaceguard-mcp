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

/** MCP tool name → minimum OAuth scope required to invoke it. */
export const TOOL_REQUIRED_SCOPES: Readonly<Record<string, WorkspaceScope>> = {
  workspaceguard_info: WORKSPACE_SCOPE_READ,
  policy_describe: WORKSPACE_SCOPE_READ,
  echo: WORKSPACE_SCOPE_READ,
  workspace_open: WORKSPACE_SCOPE_READ,
  workspace_status: WORKSPACE_SCOPE_READ,
  file_read: WORKSPACE_SCOPE_READ,
  directory_list: WORKSPACE_SCOPE_READ,
  search_text: WORKSPACE_SCOPE_READ,
  git_status: WORKSPACE_SCOPE_READ,
  git_diff: WORKSPACE_SCOPE_READ,
  task_status: WORKSPACE_SCOPE_READ,
  snapshot_create: WORKSPACE_SCOPE_READ,
  drift_check: WORKSPACE_SCOPE_READ,
  file_write: WORKSPACE_SCOPE_WRITE,
  file_edit: WORKSPACE_SCOPE_WRITE,
  task_start: WORKSPACE_SCOPE_WRITE,
  task_update: WORKSPACE_SCOPE_WRITE,
  checkpoint_create: WORKSPACE_SCOPE_WRITE,
  shell_run: WORKSPACE_SCOPE_SHELL,
  verification_run: WORKSPACE_SCOPE_SHELL,
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

export function assertHasScope(granted: Iterable<string>, required: string): void {
  if (hasScope(granted, required)) return;
  throw new Error(`Insufficient scope: requires ${required}`);
}

export function requiredScopeForTool(toolName: string): WorkspaceScope | undefined {
  return TOOL_REQUIRED_SCOPES[toolName];
}

export function assertToolAllowed(granted: Iterable<string>, toolName: string): void {
  const required = requiredScopeForTool(toolName);
  if (required === undefined) return;
  assertHasScope(granted, required);
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
