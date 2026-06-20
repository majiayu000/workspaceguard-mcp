import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditEvent = Record<string, unknown>;

export class AuditLog {
  constructor(readonly filePath: string) {
    validateFilePath(filePath);
  }

  async append(event: AuditEvent): Promise<void> {
    await appendAuditEvent(this.filePath, event);
  }
}

export async function appendAuditEvent(filePath: string, event: AuditEvent): Promise<void> {
  validateFilePath(filePath);
  validateAuditEvent(event);

  const line = JSON.stringify(event);
  if (line === undefined) {
    throw new TypeError("audit event must be JSON serializable");
  }

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, { encoding: "utf8", flag: "a" });
}

function validateFilePath(filePath: string): void {
  if (filePath.length === 0) {
    throw new TypeError("audit log filePath must be a non-empty string");
  }
}

function validateAuditEvent(event: AuditEvent): void {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("audit event must be an object");
  }
}
