import {
  createId,
  type TaskId,
  type WorkspaceId,
} from "../core/ids.js";
import { runShellCommand } from "../shell/shell-runner.js";

export type VerificationId = `verification_${string}`;
export type VerificationStatus = "passed" | "failed" | "timed_out";

export interface VerificationRecord {
  readonly verificationId: VerificationId;
  readonly workspaceId: WorkspaceId;
  readonly taskId?: TaskId;
  readonly status: VerificationStatus;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface VerificationServiceOptions {
  readonly idFactory?: () => VerificationId;
  readonly now?: () => Date;
  readonly defaultTimeoutMs?: number;
}

export interface RunVerificationInput {
  readonly workspaceId: WorkspaceId;
  readonly taskId?: TaskId;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export interface IsVerificationFreshInput {
  readonly verification: Pick<VerificationRecord, "createdAt">;
  readonly latestChangeAt: string | Date;
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 30_000;

export class VerificationService {
  private readonly idFactory: () => VerificationId;
  private readonly now: () => Date;
  private readonly defaultTimeoutMs: number;

  constructor(options: VerificationServiceOptions = {}) {
    this.idFactory = options.idFactory ?? createVerificationId;
    this.now = options.now ?? (() => new Date());
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  }

  async runVerification(input: RunVerificationInput): Promise<VerificationRecord> {
    const result = await runShellCommand({
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });
    const status = result.timedOut
      ? "timed_out"
      : result.exitCode === 0
        ? "passed"
        : "failed";

    return {
      verificationId: this.idFactory(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      status,
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      createdAt: this.now().toISOString(),
    };
  }

  isVerificationFresh(input: IsVerificationFreshInput): boolean {
    return isVerificationFresh(input);
  }
}

export function isVerificationFresh(input: IsVerificationFreshInput): boolean {
  const verifiedAt = parseTimestamp(input.verification.createdAt, "verification.createdAt");
  const latestChangeAt =
    input.latestChangeAt instanceof Date
      ? input.latestChangeAt
      : parseTimestamp(input.latestChangeAt, "latestChangeAt");

  return verifiedAt.getTime() >= latestChangeAt.getTime();
}

function createVerificationId(): VerificationId {
  return createId("verification") as VerificationId;
}

function parseTimestamp(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${label} must be a valid timestamp.`);
  }

  return parsed;
}
