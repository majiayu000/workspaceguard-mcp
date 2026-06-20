import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PathContainmentErrorCode =
  | "empty_path"
  | "unsupported_home"
  | "missing_path"
  | "inspect_failed"
  | "invalid_root"
  | "outside_allowed_roots";

export class PathContainmentError extends Error {
  readonly code: PathContainmentErrorCode;
  readonly attemptedPath?: string;
  readonly allowedRoots?: readonly string[];

  constructor(
    code: PathContainmentErrorCode,
    message: string,
    details: { attemptedPath?: string; allowedRoots?: readonly string[] } = {},
  ) {
    super(message);
    this.name = "PathContainmentError";
    this.code = code;
    this.attemptedPath = details.attemptedPath;
    this.allowedRoots = details.allowedRoots;
  }
}

export interface CanonicalPathOptions {
  readonly baseDir?: string;
  readonly homeDir?: string;
  readonly mustExist?: boolean;
}

export interface ContainedPath {
  readonly path: string;
  readonly root: string;
}

interface NearestExistingPath {
  readonly existingPath: string;
  readonly missingSegments: readonly string[];
}

export function expandHomePath(inputPath: string, homeDir = homedir()): string {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(homeDir, inputPath.slice(2));
  }

  if (inputPath.startsWith("~")) {
    throw new PathContainmentError(
      "unsupported_home",
      `Unsupported home path "${inputPath}". Only "~" for the current user is supported.`,
      { attemptedPath: inputPath },
    );
  }

  return inputPath;
}

export async function canonicalizePath(
  inputPath: string,
  options: CanonicalPathOptions = {},
): Promise<string> {
  const absolutePath = toAbsolutePath(inputPath, options);
  const nearest = await findNearestExistingPath(absolutePath);

  if (options.mustExist === true && nearest.missingSegments.length > 0) {
    throw new PathContainmentError(
      "missing_path",
      `Path does not exist: ${absolutePath}`,
      { attemptedPath: absolutePath },
    );
  }

  let realExistingPath: string;
  try {
    realExistingPath = await fs.realpath(nearest.existingPath);
  } catch (error) {
    throw new PathContainmentError(
      "inspect_failed",
      `Unable to resolve canonical path for ${nearest.existingPath}: ${errorMessage(error)}`,
      { attemptedPath: nearest.existingPath },
    );
  }

  return path.resolve(realExistingPath, ...nearest.missingSegments);
}

export async function canonicalizeAllowedRoots(
  allowedRoots: readonly string[],
  options: CanonicalPathOptions = {},
): Promise<string[]> {
  if (allowedRoots.length === 0) {
    throw new PathContainmentError(
      "invalid_root",
      "No allowed roots are configured.",
    );
  }

  const canonicalRoots = [];
  for (const root of allowedRoots) {
    const canonicalRoot = await canonicalizePath(root, { ...options, mustExist: true });
    const stats = await statDirectory(canonicalRoot, "allowed root");
    if (!stats.isDirectory()) {
      throw new PathContainmentError(
        "invalid_root",
        `Allowed root is not a directory: ${canonicalRoot}`,
        { attemptedPath: canonicalRoot },
      );
    }

    canonicalRoots.push(canonicalRoot);
  }

  return Array.from(new Set(canonicalRoots)).sort();
}

export async function resolvePathWithinAllowedRoots(
  inputPath: string,
  allowedRoots: readonly string[],
  options: CanonicalPathOptions = {},
): Promise<ContainedPath> {
  const canonicalRoots = await canonicalizeAllowedRoots(allowedRoots, options);
  const canonicalPath = await canonicalizePath(inputPath, options);
  const containingRoot = canonicalRoots.find((root) => isPathInsideRoot(canonicalPath, root));

  if (containingRoot === undefined) {
    throw new PathContainmentError(
      "outside_allowed_roots",
      `Path resolves outside allowed roots: ${canonicalPath}. Allowed roots: ${canonicalRoots.join(", ")}`,
      { attemptedPath: canonicalPath, allowedRoots: canonicalRoots },
    );
  }

  return { path: canonicalPath, root: containingRoot };
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toAbsolutePath(inputPath: string, options: CanonicalPathOptions): string {
  if (inputPath.trim() === "") {
    throw new PathContainmentError("empty_path", "Path must not be empty.");
  }

  const expandedPath = expandHomePath(inputPath, options.homeDir);
  return path.resolve(options.baseDir ?? process.cwd(), expandedPath);
}

async function findNearestExistingPath(absolutePath: string): Promise<NearestExistingPath> {
  let currentPath = absolutePath;
  const missingSegments: string[] = [];

  while (true) {
    try {
      await fs.lstat(currentPath);
      return { existingPath: currentPath, missingSegments: missingSegments.reverse() };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw new PathContainmentError(
          "inspect_failed",
          `Unable to inspect path ${currentPath}: ${errorMessage(error)}`,
          { attemptedPath: currentPath },
        );
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new PathContainmentError(
        "missing_path",
        `No existing parent directory found for ${absolutePath}`,
        { attemptedPath: absolutePath },
      );
    }

    missingSegments.push(path.basename(currentPath));
    currentPath = parentPath;
  }
}

async function statDirectory(inputPath: string, label: string) {
  try {
    return await fs.stat(inputPath);
  } catch (error) {
    throw new PathContainmentError(
      "invalid_root",
      `Unable to inspect ${label} ${inputPath}: ${errorMessage(error)}`,
      { attemptedPath: inputPath },
    );
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
