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

  const workspace = new Workspace({ path: root_path });
  const agent = new Agent({ id: "workspace-files", workspace });
  t.after(async () => {
    await agent.dispose();
    await fs.rm(root_path, { recursive: true, force: true });
  });

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

test("Workspace binds one Agent and is disposed with it", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-shared-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  let dispose_count = 0;
  const shell = {
    tools: { shell_exec: {} },
    bind(root_path) {
      assert.equal(root_path, workspace_path);
    },
    set_env(env) {
      assert.deepEqual(env, {});
    },
    async dispose() {
      dispose_count += 1;
    },
  };
  const workspace_path = await fs.realpath(root_path);
  const workspace = new Workspace({ path: root_path, shell });
  const agent = new Agent({ id: "workspace-first", workspace });
  assert.throws(
    () => new Agent({ id: "workspace-second", workspace }),
    /already bound to Agent "workspace-first"/,
  );

  await agent.dispose();
  await agent.dispose();
  assert.equal(dispose_count, 1);
});

test("separate Workspace instances may use the same directory", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-directory-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const first_agent = new Agent({
    id: "workspace-directory-first",
    workspace: new Workspace({ path: root_path }),
  });
  const second_agent = new Agent({
    id: "workspace-directory-second",
    workspace: new Workspace({ path: root_path }),
  });

  await first_agent.dispose();
  await second_agent.dispose();
});

test("Workspace owns env and publishes only real changes", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-env-"));
  await fs.writeFile(path.join(root_path, ".env"), "FROM_FILE=file\nOVERRIDE=file\n");
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const shell_env_snapshots = [];
  const shell = {
    tools: {},
    bind() {},
    set_env(env) {
      shell_env_snapshots.push({ ...env });
    },
    async dispose() {},
  };

  const workspace = new Workspace({
    path: root_path,
    shell,
    env: { OVERRIDE: "explicit", EXPLICIT: "value" },
  });
  const changes = [];
  const unsubscribe = workspace.subscribe_env((env) => changes.push({ ...env }));

  assert.deepEqual(workspace.get_env(), {
    FROM_FILE: "file",
    OVERRIDE: "explicit",
    EXPLICIT: "value",
  });
  assert.deepEqual(shell_env_snapshots, [workspace.get_env()]);
  workspace.patch_env({ OVERRIDE: "explicit" });
  assert.equal(changes.length, 0);

  workspace.patch_env({ FROM_FILE: null, NEXT: "next" });
  assert.deepEqual(changes, [{
    OVERRIDE: "explicit",
    EXPLICIT: "value",
    NEXT: "next",
  }]);
  assert.deepEqual(shell_env_snapshots.at(-1), changes.at(-1));

  unsubscribe();
  workspace.set_env({ ONLY: "one" });
  assert.deepEqual(workspace.get_env(), { ONLY: "one" });
  assert.equal(changes.length, 1);
  assert.deepEqual(shell_env_snapshots.at(-1), { ONLY: "one" });
  await workspace.dispose();
});

test("Agent rejects Workspace, Plugin and custom Tool name conflicts", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-tools-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));

  assert.throws(
    () => new Agent({
      id: "workspace-tool-conflict",
      workspace: new Workspace({ path: root_path }),
      tools: { read: {} },
    }),
    /Agent tool name conflict: "read"/,
  );
  assert.throws(
    () => new Agent({
      id: "plugin-tool-conflict",
      workspace: new Workspace({ path: root_path }),
      tools: { plugin_call: {} },
    }),
    /reserved for PluginRegistry/,
  );
});
