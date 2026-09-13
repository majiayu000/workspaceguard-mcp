import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hasScope, WORKSPACE_SCOPE_READ } from "../auth/scopes.js";
import type { WorkspaceRecord } from "../workspace/workspace-registry.js";
import { auditToolFailure } from "./audit-tool-failure.js";
import { asStructured, errorResult, textResult } from "./responses.js";
import { currentGrantedScopes, requireToolScope, type ToolContext } from "./tool-context.js";

/**
 * Write/shell tokens may open a workspace for mutation/execution, but instruction
 * file paths and contents are read-protected and require workspace:read.
 */
function workspaceOpenPayload(workspace: WorkspaceRecord, granted: ReadonlySet<string>): WorkspaceRecord {
  if (hasScope(granted, WORKSPACE_SCOPE_READ)) {
    return workspace;
  }
  return {
    ...workspace,
    instructionFiles: [],
    availableInstructionFiles: [],
  };
}

export function registerWorkspaceTools(server: McpServer, context: ToolContext): void {
  const { auditLog, workspaces } = context;
  server.registerTool(
    "workspace_open",
    {
      title: "Open workspace",
      description:
        "Open an allowed local checkout workspace and return a workspaceId. Instruction file contents are included only when workspace:read is granted.",
      inputSchema: {
        path: z.string().describe("Workspace path inside an allowed root."),
        mode: z.enum(["checkout"]).optional().describe("Workspace mode. v0.1 supports checkout only."),
      },
      outputSchema: {
        workspaceId: z.string(),
        root: z.string(),
        mode: z.string(),
        openedAt: z.string(),
        instructionFiles: z.array(z.unknown()),
        availableInstructionFiles: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        requireToolScope(context, "workspace_open");
        const workspace = await workspaces.openWorkspace(input);
        const response = workspaceOpenPayload(workspace, currentGrantedScopes(context));
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "workspace_open",
          workspaceId: workspace.workspaceId,
          root: workspace.root,
        });
        return textResult(`Opened workspace ${workspace.workspaceId}`, asStructured(response));
      } catch (error) {
        await auditToolFailure(auditLog, "workspace_open", error, { path: input.path });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "workspace_status",
    {
      title: "Workspace status",
      description: "Return a known workspace by id, or list open workspaces when workspaceId is omitted.",
      inputSchema: {
        workspaceId: z.string().optional(),
      },
      outputSchema: {
        workspaces: z.array(z.unknown()).optional(),
        workspace: z.unknown().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      try {
        requireToolScope(context, "workspace_status");
        if (workspaceId) {
          const workspace = workspaces.resolveWorkspace(workspaceId);
          return textResult(`Workspace ${workspace.workspaceId} is open.`, { workspace });
        }
        const openWorkspaces = workspaces.listWorkspaces();
        return textResult(`${openWorkspaces.length} workspace(s) open.`, { workspaces: openWorkspaces });
      } catch (error) {
        await auditToolFailure(auditLog, "workspace_status", error, { workspaceId });
        return errorResult(error);
      }
    },
  );
}
