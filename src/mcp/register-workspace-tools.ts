import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asStructured, errorResult, textResult } from "./responses.js";
import type { ToolContext } from "./tool-context.js";

export function registerWorkspaceTools(server: McpServer, { auditLog, workspaces }: ToolContext): void {
  server.registerTool(
    "workspace_open",
    {
      title: "Open workspace",
      description: "Open an allowed local checkout workspace and return a workspaceId.",
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
        const workspace = await workspaces.openWorkspace(input);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "workspace_open",
          workspaceId: workspace.workspaceId,
          root: workspace.root,
        });
        return textResult(`Opened workspace ${workspace.workspaceId}`, asStructured(workspace));
      } catch (error) {
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
        if (workspaceId) {
          const workspace = workspaces.resolveWorkspace(workspaceId);
          return textResult(`Workspace ${workspace.workspaceId} is open.`, { workspace });
        }
        const openWorkspaces = workspaces.listWorkspaces();
        return textResult(`${openWorkspaces.length} workspace(s) open.`, { workspaces: openWorkspaces });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
