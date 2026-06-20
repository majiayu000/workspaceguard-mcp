import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";
import { VERSION } from "../version.js";
import { asStructured, errorResult, textResult } from "./responses.js";
import type { ToolContext } from "./tool-context.js";

export function registerCoreTools(
  server: McpServer,
  { auditLog, config, snapshots, tasks, verifications, workspaces }: ToolContext,
): void {
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
    async () =>
      textResult(`WorkspaceGuard ${VERSION}`, {
        name: "workspaceguard",
        version: VERSION,
        transport: config.transport,
        allowedRoots: config.allowedRoots,
      }),
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
    async () =>
      textResult("Default policy: local owner, narrow roots, shell allowed with audit in future milestones.", {
        result: "default",
        shell: "allowed_with_timeout",
        writes: "workspace_only",
        restore: "not_implemented",
      }),
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
        return textResult(message, { result: message });
      } catch (error) {
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
        const task = tasks.updateTask({ taskId: taskId as never, status, note });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "task_update",
          taskId: task.taskId,
          status: task.status,
        });
        return textResult(`Updated task ${task.taskId}`, asStructured(task));
      } catch (error) {
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
        if (taskId) {
          const task = tasks.getTask(taskId as never);
          return textResult(`Task ${task.taskId}: ${task.status}`, { task });
        }
        const allTasks = tasks.listTasks();
        return textResult(`${allTasks.length} task(s).`, { tasks: allTasks });
      } catch (error) {
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
        files: z.array(z.object({ path: z.string(), sizeBytes: z.number(), sha256: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, reason }) => {
      try {
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
        return errorResult(error);
      }
    },
  );
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
