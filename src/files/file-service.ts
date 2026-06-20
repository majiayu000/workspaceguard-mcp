import { promises as fs } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  errorMessage,
  isNodeError,
  resolvePathWithinAllowedRoots,
} from "../security/paths.js";

export interface ReadFileInput {
  readonly path: string;
  readonly workspaceRoot: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly totalLines: number;
  readonly returnedLines: number;
  readonly offset: number;
  readonly limited: boolean;
}

export interface WriteFileInput {
  readonly path: string;
  readonly workspaceRoot: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface WriteFileResult {
  readonly path: string;
  readonly bytes: number;
  readonly created: boolean;
}

export interface EditFileInput {
  readonly path: string;
  readonly workspaceRoot: string;
  readonly oldText: string;
  readonly newText: string;
}

export interface EditFileResult {
  readonly path: string;
  readonly replacements: number;
}

export interface ListDirectoryInput {
  readonly path: string;
  readonly workspaceRoot: string;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: "file" | "directory" | "other";
}

export interface ListDirectoryResult {
  readonly path: string;
  readonly entries: DirectoryEntry[];
}

export interface SearchTextInput {
  readonly workspaceRoot: string;
  readonly pattern: string;
  readonly path?: string;
  readonly maxResults?: number;
}

export interface SearchTextMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchTextResult {
  readonly matches: SearchTextMatch[];
}

const DEFAULT_MAX_SEARCH_RESULTS = 100;
const SKIPPED_SEARCH_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".workspaceguard",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class FileService {
  constructor(private readonly allowedRoots: readonly string[]) {}

  async readFile(input: ReadFileInput): Promise<ReadFileResult> {
    const offset = normalizeNonNegativeInteger(input.offset ?? 0, "offset");
    const limit =
      input.limit === undefined
        ? undefined
        : normalizeNonNegativeInteger(input.limit, "limit");
    const filePath = await this.resolveFilePath(input.path, input.workspaceRoot, true);
    await assertFile(filePath, "read");

    const fullContent = decodeUtf8(await fs.readFile(filePath), filePath);
    const lines = splitLogicalLines(fullContent);
    const selectedLines =
      limit === undefined ? lines.slice(offset) : lines.slice(offset, offset + limit);
    const content =
      offset === 0 && limit === undefined ? fullContent : selectedLines.join("\n");

    return {
      path: filePath,
      content,
      totalLines: lines.length,
      returnedLines: selectedLines.length,
      offset,
      limited: offset > 0 || offset + selectedLines.length < lines.length,
    };
  }

  async writeFile(input: WriteFileInput): Promise<WriteFileResult> {
    const overwrite = input.overwrite === true;
    let filePath = await this.resolveFilePath(input.path, input.workspaceRoot, false);
    let created = !(await pathExists(filePath));

    if (!created && !overwrite) {
      throw new Error(`File already exists and overwrite is false: ${filePath}`);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    filePath = await this.resolveFilePath(input.path, input.workspaceRoot, false);
    created = !(await pathExists(filePath));

    if (!created && !overwrite) {
      throw new Error(`File already exists and overwrite is false: ${filePath}`);
    }

    await fs.writeFile(filePath, input.content, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });

    return {
      path: filePath,
      bytes: Buffer.byteLength(input.content, "utf8"),
      created,
    };
  }

  async editFile(input: EditFileInput): Promise<EditFileResult> {
    if (input.oldText.length === 0) {
      throw new TypeError("oldText must not be empty.");
    }

    const filePath = await this.resolveFilePath(input.path, input.workspaceRoot, true);
    await assertFile(filePath, "edit");

    const content = decodeUtf8(await fs.readFile(filePath), filePath);
    const firstMatch = content.indexOf(input.oldText);
    if (firstMatch === -1) {
      throw new Error(`oldText was not found in ${filePath}`);
    }
    if (content.indexOf(input.oldText, firstMatch + input.oldText.length) !== -1) {
      throw new Error(`oldText matched more than once in ${filePath}`);
    }

    const updatedContent =
      content.slice(0, firstMatch) +
      input.newText +
      content.slice(firstMatch + input.oldText.length);
    await fs.writeFile(filePath, updatedContent, "utf8");

    return {
      path: filePath,
      replacements: 1,
    };
  }

  async listDirectory(input: ListDirectoryInput): Promise<ListDirectoryResult> {
    const directoryPath = await this.resolveFilePath(input.path, input.workspaceRoot, true);
    await assertDirectory(directoryPath, "list");

    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = entries
      .map((entry) => ({
        name: entry.name,
        type: directoryEntryType(entry),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      path: directoryPath,
      entries: sortedEntries,
    };
  }

  async searchText(input: SearchTextInput): Promise<SearchTextResult> {
    if (input.pattern.length === 0) {
      throw new TypeError("pattern must not be empty.");
    }

    const maxResults =
      input.maxResults === undefined
        ? DEFAULT_MAX_SEARCH_RESULTS
        : normalizeNonNegativeInteger(input.maxResults, "maxResults");
    const startPath = await this.resolveFilePath(
      input.path ?? ".",
      input.workspaceRoot,
      true,
    );
    const matches: SearchTextMatch[] = [];

    if (maxResults === 0) {
      return { matches };
    }

    const stats = await fs.stat(startPath);
    if (stats.isFile()) {
      await searchFile(startPath, input.pattern, maxResults, matches);
    } else if (stats.isDirectory()) {
      await this.searchDirectory(startPath, input.pattern, maxResults, matches);
    }

    return { matches };
  }

  private async searchDirectory(
    directoryPath: string,
    pattern: string,
    maxResults: number,
    matches: SearchTextMatch[],
  ): Promise<void> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (matches.length >= maxResults) {
        return;
      }

      if (SKIPPED_SEARCH_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await this.searchDirectory(entryPath, pattern, maxResults, matches);
      } else if (entry.isFile()) {
        await searchFile(entryPath, pattern, maxResults, matches);
      }
    }
  }

  private async resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
    const resolved = await resolvePathWithinAllowedRoots(workspaceRoot, this.allowedRoots, {
      mustExist: true,
    });
    await assertDirectory(resolved.path, "use as workspace root");

    return resolved.path;
  }

