import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileService } from "../../src/files/file-service.js";
import { PathContainmentError } from "../../src/security/paths.js";

async function makeWorkspace(t: test.TestContext): Promise<{
  readonly allowedRoot: string;
  readonly workspaceRoot: string;
  readonly service: FileService;
}> {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-files-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const workspaceRoot = path.join(allowedRoot, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });

  return {
    allowedRoot,
    workspaceRoot,
    service: new FileService([allowedRoot]),
  };
}

test("readFile returns full content and line-limited slices inside the workspace", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  const filePath = path.join(workspaceRoot, "notes.txt");
  await fs.writeFile(filePath, "one\ntwo\nthree\n", "utf8");

  const full = await service.readFile({
    path: "notes.txt",
    workspaceRoot,
  });

  assert.equal(full.path, await fs.realpath(filePath));
  assert.equal(full.content, "one\ntwo\nthree\n");
  assert.equal(full.totalLines, 3);
  assert.equal(full.returnedLines, 3);
  assert.equal(full.offset, 0);
  assert.equal(full.limited, false);

  const slice = await service.readFile({
    path: "notes.txt",
    workspaceRoot,
    offset: 1,
    limit: 1,
  });

  assert.equal(slice.content, "two");
  assert.equal(slice.totalLines, 3);
  assert.equal(slice.returnedLines, 1);
  assert.equal(slice.offset, 1);
  assert.equal(slice.limited, true);
});

test("writeFile creates parent directories and refuses existing files unless overwrite is true", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  const filePath = path.join(workspaceRoot, "nested", "created.txt");

  const created = await service.writeFile({
    path: "nested/created.txt",
    workspaceRoot,
    content: "created",
  });

  assert.equal(created.path, await fs.realpath(filePath));
  assert.equal(created.bytes, Buffer.byteLength("created", "utf8"));
  assert.equal(created.created, true);
  assert.equal(await fs.readFile(filePath, "utf8"), "created");

  await assert.rejects(
    () =>
      service.writeFile({
        path: "nested/created.txt",
        workspaceRoot,
        content: "blocked",
        overwrite: false,
      }),
    /overwrite is false/,
  );

  const overwritten = await service.writeFile({
    path: "nested/created.txt",
    workspaceRoot,
    content: "overwritten",
    overwrite: true,
  });

  assert.equal(overwritten.created, false);
  assert.equal(await fs.readFile(filePath, "utf8"), "overwritten");
});

test("editFile replaces exactly one occurrence and rejects missing or repeated matches", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  const filePath = path.join(workspaceRoot, "edit.txt");
  await fs.writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");

  const edited = await service.editFile({
    path: "edit.txt",
    workspaceRoot,
    oldText: "beta",
    newText: "BETA",
  });

  assert.equal(edited.path, await fs.realpath(filePath));
  assert.equal(edited.replacements, 1);
  assert.equal(await fs.readFile(filePath, "utf8"), "alpha\nBETA\ngamma\n");

  await assert.rejects(
    () =>
      service.editFile({
        path: "edit.txt",
        workspaceRoot,
        oldText: "missing",
        newText: "value",
      }),
    /oldText was not found/,
  );

  await fs.writeFile(filePath, "same\nsame\n", "utf8");
  await assert.rejects(
    () =>
      service.editFile({
        path: "edit.txt",
        workspaceRoot,
        oldText: "same",
        newText: "once",
      }),
    /oldText matched more than once/,
  );
});

test("listDirectory returns sorted file directory and other entries", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  await fs.writeFile(path.join(workspaceRoot, "b.txt"), "b", "utf8");
  await fs.mkdir(path.join(workspaceRoot, "a-dir"));
  await fs.symlink(path.join(workspaceRoot, "b.txt"), path.join(workspaceRoot, "c-link"));

  const result = await service.listDirectory({
    path: ".",
    workspaceRoot,
  });

  assert.equal(result.path, await fs.realpath(workspaceRoot));
  assert.deepEqual(result.entries, [
    { name: "a-dir", type: "directory" },
    { name: "b.txt", type: "file" },
    { name: "c-link", type: "other" },
  ]);
});

test("searchText finds literal matches and skips ignored directories and binary files", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  await fs.writeFile(path.join(workspaceRoot, "a.txt"), "needle one\nplain\n", "utf8");
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "b.txt"), "needle two\n", "utf8");
  await fs.mkdir(path.join(workspaceRoot, "node_modules"));
  await fs.writeFile(path.join(workspaceRoot, "node_modules", "ignored.txt"), "needle ignored\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));

  const result = await service.searchText({
    workspaceRoot,
    pattern: "needle",
  });

  assert.deepEqual(result.matches, [
    {
      path: await fs.realpath(path.join(workspaceRoot, "a.txt")),
      line: 1,
      text: "needle one",
    },
    {
      path: await fs.realpath(path.join(workspaceRoot, "src", "b.txt")),
      line: 1,
      text: "needle two",
    },
  ]);

  const limited = await service.searchText({
    workspaceRoot,
    pattern: "needle",
    maxResults: 1,
  });

  assert.equal(limited.matches.length, 1);
});

test("file operations reject traversal outside the workspace even when the allowed root is broader", async (t) => {
  const { service, allowedRoot, workspaceRoot } = await makeWorkspace(t);
  const siblingPath = path.join(allowedRoot, "sibling.txt");
  await fs.writeFile(siblingPath, "secret", "utf8");

  await assert.rejects(
    () =>
      service.readFile({
        path: "../sibling.txt",
        workspaceRoot,
      }),
    (error) =>
      error instanceof PathContainmentError &&
      error.code === "outside_allowed_roots",
  );

  await assert.rejects(
    () =>
      service.writeFile({
        path: "../new.txt",
        workspaceRoot,
        content: "blocked",
      }),
    (error) =>
      error instanceof PathContainmentError &&
      error.code === "outside_allowed_roots",
  );
});

test("file operations reject symlink escapes outside the workspace", async (t) => {
  const { service, workspaceRoot } = await makeWorkspace(t);
  const outsideRoot = path.join(path.dirname(path.dirname(workspaceRoot)), "outside");
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret", "utf8");
  await fs.symlink(outsideRoot, path.join(workspaceRoot, "escape"), "dir");

  await assert.rejects(
    () =>
      service.readFile({
        path: "escape/secret.txt",
        workspaceRoot,
      }),
    /outside allowed roots/,
  );

  await assert.rejects(
    () =>
      service.writeFile({
        path: "escape/new.txt",
        workspaceRoot,
        content: "blocked",
      }),
    /outside allowed roots/,
  );
});
