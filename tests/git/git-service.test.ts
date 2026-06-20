import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { promisify } from "node:util";

import { getGitDiff, getGitStatus } from "../../src/git/git-service.js";

const execFileAsync = promisify(execFile);

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

test("getGitStatus returns porcelain v1 output scoped to cwd", async (t) => {
  const cwd = await makeTempDir("wg-git-status-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(join(cwd, "status-file.txt"), "hello\n", "utf8");

  const result = await getGitStatus({ cwd, timeoutMs: 2_000 });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.porcelain, result.stdout);
  assert.match(result.porcelain, /^\?\? status-file\.txt$/m);
});

test("getGitDiff returns no-color diff output scoped to cwd", async (t) => {
  const cwd = await makeTempDir("wg-git-diff-");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(join(cwd, "notes.txt"), "hello\n", "utf8");
  await runGit(cwd, ["add", "--intent-to-add", "notes.txt"]);

  const result = await getGitDiff({ cwd, timeoutMs: 2_000 });

  assert.equal(result.exitCode, 0);
  assert.equal(result.diff, result.stdout);
  assert.match(result.diff, /^\+hello$/m);
  assert.doesNotMatch(result.diff, /\u001b\[/);
});
