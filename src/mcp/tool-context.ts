import { join } from "node:path";
import { AuditLog } from "../audit/audit-log.js";
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
