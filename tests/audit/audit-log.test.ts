import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { appendAuditEvent, AuditLog } from "../../src/audit/audit-log.js";

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

test("AuditLog creates parent directories and appends JSONL events", async (t) => {
  const cwd = await makeTempDir("wg-audit-log-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const auditPath = join(cwd, "nested", "events.jsonl");
  const auditLog = new AuditLog(auditPath);

  await auditLog.append({ type: "shell_run", status: "started" });
  await auditLog.append({ type: "shell_run", status: "finished", exitCode: 0 });

  const lines = (await readFile(auditPath, "utf8")).trimEnd().split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line) as unknown),
    [
      { type: "shell_run", status: "started" },
      { type: "shell_run", status: "finished", exitCode: 0 },
    ],
  );
});

test("appendAuditEvent appends without overwriting existing log contents", async (t) => {
  const cwd = await makeTempDir("wg-audit-append-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const auditPath = join(cwd, "events.jsonl");

  await appendAuditEvent(auditPath, { event: "first" });
  await appendAuditEvent(auditPath, { event: "second" });

  assert.equal(await readFile(auditPath, "utf8"), '{"event":"first"}\n{"event":"second"}\n');
});
