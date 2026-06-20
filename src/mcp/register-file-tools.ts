import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { auditToolFailure } from "./audit-tool-failure.js";
import { asStructured, errorResult, textResult } from "./responses.js";
import type { ToolContext } from "./tool-context.js";

export function registerFileTools(server: McpServer, { auditLog, files, workspaces }: ToolContext): void {
  server.registerTool(
    "file_read",
    {
      title: "Read file",
      description: "Read a UTF-8 file inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        path: z.string(),
        content: z.string(),
        totalLines: z.number(),
        returnedLines: z.number(),
        offset: z.number(),
        limited: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, path, offset, limit }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.readFile({ workspaceRoot: workspace.root, path, offset, limit });
        return textResult(result.content, asStructured(result));
      } catch (error) {
        await auditToolFailure(auditLog, "file_read", error, { workspaceId, path });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "directory_list",
    {
      title: "List directory",
      description: "List a directory inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string().default("."),
      },
      outputSchema: {
        path: z.string(),
        entries: z.array(z.object({ name: z.string(), type: z.string() })),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, path }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.listDirectory({ workspaceRoot: workspace.root, path });
        return textResult(`${result.entries.length} entrie(s).`, asStructured(result));
      } catch (error) {
        await auditToolFailure(auditLog, "directory_list", error, { workspaceId, path });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_text",
    {
      title: "Search text",
      description: "Search for a literal text pattern inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        pattern: z.string(),
        path: z.string().optional(),
        maxResults: z.number().int().nonnegative().max(1000).optional(),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            path: z.string(),
            line: z.number(),
            text: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, pattern, path, maxResults }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        const result = await files.searchText({ workspaceRoot: workspace.root, pattern, path, maxResults });
        return textResult(`${result.matches.length} match(es).`, asStructured(result));
      } catch (error) {
        await auditToolFailure(auditLog, "search_text", error, { workspaceId, path });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "file_write",
    {
      title: "Write file",
      description: "Create or overwrite a UTF-8 file inside an open workspace.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        content: z.string(),
        overwrite: z.boolean().default(false),
      },
      outputSchema: {
        path: z.string(),
        bytes: z.number(),
        created: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, path, content, overwrite }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "file_write",
          workspaceId,
          path,
          bytes: Buffer.byteLength(content, "utf8"),
          overwrite,
        });
        const result = await files.writeFile({ workspaceRoot: workspace.root, path, content, overwrite });
        return textResult(`Wrote ${result.bytes} byte(s).`, asStructured(result));
      } catch (error) {
        await auditToolFailure(auditLog, "file_write", error, { workspaceId, path });
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "file_edit",
    {
      title: "Edit file",
      description: "Replace an exact text block that appears exactly once in a workspace file.",
      inputSchema: {
        workspaceId: z.string(),
        path: z.string(),
        oldText: z.string(),
        newText: z.string(),
      },
      outputSchema: {
        path: z.string(),
        replacements: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, path, oldText, newText }) => {
      try {
        const workspace = workspaces.resolveWorkspace(workspaceId);
        await auditLog.append({
          at: new Date().toISOString(),
          tool: "file_edit",
          workspaceId,
          path,
          oldBytes: Buffer.byteLength(oldText, "utf8"),
          newBytes: Buffer.byteLength(newText, "utf8"),
        });
        const result = await files.editFile({ workspaceRoot: workspace.root, path, oldText, newText });
        return textResult(`Edited ${result.path}.`, asStructured(result));
      } catch (error) {
        await auditToolFailure(auditLog, "file_edit", error, { workspaceId, path });
        return errorResult(error);
      }
    },
  );
}
