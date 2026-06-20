import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceRegistry } from "../../src/workspace/workspace-registry.js";

test("opens checkout workspace and discovers root and nested instructions", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-registry-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const workspaceRoot = path.join(allowedRoot, "project");
  await fs.mkdir(path.join(workspaceRoot, "packages", "app"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "build"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "coverage"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, ".workspaceguard"), { recursive: true });

  await fs.writeFile(path.join(workspaceRoot, "AGENTS.md"), "agent instructions");
  await fs.writeFile(path.join(workspaceRoot, "CLAUDE.md"), "claude instructions");
  await fs.writeFile(path.join(workspaceRoot, "packages", "app", "AGENTS.md"), "nested agent instructions");
  await fs.writeFile(path.join(workspaceRoot, "src", "CLAUDE.md"), "nested claude instructions");
  await fs.writeFile(path.join(workspaceRoot, "node_modules", "pkg", "AGENTS.md"), "ignored");
  await fs.writeFile(path.join(workspaceRoot, ".git", "AGENTS.md"), "ignored");
  await fs.writeFile(path.join(workspaceRoot, "dist", "CLAUDE.md"), "ignored");
  await fs.writeFile(path.join(workspaceRoot, "build", "AGENTS.md"), "ignored");
  await fs.writeFile(path.join(workspaceRoot, "coverage", "CLAUDE.md"), "ignored");
  await fs.writeFile(path.join(workspaceRoot, ".workspaceguard", "AGENTS.md"), "ignored");

  const registry = new WorkspaceRegistry({
    allowedRoots: [allowedRoot],
    idFactory: () => "ws_test",
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const workspace = await registry.openWorkspace({ path: workspaceRoot });

  assert.equal(workspace.workspaceId, "ws_test");
  assert.equal(workspace.root, await fs.realpath(workspaceRoot));
  assert.equal(workspace.mode, "checkout");
  assert.equal(workspace.openedAt, "2026-06-20T00:00:00.000Z");
  assert.deepEqual(
    workspace.instructionFiles.map((instructionFile) => instructionFile.path),
    ["AGENTS.md", "CLAUDE.md"],
  );
  assert.equal(workspace.instructionFiles[0]?.content, "agent instructions");
  assert.deepEqual(workspace.availableInstructionFiles, [
    "AGENTS.md",
    "CLAUDE.md",
    "packages/app/AGENTS.md",
    "src/CLAUDE.md",
  ]);

  assert.deepEqual(registry.resolveWorkspace("ws_test"), workspace);
});

test("rejects workspaces outside allowed roots", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-registry-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  const outsideRoot = path.join(tempRoot, "outside");
  await fs.mkdir(allowedRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });

  const registry = new WorkspaceRegistry({ allowedRoots: [allowedRoot] });

  await assert.rejects(
    () => registry.openWorkspace({ path: outsideRoot }),
    /outside allowed roots/,
  );
});

test("rejects unsupported workspace modes", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "wg-registry-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const allowedRoot = path.join(tempRoot, "allowed");
  await fs.mkdir(allowedRoot, { recursive: true });

  const registry = new WorkspaceRegistry({ allowedRoots: [allowedRoot] });

  await assert.rejects(
    () => registry.openWorkspace({ path: allowedRoot, mode: "worktree" }),
    /checkout workspaces only/,
  );
});

