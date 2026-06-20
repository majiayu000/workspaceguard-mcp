import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PathContainmentError } from "../../src/security/paths.js";
import {
  type SnapshotId,
  SnapshotService,
} from "../../src/snapshots/snapshot-service.js";

async function makeWorkspace(t: test.TestContext): Promise<{
  readonly allowedRoot: string;
  readonly workspaceRoot: string;
}> {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-snapshot-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const workspaceRoot = path.join(allowedRoot, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });

  return { allowedRoot, workspaceRoot };
}

test("createFileManifestSnapshot returns stable sorted file hashes and skips generated directories", async (t) => {
  const { allowedRoot, workspaceRoot } = await makeWorkspace(t);
  await fs.mkdir(path.join(workspaceRoot, "nested"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "z.txt"), "z", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "a.txt"), "alpha", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "nested", "b.txt"), "bravo", "utf8");

  for (const skipped of [".git", "node_modules", "dist", "build", "coverage", ".workspaceguard"]) {
    await fs.mkdir(path.join(workspaceRoot, skipped), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, skipped, "ignored.txt"), "ignored", "utf8");
  }

  const service = new SnapshotService({
    idFactory: () => "snapshot_test" as SnapshotId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });
  const snapshot = await service.createFileManifestSnapshot({
    workspaceRoot,
    allowedRoots: [allowedRoot],
    reason: "before edit",
  });

  assert.equal(snapshot.snapshotId, "snapshot_test");
  assert.equal(snapshot.root, await fs.realpath(workspaceRoot));
  assert.equal(snapshot.createdAt, "2026-06-20T00:00:00.000Z");
  assert.equal(snapshot.reason, "before edit");
  assert.deepEqual(snapshot.files, [
    {
      path: "a.txt",
      sizeBytes: 5,
      sha256: sha256("alpha"),
    },
    {
      path: "nested/b.txt",
      sizeBytes: 5,
      sha256: sha256("bravo"),
    },
    {
      path: "z.txt",
      sizeBytes: 1,
      sha256: sha256("z"),
    },
  ]);
});

test("createFileManifestSnapshot rejects roots outside allowed roots", async (t) => {
  const { allowedRoot, workspaceRoot } = await makeWorkspace(t);
  const outsideRoot = path.join(path.dirname(allowedRoot), "outside");
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret", "utf8");

  const service = new SnapshotService({
    idFactory: () => "snapshot_test" as SnapshotId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  await assert.rejects(
    () =>
      service.createFileManifestSnapshot({
        workspaceRoot: outsideRoot,
        allowedRoots: [workspaceRoot],
      }),
    (error) =>
      error instanceof PathContainmentError &&
      error.code === "outside_allowed_roots",
  );
});

test("createFileManifestSnapshot rejects symlinked workspace roots that escape allowed roots", async (t) => {
  const { allowedRoot } = await makeWorkspace(t);
  const outsideRoot = path.join(path.dirname(allowedRoot), "outside");
  const symlinkRoot = path.join(allowedRoot, "escape");
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.symlink(outsideRoot, symlinkRoot, "dir");

  const service = new SnapshotService({
    idFactory: () => "snapshot_test" as SnapshotId,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  await assert.rejects(
    () =>
      service.createFileManifestSnapshot({
        workspaceRoot: symlinkRoot,
        allowedRoots: [allowedRoot],
      }),
    (error) =>
      error instanceof PathContainmentError &&
      error.code === "outside_allowed_roots",
  );
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
