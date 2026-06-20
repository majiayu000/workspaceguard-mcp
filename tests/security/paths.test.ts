import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PathContainmentError,
  resolvePathWithinAllowedRoots,
} from "../../src/security/paths.js";

test("resolves contained paths and expands current-user home", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-paths-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const homeRoot = path.join(tempRoot, "home");
  const projectRoot = path.join(homeRoot, "project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "file.txt"), "ok");

  const resolved = await resolvePathWithinAllowedRoots("~/project/file.txt", [homeRoot], {
    homeDir: homeRoot,
    mustExist: true,
  });

  assert.equal(resolved.path, await fs.realpath(path.join(projectRoot, "file.txt")));
  assert.equal(resolved.root, await fs.realpath(homeRoot));
});

test("denies traversal outside allowed roots", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-paths-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const outsideRoot = path.join(tempRoot, "allowed-sibling");
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret");

  await assert.rejects(
    () =>
      resolvePathWithinAllowedRoots(path.join(allowedRoot, "..", "allowed-sibling", "secret.txt"), [allowedRoot], {
        mustExist: true,
      }),
    (error) =>
      error instanceof PathContainmentError &&
      error.code === "outside_allowed_roots" &&
      error.message.includes("outside allowed roots"),
  );
});

test("denies symlink escapes for existing and new paths", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-paths-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const outsideRoot = path.join(tempRoot, "outside");
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret");
  await fs.symlink(outsideRoot, path.join(allowedRoot, "escape"), "dir");

  await assert.rejects(
    () => resolvePathWithinAllowedRoots(path.join(allowedRoot, "escape", "secret.txt"), [allowedRoot], { mustExist: true }),
    /outside allowed roots/,
  );

  await assert.rejects(
    () => resolvePathWithinAllowedRoots(path.join(allowedRoot, "escape", "new.txt"), [allowedRoot]),
    /outside allowed roots/,
  );
});

test("allows symlinks that resolve inside an allowed root", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-paths-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const realDirectory = path.join(allowedRoot, "real");
  await fs.mkdir(realDirectory, { recursive: true });
  await fs.writeFile(path.join(realDirectory, "file.txt"), "ok");
  await fs.symlink(realDirectory, path.join(allowedRoot, "inside-link"), "dir");

  const resolved = await resolvePathWithinAllowedRoots(path.join(allowedRoot, "inside-link", "file.txt"), [allowedRoot], {
    mustExist: true,
  });

  assert.equal(resolved.path, await fs.realpath(path.join(realDirectory, "file.txt")));
  assert.equal(resolved.root, await fs.realpath(allowedRoot));
});

