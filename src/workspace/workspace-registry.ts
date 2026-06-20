import { promises as fs } from "node:fs";

import { createWorkspaceId, type WorkspaceId } from "../core/ids.js";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";
import {
  type InstructionFile,
  listAvailableInstructionFiles,
  loadRootInstructionFiles,
} from "./instructions.js";

export type WorkspaceMode = "checkout" | "worktree" | "container";

export interface WorkspaceRegistryOptions {
  readonly allowedRoots: readonly string[];
  readonly homeDir?: string;
  readonly idFactory?: () => WorkspaceId;
  readonly now?: () => Date;
}

export interface OpenWorkspaceInput {
  readonly path: string;
  readonly mode?: WorkspaceMode;
}

export interface WorkspaceRecord {
  readonly workspaceId: WorkspaceId;
  readonly root: string;
  readonly mode: WorkspaceMode;
  readonly openedAt: string;
  readonly instructionFiles: readonly InstructionFile[];
  readonly availableInstructionFiles: readonly string[];
}

export class WorkspaceRegistry {
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();
  private readonly allowedRoots: readonly string[];
  private readonly homeDir?: string;
  private readonly idFactory: () => WorkspaceId;
  private readonly now: () => Date;

  constructor(options: WorkspaceRegistryOptions) {
    this.allowedRoots = options.allowedRoots;
    this.homeDir = options.homeDir;
    this.idFactory = options.idFactory ?? createWorkspaceId;
    this.now = options.now ?? (() => new Date());
  }

  async openWorkspace(input: OpenWorkspaceInput): Promise<WorkspaceRecord> {
    const mode = input.mode ?? "checkout";
    if (mode !== "checkout") {
      throw new Error(`Unsupported workspace mode "${mode}". WorkspaceGuard v0.1 opens checkout workspaces only.`);
    }

    const containedRoot = await resolvePathWithinAllowedRoots(input.path, this.allowedRoots, {
      homeDir: this.homeDir,
      mustExist: true,
    });

    const stats = await fs.stat(containedRoot.path);
    if (!stats.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${containedRoot.path}`);
    }

    const record: WorkspaceRecord = {
      workspaceId: this.idFactory(),
      root: containedRoot.path,
      mode,
      openedAt: this.now().toISOString(),
      instructionFiles: await loadRootInstructionFiles(containedRoot.path),
      availableInstructionFiles: await listAvailableInstructionFiles(containedRoot.path),
    };

    this.workspaces.set(record.workspaceId, record);
    return cloneWorkspaceRecord(record);
  }

  resolveWorkspace(workspaceId: WorkspaceId | string): WorkspaceRecord {
    const workspace = this.workspaces.get(workspaceId as WorkspaceId);
    if (workspace === undefined) {
      throw new Error(`Unknown workspaceId: ${workspaceId}`);
    }

    return cloneWorkspaceRecord(workspace);
  }

  listWorkspaces(): WorkspaceRecord[] {
    return Array.from(this.workspaces.values(), cloneWorkspaceRecord);
  }
}

function cloneWorkspaceRecord(record: WorkspaceRecord): WorkspaceRecord {
  return {
    ...record,
    instructionFiles: record.instructionFiles.map((instructionFile) => ({ ...instructionFile })),
    availableInstructionFiles: [...record.availableInstructionFiles],
  };
}

