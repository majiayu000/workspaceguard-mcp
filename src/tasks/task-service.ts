import {
  createTaskId,
  type TaskId,
  type WorkspaceId,
} from "../core/ids.js";

export type TaskStatus = "active" | "blocked" | "completed" | "cancelled";

export interface TaskNote {
  readonly note: string;
  readonly createdAt: string;
}

export interface TaskRecord {
  readonly taskId: TaskId;
  readonly workspaceId: WorkspaceId;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly status: TaskStatus;
  readonly notes: readonly TaskNote[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskServiceOptions {
  readonly idFactory?: () => TaskId;
  readonly now?: () => Date;
}

export interface StartTaskInput {
  readonly workspaceId: WorkspaceId;
  readonly objective: string;
  readonly constraints?: readonly string[];
}

export interface UpdateTaskInput {
  readonly taskId: TaskId;
  readonly status?: TaskStatus;
  readonly note?: string;
}

export class TaskService {
  private readonly tasks = new Map<TaskId, TaskRecord>();
  private readonly idFactory: () => TaskId;
  private readonly now: () => Date;

  constructor(options: TaskServiceOptions = {}) {
    this.idFactory = options.idFactory ?? createTaskId;
    this.now = options.now ?? (() => new Date());
  }

  startTask(input: StartTaskInput): TaskRecord {
    validateNonEmptyString(input.objective, "objective");
    const constraints = input.constraints?.map((constraint) => {
      validateNonEmptyString(constraint, "constraint");
      return constraint;
    }) ?? [];
    const timestamp = this.now().toISOString();
    const record: TaskRecord = {
      taskId: this.idFactory(),
      workspaceId: input.workspaceId,
      objective: input.objective,
      constraints,
      status: "active",
      notes: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.tasks.set(record.taskId, record);
    return cloneTaskRecord(record);
  }

  updateTask(input: UpdateTaskInput): TaskRecord {
    if (input.status === undefined && input.note === undefined) {
      throw new TypeError("updateTask requires status or note.");
    }
    if (input.note !== undefined) {
      validateNonEmptyString(input.note, "note");
    }

    const existing = this.tasks.get(input.taskId);
    if (existing === undefined) {
      throw new Error(`Unknown taskId: ${input.taskId}`);
    }

    const timestamp = this.now().toISOString();
    const notes =
      input.note === undefined
        ? existing.notes
        : [
            ...existing.notes,
            {
              note: input.note,
              createdAt: timestamp,
            },
          ];
    const updated: TaskRecord = {
      ...existing,
      status: input.status ?? existing.status,
      notes,
      updatedAt: timestamp,
    };

    this.tasks.set(updated.taskId, updated);
    return cloneTaskRecord(updated);
  }

  getTask(taskId: TaskId): TaskRecord {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      throw new Error(`Unknown taskId: ${taskId}`);
    }

    return cloneTaskRecord(task);
  }

  listTasks(): TaskRecord[] {
    return Array.from(this.tasks.values(), cloneTaskRecord);
  }
}

function cloneTaskRecord(record: TaskRecord): TaskRecord {
  return {
    ...record,
    constraints: [...record.constraints],
    notes: record.notes.map((note) => ({ ...note })),
  };
}

function validateNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}
