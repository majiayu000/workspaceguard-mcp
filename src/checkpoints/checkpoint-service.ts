import {
  createId,
  type TaskId,
  type WorkspaceId,
} from "../core/ids.js";
import type { SnapshotId } from "../snapshots/snapshot-service.js";

export type CheckpointId = `checkpoint_${string}`;

export interface CheckpointRecord {
  readonly checkpointId: CheckpointId;
  readonly workspaceId: WorkspaceId;
  readonly taskId?: TaskId;
  readonly snapshotId: SnapshotId;
  readonly label: string;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface CheckpointServiceOptions {
  readonly idFactory?: () => CheckpointId;
  readonly now?: () => Date;
}

export interface CreateCheckpointInput {
  readonly workspaceId: WorkspaceId;
  readonly taskId?: TaskId;
  readonly snapshotId: SnapshotId;
  readonly label: string;
  readonly reason?: string;
}

export class CheckpointService {
  private readonly checkpoints = new Map<CheckpointId, CheckpointRecord>();
  private readonly idFactory: () => CheckpointId;
  private readonly now: () => Date;

  constructor(options: CheckpointServiceOptions = {}) {
    this.idFactory = options.idFactory ?? createCheckpointId;
    this.now = options.now ?? (() => new Date());
  }

  createCheckpoint(input: CreateCheckpointInput): CheckpointRecord {
    if (typeof input.label !== "string" || input.label.trim().length === 0) {
      throw new TypeError("label must be a non-empty string.");
    }

    const record: CheckpointRecord = {
      checkpointId: this.idFactory(),
      workspaceId: input.workspaceId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      snapshotId: input.snapshotId,
      label: input.label,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      createdAt: this.now().toISOString(),
    };

    this.checkpoints.set(record.checkpointId, record);
    return cloneCheckpointRecord(record);
  }

  getCheckpoint(checkpointId: CheckpointId): CheckpointRecord {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (checkpoint === undefined) {
      throw new Error(`Unknown checkpointId: ${checkpointId}`);
    }

    return cloneCheckpointRecord(checkpoint);
  }

  listCheckpoints(): CheckpointRecord[] {
    return Array.from(this.checkpoints.values(), cloneCheckpointRecord);
  }
}

function createCheckpointId(): CheckpointId {
  return createId("checkpoint") as CheckpointId;
}

function cloneCheckpointRecord(record: CheckpointRecord): CheckpointRecord {
  return { ...record };
}
