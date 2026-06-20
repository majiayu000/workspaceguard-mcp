import type {
  FileManifestSnapshot,
  SnapshotId,
  SnapshotFileEntry,
} from "../snapshots/snapshot-service.js";

export interface CompareSnapshotsInput {
  readonly baseline: FileManifestSnapshot;
  readonly current: FileManifestSnapshot;
}

export interface SnapshotDrift {
  readonly added: readonly SnapshotFileEntry[];
  readonly modified: readonly SnapshotFileEntry[];
  readonly deleted: readonly SnapshotFileEntry[];
  readonly changed: boolean;
}

export interface CheckWorkspaceDriftInput {
  readonly workspaceId: string;
  readonly current: FileManifestSnapshot;
}

export interface WorkspaceDriftCheck extends SnapshotDrift {
  readonly baselineSnapshotId?: SnapshotId;
  readonly currentSnapshotId: SnapshotId;
}

export class DriftService {
  private readonly lastSnapshotByWorkspace = new Map<string, FileManifestSnapshot>();

  compareSnapshots(input: CompareSnapshotsInput): SnapshotDrift {
    const baselineByPath = toFileEntryMap(input.baseline.files);
    const currentByPath = toFileEntryMap(input.current.files);
    const added: SnapshotFileEntry[] = [];
    const modified: SnapshotFileEntry[] = [];
    const deleted: SnapshotFileEntry[] = [];

    for (const currentFile of sortFileEntries(input.current.files)) {
      const baselineFile = baselineByPath.get(currentFile.path);
      if (baselineFile === undefined) {
        added.push(cloneFileEntry(currentFile));
        continue;
      }

      if (baselineFile.sha256 !== currentFile.sha256) {
        modified.push(cloneFileEntry(currentFile));
      }
    }

    for (const baselineFile of sortFileEntries(input.baseline.files)) {
      if (!currentByPath.has(baselineFile.path)) {
        deleted.push(cloneFileEntry(baselineFile));
      }
    }

    return {
      added,
      modified,
      deleted,
      changed: added.length > 0 || modified.length > 0 || deleted.length > 0,
    };
  }

  checkWorkspaceDrift(input: CheckWorkspaceDriftInput): WorkspaceDriftCheck {
    const baseline = this.lastSnapshotByWorkspace.get(input.workspaceId);
    this.lastSnapshotByWorkspace.set(input.workspaceId, input.current);

    if (baseline === undefined) {
      return {
        currentSnapshotId: input.current.snapshotId,
        added: [],
        modified: [],
        deleted: [],
        changed: false,
      };
    }

    return {
      baselineSnapshotId: baseline.snapshotId,
      currentSnapshotId: input.current.snapshotId,
      ...this.compareSnapshots({ baseline, current: input.current }),
    };
  }
}

function toFileEntryMap(files: readonly SnapshotFileEntry[]): Map<string, SnapshotFileEntry> {
  const byPath = new Map<string, SnapshotFileEntry>();
  for (const file of files) {
    byPath.set(file.path, file);
  }

  return byPath;
}

function sortFileEntries(files: readonly SnapshotFileEntry[]): SnapshotFileEntry[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function cloneFileEntry(file: SnapshotFileEntry): SnapshotFileEntry {
  return { ...file };
}
