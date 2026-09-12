import { join } from "node:path";
import { AuditLog } from "../audit/audit-log.js";
import { assertGrantedToolScope, resolveGrantedScopes } from "../auth/scopes.js";
import { CheckpointService } from "../checkpoints/checkpoint-service.js";
import type { WorkspaceGuardConfig } from "../config/config.js";
import { DriftService } from "../drift/drift-service.js";
import { FileService } from "../files/file-service.js";
import { SnapshotService } from "../snapshots/snapshot-service.js";
import { TaskService } from "../tasks/task-service.js";
import { VerificationService } from "../verification/verification-service.js";
import { WorkspaceRegistry } from "../workspace/workspace-registry.js";

export type ToolContext = {
  config: WorkspaceGuardConfig;
  workspaces: WorkspaceRegistry;
  auditLog: AuditLog;
  checkpoints: CheckpointService;
  drift: DriftService;
  files: FileService;
  snapshots: SnapshotService;
  tasks: TaskService;
  verifications: VerificationService;
  /**
   * Explicit granted scopes for tests or bound sessions.
   * When unset, request AsyncLocalStorage scopes or full workspace scopes apply.
   */
  grantedScopes?: Iterable<string>;
};

export function createToolContext(config: WorkspaceGuardConfig): ToolContext {
  return {
    config,
    workspaces: new WorkspaceRegistry({ allowedRoots: config.allowedRoots }),
    auditLog: new AuditLog(join(config.stateDir, "audit.jsonl")),
    checkpoints: new CheckpointService(),
    drift: new DriftService(),
    files: new FileService(config.allowedRoots),
    snapshots: new SnapshotService(),
    tasks: new TaskService(),
    verifications: new VerificationService(),
  };
}

export function requireToolScope(context: ToolContext, toolName: string): void {
  assertGrantedToolScope(toolName, context.grantedScopes);
}

export function currentGrantedScopes(context: ToolContext): ReadonlySet<string> {
  return resolveGrantedScopes(context.grantedScopes);
}