  private async resolveFilePath(
    inputPath: string,
    workspaceRoot: string,
    mustExist: boolean,
  ): Promise<string> {
    const resolvedWorkspaceRoot = await this.resolveWorkspaceRoot(workspaceRoot);
    const resolved = await resolvePathWithinAllowedRoots(inputPath, [resolvedWorkspaceRoot], {
      baseDir: resolvedWorkspaceRoot,
      mustExist,
    });

    return resolved.path;
  }
}

async function searchFile(
  filePath: string,
  pattern: string,
  maxResults: number,
  matches: SearchTextMatch[],
): Promise<void> {
  const content = await readTextFileForSearch(filePath);
  if (content === undefined) {
    return;
  }

  const lines = splitLogicalLines(content);
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= maxResults) {
      return;
    }

    const text = lines[index];
    if (text.includes(pattern)) {
      matches.push({
        path: filePath,
        line: index + 1,
        text,
      });
    }
  }
}

async function readTextFileForSearch(filePath: string): Promise<string | undefined> {
  const content = await fs.readFile(filePath);
  if (content.includes(0)) {
    return undefined;
  }

  try {
    return UTF8_DECODER.decode(content);
  } catch {
    return undefined;
  }
}

function decodeUtf8(content: Buffer, filePath: string): string {
  try {
    return UTF8_DECODER.decode(content);
  } catch (error) {
    throw new Error(`File is not valid UTF-8 text: ${filePath}: ${errorMessage(error)}`);
  }
}

function splitLogicalLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

async function assertFile(filePath: string, action: string): Promise<void> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Cannot ${action} non-file path: ${filePath}`);
  }
}

async function assertDirectory(directoryPath: string, action: string): Promise<void> {
  const stats = await fs.stat(directoryPath);
  if (!stats.isDirectory()) {
    throw new Error(`Cannot ${action} non-directory path: ${directoryPath}`);
  }
}

function directoryEntryType(entry: import("node:fs").Dirent): DirectoryEntry["type"] {
  if (entry.isFile()) {
    return "file";
  }
  if (entry.isDirectory()) {
    return "directory";
  }

  return "other";
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.lstat(inputPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
