import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getGitDiff, getGitStatus } from "../git/git-service.js";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";
import { runShellCommand } from "../shell/shell-runner.js";
import { asStructured, errorResult, textResult } from "./responses.js";
import type { ToolContext } from "./tool-context.js";

export function registerShellGitTools(server: McpServer, { auditLog, workspaces }: ToolContext): void {
  server.registerTool(
    "shell_run",
    {
      title: "Run shell command",
      description: "Run a structured command array inside an open workspace. This is real local execution.",
      inputSchema: {
        workspaceId: z.string(),
        command: z.string().describe("Executable name or absolute executable path."),
        args: z.array(z.string()).default([]).describe("Command arguments. No shell interpolation is used."),
        workingDirectory: z.string().optional().describe("Directory relative to the workspace root."),
        timeoutMs: z.number().int().positive().max(300_000).default(30_000),
      },
      outputSchema: {
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number().nullable(),
        signal: z.string().nullable(),
        durationMs: z.number(),
        timedOut: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, command, args, workingDirectory, timeoutMs }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const cwd = workingDirectory
          ? (await resolvePathWithinAllowedRoots(workingDirectory, [workspace.root], {
              baseDir: workspace.root,
              mustExist: true,
            })).path
          : workspace.root;
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "shell_run",
          workspaceId,
          command,
          argsLength: args.length,
          cwd,
        });
        const result = await runShellCommand({ command, args, cwd, timeoutMs });
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "shell_run_result",
          workspaceId,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        });
        return textResult(result.stdout || result.stderr || `exit ${result.exitCode}`, asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "git_status",
    {
      title: "Git status",
      description: "Run git status --porcelain=v1 inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
      },
      outputSchema: {
        porcelain: z.string(),
        exitCode: z.number().nullable(),
        stderr: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await getGitStatus({ cwd: workspace.root });
        return textResult(result.porcelain || "Clean working tree.", asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "git_diff",
    {
      title: "Git diff",
      description: "Run git diff --no-color inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
      },
      outputSchema: {
        diff: z.string(),
        exitCode: z.number().nullable(),
        stderr: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await getGitDiff({ cwd: workspace.root });
        return textResult(result.diff || "No diff.", asStructured(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
