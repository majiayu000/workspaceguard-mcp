import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("getGitDiff does not invoke external diff helpers under read scope", async (t) => {
  const cwd = await makeTempDir("wg-git-diff-no-ext-");
  const helperPath = join(cwd, "evil-helper.sh");
  const markerPath = join(cwd, "helper-ran.marker");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(join(cwd, "notes.bin"), "payload\n", "utf8");
  await writeFile(
    helperPath,
    `#!/bin/sh\necho ran > "${markerPath}"\ncat "$2"\n`,
    "utf8",
  );
  await execFileAsync("chmod", ["+x", helperPath]);
  await writeFile(join(cwd, ".gitattributes"), "notes.bin diff=evil\n", "utf8");
  await runGit(cwd, ["config", "diff.evil.command", helperPath]);
  await runGit(cwd, ["config", "diff.evil.textconv", helperPath]);
  await runGit(cwd, ["add", "--intent-to-add", "notes.bin"]);

  const result = await getGitDiff({ cwd, timeoutMs: 2_000 });

  assert.equal(result.exitCode, 0);
  assert.match(result.diff, /^\+payload$/m);
  await assert.rejects(() => access(markerPath), { code: "ENOENT" });
});

test("getGitStatus and getGitDiff do not invoke core.fsmonitor hooks", async (t) => {
  const cwd = await makeTempDir("wg-git-no-fsmonitor-");
  const hookPath = join(cwd, "fsmonitor-hook.sh");
  const markerPath = join(cwd, "fsmonitor-ran.marker");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(
    hookPath,
    `#!/bin/sh\necho ran > "${markerPath}"\nexit 0\n`,
    "utf8",
  );
  await execFileAsync("chmod", ["+x", hookPath]);
  await runGit(cwd, ["config", "core.fsmonitor", hookPath]);
  await writeFile(join(cwd, "tracked.txt"), "hello\n", "utf8");

  const status = await getGitStatus({ cwd, timeoutMs: 2_000 });
  assert.equal(status.exitCode, 0);
  await assert.rejects(() => access(markerPath), { code: "ENOENT" });

  // Intent-to-add can invoke fsmonitor; clear any side effects before asserting on getGitDiff.
  await execFileAsync("git", ["-c", "core.fsmonitor=false", "add", "--intent-to-add", "tracked.txt"], {
    cwd,
  });
  await rm(markerPath, { force: true });

  const diff = await getGitDiff({ cwd, timeoutMs: 2_000 });
  assert.equal(diff.exitCode, 0);
  await assert.rejects(() => access(markerPath), { code: "ENOENT" });
});

test("getGitDiff does not invoke clean filter helpers under read scope", async (t) => {
  const cwd = await makeTempDir("wg-git-diff-no-clean-");
  const cleanPath = join(cwd, "evil-clean.sh");
  const markerPath = join(cwd, "clean-ran.marker");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(join(cwd, "notes.txt"), "payload\n", "utf8");
  await writeFile(
    cleanPath,
    `#!/bin/sh\necho ran > "${markerPath}"\ncat\n`,
    "utf8",
  );
  await execFileAsync("chmod", ["+x", cleanPath]);
  await writeFile(join(cwd, ".gitattributes"), "notes.txt filter=evil\n", "utf8");
  await runGit(cwd, ["config", "filter.evil.clean", cleanPath]);
  await runGit(cwd, ["config", "filter.evil.smudge", "cat"]);
  await runGit(cwd, ["add", "--intent-to-add", "notes.txt"]);

  const result = await getGitDiff({ cwd, timeoutMs: 2_000 });

  assert.equal(result.exitCode, 0);
  assert.match(result.diff, /^\+payload$/m);
  await assert.rejects(() => access(markerPath), { code: "ENOENT" });
});

test("getGitStatus does not invoke post-index-change hooks", async (t) => {
  const cwd = await makeTempDir("wg-git-no-post-index-");
  const markerPath = join(cwd, "post-index-ran.marker");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ["init"]);
  await writeFile(join(cwd, "tracked.txt"), "hello\n", "utf8");
  await runGit(cwd, ["add", "tracked.txt"]);
  await runGit(cwd, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"]);

  const hookPath = join(cwd, ".git", "hooks", "post-index-change");
  await writeFile(
    hookPath,
    `#!/bin/sh\necho ran > "${markerPath}"\n`,
    "utf8",
  );
  await execFileAsync("chmod", ["+x", hookPath]);
  await writeFile(join(cwd, "tracked.txt"), "hello\nchanged\n", "utf8");

  const result = await getGitStatus({ cwd, timeoutMs: 2_000 });

  assert.equal(result.exitCode, 0);
  assert.match(result.porcelain, /tracked\.txt/);
  await assert.rejects(() => access(markerPath), { code: "ENOENT" });
});
