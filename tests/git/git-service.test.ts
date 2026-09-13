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

test("getGitStatus preserves clean filter semantics for reversible filters", async (t) => {
  const cwd = await makeTempDir("wg-git-filter-semantics-");
  const cleanPath = join(cwd, "clean.sh");
  const smudgePath = join(cwd, "smudge.sh");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(cleanPath, "#!/bin/sh\ntr a-z A-Z\n", "utf8");
  await writeFile(smudgePath, "#!/bin/sh\ntr A-Z a-z\n", "utf8");
  await execFileAsync("chmod", ["+x", cleanPath, smudgePath]);
  await writeFile(join(cwd, ".gitattributes"), "notes.txt filter=case\n", "utf8");
  await runGit(cwd, ["config", "filter.case.clean", cleanPath]);
  await runGit(cwd, ["config", "filter.case.smudge", smudgePath]);
  await writeFile(join(cwd, "notes.txt"), "hello\n", "utf8");
  await runGit(cwd, ["add", ".gitattributes", "notes.txt"]);
  await runGit(cwd, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"]);

  const status = await getGitStatus({ cwd, timeoutMs: 2_000 });
  assert.equal(status.exitCode, 0);
  assert.doesNotMatch(status.porcelain, /notes\.txt/);

  const diff = await getGitDiff({ cwd, timeoutMs: 2_000 });
  assert.equal(diff.exitCode, 0);
  assert.doesNotMatch(diff.diff, /notes\.txt/);
});
