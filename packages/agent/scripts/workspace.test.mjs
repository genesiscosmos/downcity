/**
 * @file 验证 Workspace 的资源边界、工具装配与独立生命周期。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../bin/index.js";

test("Workspace exposes file tools without requiring Shell", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));

  const workspace = new Workspace({ path: root_path });
  const agent = new Agent({ id: "workspace-files", workspace });
  t.after(async () => await agent.dispose());

  assert.equal(workspace.path, await fs.realpath(root_path));
  assert.deepEqual(Object.keys(workspace.tools).sort(), [
    "edit",
    "find",
    "grep",
    "read",
    "write",
  ]);
  assert.equal(agent.workspace, workspace);
  assert.equal(agent.getShell(), undefined);
});

test("Agent dispose does not close a shared Workspace", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-shared-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  let dispose_count = 0;
  const shell = {
    tools: { shell_exec: {} },
    bind(root_path) {
      assert.equal(root_path, workspace_path);
    },
    async dispose() {
      dispose_count += 1;
    },
  };
  const workspace_path = await fs.realpath(root_path);
  const workspace = new Workspace({ path: root_path, shell });
  const first_agent = new Agent({ id: "workspace-first", workspace });
  const second_agent = new Agent({ id: "workspace-second", workspace });

  await first_agent.dispose();
  await second_agent.dispose();
  assert.equal(dispose_count, 0);

  await workspace.dispose();
  await workspace.dispose();
  assert.equal(dispose_count, 1);
});
