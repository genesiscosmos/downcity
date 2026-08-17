/**
 * @file 验证 Workspace 的资源边界、工具装配与独立生命周期。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent, Workspace } from "../bin/index.js";

test("Workspace resolves the Downcity data root internally", async (t) => {
  const fixture_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-root-"));
  const project_path = path.join(fixture_root, "project");
  const platform_root = path.join(fixture_root, "platform");
  await fs.mkdir(project_path);
  const previous_root = process.env.DC_PLATFORM_ROOT;
  process.env.DC_PLATFORM_ROOT = platform_root;
  const agent = new Agent({ id: "internal-root-agent" });
  const entry = agent.enter(new Workspace({
    id: "internal-root-workspace",
    path: project_path,
  }));
  t.after(async () => {
    await agent.dispose();
    if (previous_root === undefined) delete process.env.DC_PLATFORM_ROOT;
    else process.env.DC_PLATFORM_ROOT = previous_root;
    await fs.rm(fixture_root, { recursive: true, force: true });
  });

  assert.equal(
    entry.data_path,
    path.join(
      platform_root,
      "workspaces",
      "internal-root-workspace",
    ),
  );
  assert.equal(await fs.stat(entry.data_path).then((value) => value.isDirectory()), true);
  assert.equal(await fs.stat(entry.data_path).then((value) => value.mode & 0o777), 0o700);
});

test("Workspace exposes file tools without requiring Shell", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-"));

  const workspace = new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") });
  const agent = new Agent({ id: "workspace-files" });
  const entry = agent.enter(workspace);
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
  assert.equal(entry.workspace, workspace);
  assert.equal(entry.get_shell(), undefined);
});

test("one Workspace instance enters one Agent and is disposed with it", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-shared-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  let dispose_count = 0;
  const shell = {
    tools: { shell_exec: {} },
    bind(binding) {
      assert.equal(binding.root_path, workspace_path);
      assert.match(binding.data_path, /data\/workspaces\/test_workspace$/);
    },
    set_env(env) {
      assert.deepEqual(env, {});
    },
    async dispose() {
      dispose_count += 1;
    },
  };
  const workspace_path = await fs.realpath(root_path);
  const workspace = new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data"), shell });
  const agent = new Agent({ id: "workspace-first" });
  const second_agent = new Agent({ id: "workspace-second" });
  agent.enter(workspace);
  assert.throws(
    () => second_agent.enter(workspace),
    /already bound to Agent "workspace-first"/,
  );

  await agent.dispose();
  await second_agent.dispose();
  await agent.dispose();
  assert.equal(dispose_count, 1);
});

test("separate Workspace instances may use the same directory", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-workspace-directory-"));
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const first_agent = new Agent({ id: "workspace-directory-first" });
  const second_agent = new Agent({ id: "workspace-directory-second" });
  const first_entry = first_agent.enter(new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }));
  const second_entry = second_agent.enter(new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }));
  assert.equal(first_entry.data_path, second_entry.data_path);
  await first_entry.sessions.create({ session_id: "first-session" });
  await second_entry.sessions.create({ session_id: "second-session" });
  assert.deepEqual(
    (await first_entry.sessions.list()).items.map((item) => item.session_id),
    ["first-session"],
  );
  assert.deepEqual(
    (await second_entry.sessions.list()).items.map((item) => item.session_id),
    ["second-session"],
  );

  await first_agent.dispose();
  await second_agent.dispose();
});

test("Session IDs are unique across Agents in one Workspace", async (t) => {
  const root_path = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-workspace-session-owner-"),
  );
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));
  const data_root_path = path.join(root_path, "data");
  const first_agent = new Agent({ id: "session-owner-first" });
  const second_agent = new Agent({ id: "session-owner-second" });
  const first_entry = first_agent.enter(new Workspace({
    id: "test_workspace",
    path: root_path,
    data_root_path,
  }));
  const second_entry = second_agent.enter(new Workspace({
    id: "test_workspace",
    path: root_path,
    data_root_path,
  }));

  const results = await Promise.allSettled([
    first_entry.sessions.create({ session_id: "shared-session" }),
    second_entry.sessions.create({ session_id: "shared-session" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );

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

  const workspace = new Workspace({ id: "test_workspace",
    path: root_path, data_root_path: path.join(root_path, "data"),
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

  const workspace_conflict_agent = new Agent({
    id: "workspace-tool-conflict",
    tools: { read: {} },
  });
  assert.throws(
    () => workspace_conflict_agent.enter(
      new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }),
    ),
    /Agent tool name conflict: "read"/,
  );
  const plugin_conflict_agent = new Agent({
    id: "plugin-tool-conflict",
    tools: { plugin_call: {} },
  });
  assert.throws(
    () => plugin_conflict_agent.enter(
      new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }),
    ),
    /reserved for PluginRegistry/,
  );
  await Promise.all([workspace_conflict_agent.dispose(), plugin_conflict_agent.dispose()]);
});
