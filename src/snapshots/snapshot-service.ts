import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { createId } from "../core/ids.js";
import { resolvePathWithinAllowedRoots } from "../security/paths.js";

export type SnapshotId = `snapshot_${string}`;

export interface SnapshotFileEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface FileManifestSnapshot {
  readonly snapshotId: SnapshotId;
  readonly root: string;
  readonly createdAt: string;
  readonly reason?: string;
  readonly files: readonly SnapshotFileEntry[];
}

export interface SnapshotServiceOptions {
  readonly idFactory?: () => SnapshotId;
  readonly now?: () => Date;
  readonly homeDir?: string;
}

export interface CreateFileManifestSnapshotInput {
  readonly workspaceRoot: string;
  readonly allowedRoots: readonly string[];
  readonly reason?: string;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".workspaceguard",
]);

export class SnapshotService {
  private readonly idFactory: () => SnapshotId;
  private readonly now: () => Date;
  private readonly homeDir?: string;

  constructor(options: SnapshotServiceOptions = {}) {
    this.idFactory = options.idFactory ?? createSnapshotId;
    this.now = options.now ?? (() => new Date());
    this.homeDir = options.homeDir;
  }

  async createFileManifestSnapshot(
    input: CreateFileManifestSnapshotInput,
  ): Promise<FileManifestSnapshot> {
    const containedRoot = await resolvePathWithinAllowedRoots(
      input.workspaceRoot,
      input.allowedRoots,
      {
        homeDir: this.homeDir,
        mustExist: true,
      },
    );
    await ensureSnapshotRootDirectory(containedRoot.path);

    const files = await collectFileEntries(containedRoot.path, containedRoot.path);
    files.sort((left, right) => left.path.localeCompare(right.path));

    return {
      snapshotId: this.idFactory(),
      root: containedRoot.path,
      createdAt: this.now().toISOString(),
      reason: input.reason,
      files,
    };
  }
}

function createSnapshotId(): SnapshotId {
  return createId("snapshot") as SnapshotId;
}

async function collectFileEntries(
  root: string,
  directoryPath: string,
): Promise<SnapshotFileEntry[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const files: SnapshotFileEntry[] = [];
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const containedDirectory = await resolvePathWithinAllowedRoots(entryPath, [root], {
        mustExist: true,
      });
      files.push(...(await collectFileEntries(root, containedDirectory.path)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const containedFile = await resolvePathWithinAllowedRoots(entryPath, [root], {
      mustExist: true,
    });
    const content = await fs.readFile(containedFile.path);
    files.push({
      path: toManifestPath(path.relative(root, containedFile.path)),
      sizeBytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  return files;
}

function toManifestPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function ensureSnapshotRootDirectory(directoryPath: string): Promise<void> {
  const stats = await fs.stat(directoryPath);
  if (!stats.isDirectory()) {
    throw new Error(`Snapshot root is not a directory: ${directoryPath}`);
  }
}
