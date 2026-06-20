import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  type TaskId,
  type WorkspaceId,
} from "../../src/core/ids.js";
import {
  isVerificationFresh,
  type VerificationId,
  VerificationService,
} from "../../src/verification/verification-service.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "wg-verification-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  return cwd;
}

test("runVerification returns passed records for exit code zero", async (t) => {
  const cwd = await makeTempDir(t);
  const service = new VerificationService({
    idFactory: () => "verification_test" as VerificationId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const result = await service.runVerification({
    workspaceId: "ws_test" as WorkspaceId,
    taskId: "task_test" as TaskId,
    cwd,
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok');"],
  });

  assert.equal(result.verificationId, "verification_test");
  assert.equal(result.workspaceId, "ws_test");
  assert.equal(result.taskId, "task_test");
  assert.equal(result.status, "passed");
  assert.equal(result.command, process.execPath);
  assert.deepEqual(result.args, ["-e", "process.stdout.write('ok');"]);
  assert.equal(result.cwd, cwd);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.createdAt, "2026-06-20T00:00:00.000Z");
});

test("runVerification returns failed records for non-zero exit codes", async (t) => {
  const cwd = await makeTempDir(t);
  const service = new VerificationService({
    idFactory: () => "verification_test" as VerificationId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const result = await service.runVerification({
    workspaceId: "ws_test" as WorkspaceId,
    cwd,
    command: process.execPath,
    args: ["-e", "process.stderr.write('bad'); process.exit(2);"],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "bad");
  assert.equal(result.exitCode, 2);
});

test("runVerification returns timed_out records after timeout", async (t) => {
  const cwd = await makeTempDir(t);
  const service = new VerificationService({
    idFactory: () => "verification_test" as VerificationId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const result = await service.runVerification({
    workspaceId: "ws_test" as WorkspaceId,
    cwd,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000);"],
    timeoutMs: 50,
  });

  assert.equal(result.status, "timed_out");
  assert.equal(result.exitCode, null);
  assert.ok(result.durationMs < 5_000);
});

test("isVerificationFresh compares verification time to latest change time", () => {
  const verification = {
    createdAt: "2026-06-20T00:01:00.000Z",
  };

  assert.equal(
    isVerificationFresh({
      verification,
      latestChangeAt: "2026-06-20T00:00:59.999Z",
    }),
    true,
  );
  assert.equal(
    isVerificationFresh({
      verification,
      latestChangeAt: new Date("2026-06-20T00:01:00.000Z"),
    }),
    true,
  );
  assert.equal(
    isVerificationFresh({
      verification,
      latestChangeAt: "2026-06-20T00:01:00.001Z",
    }),
    false,
  );
});

test("VerificationService exposes freshness logic", () => {
  const service = new VerificationService();

  assert.equal(
    service.isVerificationFresh({
      verification: { createdAt: "2026-06-20T00:01:00.000Z" },
      latestChangeAt: "2026-06-20T00:00:00.000Z",
    }),
    true,
  );
});
