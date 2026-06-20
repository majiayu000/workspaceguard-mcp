import type { AuditLog } from "../audit/audit-log.js";

type FailureAuditContext = {
  workspaceId?: string;
  path?: string;
  command?: string;
  taskId?: string;
  snapshotId?: string;
  checkpointId?: string;
};

export async function auditToolFailure(
  auditLog: AuditLog,
  tool: string,
  error: unknown,
  context: FailureAuditContext = {},
): Promise<void> {
  await auditLog.append({
    at: new Date().toISOString(),
    tool,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    ...definedContext(context),
  });
}

function definedContext(context: FailureAuditContext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
