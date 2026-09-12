import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskId } from "../core/ids.js";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";
import type { SnapshotId } from "../snapshots/snapshot-service.js";
import { VERSION } from "../version.js";
import { auditToolFailure } from "./audit-tool-failure.js";
import { asStructured, errorResult, textResult } from "./responses.js";
import { requireToolScope, type ToolContext } from "./tool-context.js";

export function registerCoreTools(server: McpServer, context: ToolContext): void {
  const { auditLog, checkpoints, config, drift, snapshots, tasks, verifications, workspaces } = context;
  server.registerTool(
    "workspaceguard_info",
    {
      title: "WorkspaceGuard info",
      description: "Return WorkspaceGuard runtime configuration summary.",
      inputSchema: {},
      outputSchema: {
        name: z.string(),
        version: z.string(),
        transport: z.string(),
        allowedRoots: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        requireToolScope(context, "workspaceguard_info");
        return textResult(`WorkspaceGuard ${VERSION}`, {
          name: "workspaceguard",
          version: VERSION,
          transport: config.transport,
          allowedRoots: config.allowedRoots,
        });
      } catch (error) {
        await auditToolFailure(auditLog, "workspaceguard_info", error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "policy_describe",
    {
      title: "Describe active policy",
      description: "Show the current local policy profile for this WorkspaceGuard server.",
      inputSchema: {},
      outputSchema: {
        result: z.string(),
        shell: z.string(),
        writes: z.string(),
        restore: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        requireToolScope(context, "policy_describe");
        return textResult("Default policy: local owner, narrow roots, shell allowed with audit in future milestones.", {
          result: "default",
          shell: "allowed_with_timeout",
          writes: "workspace_only",
          restore: "not_implemented",
        });
      } catch (error) {
        await auditToolFailure(auditLog, "policy_describe", error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Development smoke-test tool.",
      inputSchema: {
        message: z.string().describe("Message to echo."),
      },
      outputSchema: {
        result: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ message }) => {
      try {
        requireToolScope(context, "echo");
        return textResult(message, { result: message });
      } catch (error) {
        await auditToolFailure(auditLog, "echo", error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "task_start",
    {
      title: "Start task",
      description: "Start an in-memory task under an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        objective: z.string(),
        constraints: z.array(z.string()).optional(),
      },
      outputSchema: taskOutputSchema(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ workspaceId, objective, constraints }) => {
      try {
        requireToolScope(context, "task_start");
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const task = tasks.startTask({
          workspaceId: workspace.workspaceId,
          objective,
          constraints,
        });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "task_start",
          workspaceId,
          taskId: task.taskId,
        });
        return textResult(`Started task ${task.taskId}`, asStructured(task));
      } catch (error) {
        await auditToolFailure(auditLog, "task_start", error, { workspaceId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "task_update",
    {
      title: "Update task",
      description: "Update task status or append a note.",
      inputSchema: {
        taskId: z.string(),
        status: z.enum(["active", "blocked", "completed", "cancelled"]).optional(),
        note: z.string().optional(),
      },
      outputSchema: taskOutputSchema(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ taskId, status, note }) => {
      try {
        requireToolScope(context, "task_update");
        const task = tasks.updateTask({ taskId: taskId as never, status, note });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "task_update",
          taskId: task.taskId,
          status: task.status,
        });
        return textResult(`Updated task ${task.taskId}`, asStructured(task));
      } catch (error) {
        await auditToolFailure(auditLog, "task_update", error, { taskId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "task_status",
    {
      title: "Task status",
      description: "Return one task by id, or all known in-memory tasks.",
      inputSchema: {
        taskId: z.string().optional(),
      },
      outputSchema: {
        task: z.unknown().optional(),
        tasks: z.array(z.unknown()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId }) => {
      try {
        requireToolScope(context, "task_status");
        if (taskId) {
          const task = tasks.getTask(taskId as never);
          return textResult(`Task ${task.taskId}: ${task.status}`, { task });
        }
        const allTasks = tasks.listTasks();
        return textResult(`${allTasks.length} task(s).`, { tasks: allTasks });
      } catch (error) {
        await auditToolFailure(auditLog, "task_status", error, { taskId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "snapshot_create",
    {
      title: "Create snapshot",
      description: "Create a file manifest snapshot for an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        reason: z.string().optional(),
      },
      outputSchema: {
        snapshotId: z.string(),
        root: z.string(),
        createdAt: z.string(),
        reason: z.string().optional(),
        files: z.array(snapshotFileEntryOutputSchema()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, reason }) => {
      try {
        requireToolScope(context, "snapshot_create");
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const snapshot = await snapshots.createFileManifestSnapshot({
          workspaceRoot: workspace.root,
          allowedRoots: config.allowedRoots,
          reason,
        });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "snapshot_create",
          workspaceId,
          snapshotId: snapshot.snapshotId,
          files: snapshot.files.length,
        });
        return textResult(
          `Snapshot ${snapshot.snapshotId} has ${snapshot.files.length} file(s).`,
          asStructured(snapshot),
        );
      } catch (error) {
        await auditToolFailure(auditLog, "snapshot_create", error, { workspaceId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "checkpoint_create",
    {
      title: "Create checkpoint",
      description:
        "Record a named checkpoint for an existing snapshot id. This creates metadata only; restore is not implemented and snapshot existence is not validated yet.",
      inputSchema: {
        workspaceId: z.string(),
        snapshotId: z.string(),
        label: z.string(),
        taskId: z.string().optional(),
        reason: z.string().optional(),
      },
      outputSchema: checkpointOutputSchema(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, snapshotId, label, taskId, reason }) => {
      try {
        requireToolScope(context, "checkpoint_create");
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const checkpoint = checkpoints.createCheckpoint({
          workspaceId: workspace.workspaceId,
          snapshotId: snapshotId as SnapshotId,
          label,
          ...(taskId === undefined ? {} : { taskId: taskId as TaskId }),
          ...(reason === undefined ? {} : { reason }),
        });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "checkpoint_create",
          workspaceId,
          checkpointId: checkpoint.checkpointId,
          snapshotId: checkpoint.snapshotId,
          taskId: checkpoint.taskId,
        });
        return textResult(
          `Created checkpoint ${checkpoint.checkpointId}. Restore is not implemented.`,
          asStructured(checkpoint),
        );
      } catch (error) {
        await auditToolFailure(auditLog, "checkpoint_create", error, { workspaceId, snapshotId, taskId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "drift_check",
    {
      title: "Check workspace drift",
      description:
        "Create a fresh snapshot and compare it with the previous drift_check snapshot for the workspace. The first call records the baseline and reports no drift.",
      inputSchema: {
        workspaceId: z.string(),
        baselineReason: z.string().optional(),
        currentReason: z.string().optional(),
      },
      outputSchema: driftOutputSchema(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, baselineReason, currentReason }) => {
      try {
        requireToolScope(context, "drift_check");
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const snapshotReason = baselineReason ?? currentReason;
        const currentSnapshot = await snapshots.createFileManifestSnapshot({
          workspaceRoot: workspace.root,
          allowedRoots: config.allowedRoots,
          reason: snapshotReason,
        });

        const result = drift.checkWorkspaceDrift({
          workspaceId: workspace.workspaceId,
          current: currentSnapshot,
        });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "drift_check",
          workspaceId,
          baselineSnapshotId: result.baselineSnapshotId,
          currentSnapshotId: currentSnapshot.snapshotId,
          changed: result.changed,
          added: result.added.length,
          modified: result.modified.length,
          deleted: result.deleted.length,
        });

        if (result.baselineSnapshotId === undefined) {
          return textResult(
            `Recorded baseline snapshot ${currentSnapshot.snapshotId}; no previous baseline.`,
            asStructured(result),
          );
        }

        return textResult(
          result.changed
            ? `Drift detected: ${result.added.length} added, ${result.modified.length} modified, ${result.deleted.length} deleted.`
            : "No drift detected.",
          asStructured(result),
        );
      } catch (error) {
        await auditToolFailure(auditLog, "drift_check", error, { workspaceId });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "verification_run",
    {
      title: "Run verification",
      description: "Run a structured verification command inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        taskId: z.string().optional(),
        command: z.string(),
        args: z.array(z.string()).default([]),
        workingDirectory: z.string().optional(),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      },
      outputSchema: {
        verificationId: z.string(),
        workspaceId: z.string(),
        taskId: z.string().optional(),
        status: z.string(),
        command: z.string(),
        args: z.array(z.string()),
        cwd: z.string(),
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number().nullable(),
        durationMs: z.number(),
        createdAt: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, taskId, command, args, workingDirectory, timeoutMs }) => {
      try {
        requireToolScope(context, "verification_run");
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const cwd = workingDirectory
          ? (await resolvePathWithinAllowedRoots(workingDirectory, [workspace.root], {
              baseDir: workspace.root,
              mustExist: true,
            })).path
          : workspace.root;
        const verification = await verifications.runVerification({
          workspaceId: workspace.workspaceId,
          taskId: taskId as never,
          cwd,
          command,
          args,
          timeoutMs,
        });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "verification_run",
          workspaceId,
          taskId,
          verificationId: verification.verificationId,
          status: verification.status,
        });
        return textResult(
          verification.stdout || verification.stderr || `verification ${verification.status}`,
          asStructured(verification),
        );
      } catch (error) {
        await auditToolFailure(auditLog, "verification_run", error, { workspaceId, taskId, command });
        return errorResult(error);
      }
    },
  );
}

function snapshotFileEntryOutputSchema() {
  return z.object({ path: z.string(), sizeBytes: z.number(), sha256: z.string() });
}

function checkpointOutputSchema() {
  return {
    checkpointId: z.string(),
    workspaceId: z.string(),
    taskId: z.string().optional(),
    snapshotId: z.string(),
    label: z.string(),
    reason: z.string().optional(),
    createdAt: z.string(),
  };
}

function driftOutputSchema() {
  return {
    baselineSnapshotId: z.string().optional(),
    currentSnapshotId: z.string(),
    changed: z.boolean(),
    added: z.array(snapshotFileEntryOutputSchema()),
    modified: z.array(snapshotFileEntryOutputSchema()),
    deleted: z.array(snapshotFileEntryOutputSchema()),
  };
}

function taskOutputSchema() {
  return {
    taskId: z.string(),
    workspaceId: z.string(),
    objective: z.string(),
    constraints: z.array(z.string()),
    status: z.string(),
    notes: z.array(z.object({ note: z.string(), createdAt: z.string() })),
    createdAt: z.string(),
    updatedAt: z.string(),
  };
}
