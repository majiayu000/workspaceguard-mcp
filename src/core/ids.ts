import { randomBytes } from "node:crypto";

const DEFAULT_RANDOM_BYTES = 16;
const ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;

export type WorkspaceId = `ws_${string}`;
export type TaskId = `task_${string}`;

export function createId(prefix: string, byteLength = DEFAULT_RANDOM_BYTES): string {
  if (!ID_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid id prefix "${prefix}". Use lowercase alphanumeric prefixes.`);
  }

  if (!Number.isInteger(byteLength) || byteLength < 8) {
    throw new Error("ID byte length must be an integer of at least 8 bytes.");
  }

  return `${prefix}_${randomBytes(byteLength).toString("base64url")}`;
}

export function createWorkspaceId(): WorkspaceId {
  return createId("ws") as WorkspaceId;
}

export function createTaskId(): TaskId {
  return createId("task") as TaskId;
}

