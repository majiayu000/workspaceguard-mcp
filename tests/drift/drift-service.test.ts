import assert from "node:assert/strict";
import test from "node:test";

import { DriftService } from "../../src/drift/drift-service.js";
import type {
  FileManifestSnapshot,
  SnapshotFileEntry,
  SnapshotId,
} from "../../src/snapshots/snapshot-service.js";

test("compareSnapshots reports added files sorted by relative path", () => {
  const service = new DriftService();

  const drift = service.compareSnapshots({
    baseline: snapshot([]),
    current: snapshot([
      file("z.txt", "sha-z"),
      file("a.txt", "sha-a"),
    ]),
  });

  assert.deepEqual(drift, {
    added: [
      file("a.txt", "sha-a"),
      file("z.txt", "sha-z"),
    ],
    modified: [],
    deleted: [],
    changed: true,
  });
});

test("compareSnapshots reports modified files using current manifest entries", () => {
  const service = new DriftService();

  const drift = service.compareSnapshots({
    baseline: snapshot([
      file("z.txt", "old-z"),
      file("a.txt", "old-a"),
    ]),
    current: snapshot([
      file("z.txt", "new-z", 10),
      file("a.txt", "new-a", 20),
    ]),
  });

  assert.deepEqual(drift, {
    added: [],
    modified: [
      file("a.txt", "new-a", 20),
      file("z.txt", "new-z", 10),
    ],
    deleted: [],
    changed: true,
  });
});

test("compareSnapshots reports deleted files using baseline manifest entries", () => {
  const service = new DriftService();

  const drift = service.compareSnapshots({
    baseline: snapshot([
      file("z.txt", "sha-z", 10),
      file("a.txt", "sha-a", 20),
    ]),
    current: snapshot([]),
  });

  assert.deepEqual(drift, {
    added: [],
    modified: [],
    deleted: [
      file("a.txt", "sha-a", 20),
      file("z.txt", "sha-z", 10),
    ],
    changed: true,
  });
});

test("compareSnapshots reports no change when paths and sha256 values match", () => {
  const service = new DriftService();

  const drift = service.compareSnapshots({
    baseline: snapshot([
      file("b.txt", "sha-b", 1),
      file("a.txt", "sha-a", 2),
    ]),
    current: snapshot([
      file("a.txt", "sha-a", 999),
      file("b.txt", "sha-b", 888),
    ]),
  });

  assert.deepEqual(drift, {
    added: [],
    modified: [],
    deleted: [],
    changed: false,
  });
});

test("checkWorkspaceDrift records and updates per-workspace baselines", () => {
  const service = new DriftService();

  const baseline = service.checkWorkspaceDrift({
    workspaceId: "ws_test",
    current: snapshot([file("a.txt", "old-a")], "snapshot_baseline"),
  });

  assert.deepEqual(baseline, {
    currentSnapshotId: "snapshot_baseline",
    added: [],
    modified: [],
    deleted: [],
    changed: false,
  });

  const changed = service.checkWorkspaceDrift({
    workspaceId: "ws_test",
    current: snapshot([file("a.txt", "new-a"), file("b.txt", "sha-b")], "snapshot_current"),
  });

  assert.deepEqual(changed, {
    baselineSnapshotId: "snapshot_baseline",
    currentSnapshotId: "snapshot_current",
    added: [file("b.txt", "sha-b")],
    modified: [file("a.txt", "new-a")],
    deleted: [],
    changed: true,
  });
});

function snapshot(
  files: readonly SnapshotFileEntry[],
  snapshotId: SnapshotId = "snapshot_test" as SnapshotId,
): FileManifestSnapshot {
  return {
    snapshotId,
    root: "/workspace",
    createdAt: "2026-06-20T00:00:00.000Z",
    files,
  };
}

function file(path: string, sha256: string, sizeBytes = sha256.length): SnapshotFileEntry {
  return {
    path,
    sizeBytes,
    sha256,
  };
}
