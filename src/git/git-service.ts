import {
  runShellCommand,
  type ShellRunResult,
} from "../shell/shell-runner.js";

export interface GitCommandRequest {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface GitStatusResult extends ShellRunResult {
  porcelain: string;
}

export interface GitDiffResult extends ShellRunResult {
  diff: string;
}

const DEFAULT_GIT_TIMEOUT_MS = 30_000;

export async function getGitStatus(request: GitCommandRequest): Promise<GitStatusResult> {
  const result = await runShellCommand({
    command: "git",
    args: ["status", "--porcelain=v1"],
    cwd: request.cwd,
    timeoutMs: request.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    env: request.env,
  });

  return {
    ...result,
    porcelain: result.stdout,
  };
}

export async function getGitDiff(request: GitCommandRequest): Promise<GitDiffResult> {
  const result = await runShellCommand({
    command: "git",
    args: ["diff", "--no-color"],
    cwd: request.cwd,
    timeoutMs: request.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    env: request.env,
  });

  return {
    ...result,
    diff: result.stdout,
  };
}

export class GitService {
  constructor(private readonly defaultTimeoutMs: number = DEFAULT_GIT_TIMEOUT_MS) {}

  async status(request: GitCommandRequest): Promise<GitStatusResult> {
    return await getGitStatus({
      ...request,
      timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
    });
  }

  async diff(request: GitCommandRequest): Promise<GitDiffResult> {
    return await getGitDiff({
      ...request,
      timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
    });
  }
}
