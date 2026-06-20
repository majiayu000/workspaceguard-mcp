import { spawn } from "node:child_process";

export interface ShellRunRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface ShellRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
}

const REDACTED_VALUE = "[REDACTED]";
const SECRET_KEY_PATTERN =
  String.raw`[A-Za-z0-9_]*(?:api[_-]?key|token|password|passwd|pwd|secret)[A-Za-z0-9_]*`;
const QUOTED_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(${SECRET_KEY_PATTERN})(\s*=\s*)(["'])([^\r\n]*?)(\3)`,
  "gi",
);
const UNQUOTED_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(${SECRET_KEY_PATTERN})(\s*=\s*)([^\s"'\r\n]+)`,
  "gi",
);
const QUOTED_PROPERTY_PATTERN = new RegExp(
  String.raw`(["']?${SECRET_KEY_PATTERN}["']?)(\s*:\s*)(["'])([^\r\n]*?)(\3)`,
  "gi",
);
const UNQUOTED_PROPERTY_PATTERN = new RegExp(
  String.raw`\b(${SECRET_KEY_PATTERN})(\s*:\s*)([^\s"'\r\n]+)`,
  "gi",
);
const BEARER_TOKEN_PATTERN = /\b(authorization\s*:\s*bearer\s+)([^\s]+)/gi;

export function redactSecrets(value: string): string {
  return value
    .replace(
      QUOTED_ASSIGNMENT_PATTERN,
      (
        _match: string,
        key: string,
        separator: string,
        quote: string,
        _secret: string,
        closeQuote: string,
      ): string => `${key}${separator}${quote}${REDACTED_VALUE}${closeQuote}`,
    )
    .replace(
      UNQUOTED_ASSIGNMENT_PATTERN,
      (_match: string, key: string, separator: string): string =>
        `${key}${separator}${REDACTED_VALUE}`,
    )
    .replace(
      QUOTED_PROPERTY_PATTERN,
      (
        _match: string,
        key: string,
        separator: string,
        quote: string,
        _secret: string,
        closeQuote: string,
      ): string => `${key}${separator}${quote}${REDACTED_VALUE}${closeQuote}`,
    )
    .replace(
      UNQUOTED_PROPERTY_PATTERN,
      (_match: string, key: string, separator: string): string =>
        `${key}${separator}${REDACTED_VALUE}`,
    )
    .replace(
      BEARER_TOKEN_PATTERN,
      (_match: string, prefix: string): string => `${prefix}${REDACTED_VALUE}`,
    );
}

export async function runShellCommand(request: ShellRunRequest): Promise<ShellRunResult> {
  validateRequest(request);

  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let timedOut = false;

  return await new Promise<ShellRunResult>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }
      settled = true;

      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (forceKillTimeout !== undefined) {
        clearTimeout(forceKillTimeout);
      }

      resolve({
        stdout: redactSecrets(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: redactSecrets(Buffer.concat(stderrChunks).toString("utf8")),
        exitCode,
        signal,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
      });
    };

    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env:
        request.env === undefined
          ? process.env
          : {
              ...process.env,
              ...request.env,
            },
      shell: false,
      windowsHide: true,
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (error: Error) => {
      stderrChunks.push(Buffer.from(`spawn ${request.command} failed: ${error.message}\n`));
      finish(null, null);
    });
    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      finish(exitCode, signal);
    });

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
      forceKillTimeout.unref();
    }, request.timeoutMs);
    timeout.unref();
  });
}

function validateRequest(request: ShellRunRequest): void {
  if (request.command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!Array.isArray(request.args)) {
    throw new TypeError("args must be an array");
  }
  for (const arg of request.args) {
    if (typeof arg !== "string") {
      throw new TypeError("args must contain only strings");
    }
  }
  if (request.cwd.length === 0) {
    throw new TypeError("cwd must be a non-empty string");
  }
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }
  if (request.env !== undefined) {
    for (const [key, value] of Object.entries(request.env)) {
      if (key.length === 0 || typeof value !== "string") {
        throw new TypeError("env must be a record of non-empty string keys to string values");
      }
    }
  }
}
