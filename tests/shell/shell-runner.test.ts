import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import test from "node:test";

import { redactSecrets, runShellCommand } from "../../src/shell/shell-runner.js";

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

test("runShellCommand captures stdout stderr and exit status", async (t) => {
  const cwd = await makeTempDir("wg-shell-capture-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const result = await runShellCommand({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('hello stdout'); process.stderr.write('hello stderr'); process.exit(7);",
    ],
    cwd,
    timeoutMs: 2_000,
  });

  assert.equal(result.stdout, "hello stdout");
  assert.equal(result.stderr, "hello stderr");
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.ok(result.durationMs >= 0);
});

test("runShellCommand passes args without invoking a shell", async (t) => {
  const cwd = await makeTempDir("wg-shell-args-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const shellLikeArg = "hello && echo hacked";
  const result = await runShellCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.argv[1]);", shellLikeArg],
    cwd,
    timeoutMs: 2_000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, shellLikeArg);
});

test("runShellCommand kills a process after timeout", async (t) => {
  const cwd = await makeTempDir("wg-shell-timeout-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const result = await runShellCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000);"],
    cwd,
    timeoutMs: 50,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
  assert.ok(result.durationMs < 5_000);
});

test("redactSecrets redacts environment-looking secret assignments", async () => {
  const redacted = redactSecrets(
    [
      "API_KEY=plain-secret",
      "PASSWORD=\"quoted secret\"",
      "token: abc123",
      "\"access_token\": \"json-secret\"",
      "authorization: Bearer bearer-secret",
    ].join("\n"),
  );

  assert.match(redacted, /API_KEY=\[REDACTED\]/);
  assert.match(redacted, /PASSWORD="\[REDACTED\]"/);
  assert.match(redacted, /token: \[REDACTED\]/);
  assert.match(redacted, /"access_token": "\[REDACTED\]"/);
  assert.match(redacted, /authorization: Bearer \[REDACTED\]/i);
  assert.doesNotMatch(redacted, /plain-secret|quoted secret|abc123|json-secret|bearer-secret/);
});
