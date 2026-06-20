import assert from "node:assert/strict";
import test from "node:test";

import { type TaskId, type WorkspaceId } from "../../src/core/ids.js";
import {
  CheckpointService,
  type CheckpointId,
} from "../../src/checkpoints/checkpoint-service.js";
import type { SnapshotId } from "../../src/snapshots/snapshot-service.js";

test("createCheckpoint creates, gets, and lists checkpoints in creation order", () => {
  let nextId = 0;
  const service = new CheckpointService({
    idFactory: () => `checkpoint_${nextId += 1}` as CheckpointId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const first = service.createCheckpoint({
    workspaceId: "ws_test" as WorkspaceId,
    taskId: "task_test" as TaskId,
    snapshotId: "snapshot_first" as SnapshotId,
    label: "Before edit",
    reason: "known good baseline",
  });
  const second = service.createCheckpoint({
    workspaceId: "ws_test" as WorkspaceId,
    snapshotId: "snapshot_second" as SnapshotId,
    label: "After edit",
  });

  assert.deepEqual(first, {
    checkpointId: "checkpoint_1",
    workspaceId: "ws_test",
    taskId: "task_test",
    snapshotId: "snapshot_first",
    label: "Before edit",
    reason: "known good baseline",
    createdAt: "2026-06-20T00:00:00.000Z",
  });
  assert.deepEqual(second, {
    checkpointId: "checkpoint_2",
    workspaceId: "ws_test",
    snapshotId: "snapshot_second",
    label: "After edit",
    createdAt: "2026-06-20T00:00:00.000Z",
  });
  assert.deepEqual(service.getCheckpoint(first.checkpointId), first);
  assert.deepEqual(
    service.listCheckpoints().map((checkpoint) => checkpoint.checkpointId),
    [first.checkpointId, second.checkpointId],
  );
});

test("checkpoint reads return clones without exposing stored state", () => {
  const service = new CheckpointService({
    idFactory: () => "checkpoint_test" as CheckpointId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });
  const checkpoint = service.createCheckpoint({
    workspaceId: "ws_test" as WorkspaceId,
    snapshotId: "snapshot_test" as SnapshotId,
    label: "Stable",
  });

  (checkpoint as { label: string }).label = "mutated create result";
  const listed = service.listCheckpoints();
  (listed[0] as { label: string }).label = "mutated list result";

  assert.equal(service.getCheckpoint("checkpoint_test" as CheckpointId).label, "Stable");
});

test("createCheckpoint validates non-empty labels and get rejects unknown ids", () => {
  const service = new CheckpointService({
    idFactory: () => "checkpoint_test" as CheckpointId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.throws(
    () =>
      service.createCheckpoint({
        workspaceId: "ws_test" as WorkspaceId,
        snapshotId: "snapshot_test" as SnapshotId,
        label: "   ",
      }),
    /label must be a non-empty string/,
  );
  assert.throws(
    () => service.getCheckpoint("checkpoint_missing" as CheckpointId),
    /Unknown checkpointId/,
  );
});
