import assert from "node:assert/strict";
import test from "node:test";

import { type TaskId, type WorkspaceId } from "../../src/core/ids.js";
import { TaskService } from "../../src/tasks/task-service.js";

test("startTask creates an active task with copied constraints", () => {
  const constraints = ["stay scoped"];
  const service = new TaskService({
    idFactory: () => "task_test" as TaskId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const task = service.startTask({
    workspaceId: "ws_test" as WorkspaceId,
    objective: "Implement task primitives",
    constraints,
  });
  constraints.push("mutated outside");

  assert.deepEqual(task, {
    taskId: "task_test",
    workspaceId: "ws_test",
    objective: "Implement task primitives",
    constraints: ["stay scoped"],
    status: "active",
    notes: [],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  });
  assert.deepEqual(service.getTask(task.taskId).constraints, ["stay scoped"]);
});

test("updateTask updates status and appends notes", () => {
  const timestamps = [
    "2026-06-20T00:00:00.000Z",
    "2026-06-20T00:01:00.000Z",
    "2026-06-20T00:02:00.000Z",
  ];
  const service = new TaskService({
    idFactory: () => "task_test" as TaskId,
    now: () => new Date(timestamps.shift() ?? "2026-06-20T00:03:00.000Z"),
  });
  const task = service.startTask({
    workspaceId: "ws_test" as WorkspaceId,
    objective: "Track work",
  });

  const blocked = service.updateTask({
    taskId: task.taskId,
    status: "blocked",
    note: "Waiting on input",
  });
  const completed = service.updateTask({
    taskId: task.taskId,
    status: "completed",
  });

  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.notes, [
    {
      note: "Waiting on input",
      createdAt: "2026-06-20T00:01:00.000Z",
    },
  ]);
  assert.equal(completed.status, "completed");
  assert.equal(completed.updatedAt, "2026-06-20T00:02:00.000Z");
  assert.deepEqual(completed.notes, blocked.notes);
});

test("listTasks returns tasks in creation order without exposing mutable state", () => {
  let nextId = 0;
  const service = new TaskService({
    idFactory: () => `task_${nextId += 1}` as TaskId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const first = service.startTask({
    workspaceId: "ws_test" as WorkspaceId,
    objective: "First",
  });
  const second = service.startTask({
    workspaceId: "ws_test" as WorkspaceId,
    objective: "Second",
  });
  const listed = service.listTasks();
  (listed[0]?.notes as { note: string; createdAt: string }[] | undefined)?.push({
    note: "external mutation",
    createdAt: "2026-06-20T00:00:00.000Z",
  });

  assert.deepEqual(
    listed.map((task) => task.taskId),
    [first.taskId, second.taskId],
  );
  assert.deepEqual(service.getTask(first.taskId).notes, []);
});

test("updateTask rejects unknown tasks and empty updates", () => {
  const service = new TaskService({
    idFactory: () => "task_test" as TaskId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.throws(
    () => service.updateTask({ taskId: "task_missing" as TaskId, status: "completed" }),
    /Unknown taskId/,
  );
  const task = service.startTask({
    workspaceId: "ws_test" as WorkspaceId,
    objective: "Validate updates",
  });
  assert.throws(() => service.updateTask({ taskId: task.taskId }), /requires status or note/);
  assert.throws(
    () => service.updateTask({ taskId: task.taskId, note: "   " }),
    /note must be a non-empty string/,
  );
});
