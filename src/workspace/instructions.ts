import { promises as fs } from "node:fs";
import path from "node:path";

import { canonicalizePath, errorMessage, isNodeError } from "../security/paths.js";

export const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
export const SKIPPED_INSTRUCTION_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".workspaceguard",
]);

export type InstructionFileName = (typeof INSTRUCTION_FILE_NAMES)[number];

export interface InstructionFile {
  readonly path: string;
  readonly absolutePath: string;
  readonly content: string;
  readonly sizeBytes: number;
}

export class InstructionDiscoveryError extends Error {
  readonly path: string;

  constructor(message: string, instructionPath: string) {
    super(message);
    this.name = "InstructionDiscoveryError";
    this.path = instructionPath;
  }
}

export async function loadRootInstructionFiles(workspaceRoot: string): Promise<InstructionFile[]> {
  const root = await canonicalizePath(workspaceRoot, { mustExist: true });
  const instructionFiles: InstructionFile[] = [];

  for (const fileName of INSTRUCTION_FILE_NAMES) {
    const absolutePath = path.join(root, fileName);
    const stats = await lstatIfExists(absolutePath);
    if (stats === undefined || !stats.isFile()) {
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      throw new InstructionDiscoveryError(
        `Unable to read instruction file ${absolutePath}: ${errorMessage(error)}`,
        absolutePath,
      );
    }

    instructionFiles.push({
      path: fileName,
      absolutePath,
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
    });
  }

  return instructionFiles;
}

export async function listAvailableInstructionFiles(workspaceRoot: string): Promise<string[]> {
  const root = await canonicalizePath(workspaceRoot, { mustExist: true });
  const results: string[] = [];

  await walkInstructionFiles(root, root, results);

  return results.sort((left, right) => left.localeCompare(right));
}

async function walkInstructionFiles(
  root: string,
  currentDirectory: string,
  results: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  } catch (error) {
    throw new InstructionDiscoveryError(
      `Unable to list instruction directory ${currentDirectory}: ${errorMessage(error)}`,
      currentDirectory,
    );
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_INSTRUCTION_DIRECTORIES.has(entry.name)) {
        await walkInstructionFiles(root, absolutePath, results);
      }
      continue;
    }

    if (entry.isFile() && isInstructionFileName(entry.name)) {
      results.push(toWorkspaceRelativePath(root, absolutePath));
    }
  }
}

function isInstructionFileName(fileName: string): fileName is InstructionFileName {
  return INSTRUCTION_FILE_NAMES.includes(fileName as InstructionFileName);
}

function toWorkspaceRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

async function lstatIfExists(absolutePath: string) {
  try {
    return await fs.lstat(absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw new InstructionDiscoveryError(
      `Unable to inspect instruction file ${absolutePath}: ${errorMessage(error)}`,
      absolutePath,
    );
  }
}
