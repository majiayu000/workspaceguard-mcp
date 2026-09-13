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

/**
 * Disable workspace-configured hooks / monitors that would run under a
 * read-scoped token. hooksPath points at a non-existent directory so
 * repository hooks (including post-index-change) cannot execute.
 */
const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/nonexistent-workspaceguard-git-hooks",
] as const;

const FILTER_CONFIG_PATTERN = String.raw`^filter\..*\.(clean|smudge|process)$`;

/**
 * Blank every configured filter driver command so `.gitattributes` filter
 * assignments cannot execute repository-controlled clean/smudge helpers.
 */
async function disabledFilterConfigArgs(
  request: GitCommandRequest,
): Promise<string[]> {
  const listed = await runShellCommand({
    command: "git",
    args: [...SAFE_GIT_CONFIG_ARGS, "config", "--get-regexp", FILTER_CONFIG_PATTERN],
    cwd: request.cwd,
    timeoutMs: request.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    env: request.env,
  });

  // git config exits 1 when there are no matches.
  if (listed.exitCode !== 0 && listed.exitCode !== 1) {
    return [];
  }

  const overrides: string[] = [];
  for (const line of listed.stdout.split(/\r?\n/)) {
    const key = line.trim().split(/\s+/)[0];
    if (!key) continue;
    overrides.push("-c", `${key}=`);
  }
  return overrides;
}

export async function getGitStatus(request: GitCommandRequest): Promise<GitStatusResult> {
  const filterOverrides = await disabledFilterConfigArgs(request);
  const result = await runShellCommand({
    command: "git",
    // --no-optional-locks avoids index refreshes that fire post-index-change.
    args: [
      ...SAFE_GIT_CONFIG_ARGS,
      ...filterOverrides,
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
    ],
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
  const filterOverrides = await disabledFilterConfigArgs(request);
  const result = await runShellCommand({
    command: "git",
    args: [
      ...SAFE_GIT_CONFIG_ARGS,
      ...filterOverrides,
      "--no-optional-locks",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
    ],
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
