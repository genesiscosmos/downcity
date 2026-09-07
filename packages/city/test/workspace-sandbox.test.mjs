/**
 * @file 验证 City、Workspace、Sandbox 与 Shell 的所有权和生命周期。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { City, LocalStorageProvider, Shell, Workspace } from "@downcity/city";
import { create_test_sandbox_provider } from "./PlatformSandbox.mjs";

test("Shell Provider 为每个 Workspace 创建独立 Sandbox", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sandbox-owner-"));
  await fs.mkdir(path.join(root_path, "one"));
  await fs.mkdir(path.join(root_path, "two"));
  const provider = create_test_sandbox_provider();
  const first_workspace = new Workspace({
    id: "one",
    path: path.join(root_path, "one"),
    shell: new Shell({ sandbox_provider: provider }),
  });
  const second_workspace = new Workspace({
    id: "two",
    path: path.join(root_path, "two"),
    shell: new Shell({ sandbox_provider: provider }),
  });
  const city = new City({
    storage: new LocalStorageProvider(path.join(root_path, "runtime")),
    workspaces: [first_workspace, second_workspace],
  });
  t.after(async () => {
    await city.close();
    await fs.rm(root_path, { recursive: true, force: true });
  });

  assert.equal(provider.workspaces.size, 2);
  const first_sandbox = provider.workspaces.get("one");
  const second_sandbox = provider.workspaces.get("two");
  assert.notEqual(first_sandbox.id, second_sandbox.id);
  assert.equal(first_sandbox.workspace_path, "/workspace");
  assert.equal(second_sandbox.workspace_path, "/workspace");
});

test("Workspace dispose 停止 Sandbox 但保留其 HOME", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sandbox-home-"));
  const runtime_path = path.join(root_path, "runtime");
  const provider = create_test_sandbox_provider();
  const workspace = new Workspace({
    id: "persistent-home",
    path: root_path,
    shell: new Shell({ sandbox_provider: provider }),
    runtime_path,
  });
  t.after(async () => await fs.rm(root_path, { recursive: true, force: true }));

  await workspace.shell.run_sandbox_command({
    execution_id: "write-home",
    cmd: "printf persistent > \"$HOME/tool.txt\"",
    cwd: workspace.path,
    shell_path: "/bin/sh",
    login: false,
    env: {},
  });
  await workspace.dispose();

  assert.equal(provider.workspaces.get("persistent-home").stopped, true);
  assert.equal(
    await fs.readFile(path.join(runtime_path, "sandbox-home", "tool.txt"), "utf8"),
    "persistent",
  );
});

test("Shell reset_sandbox 删除持久 HOME 后仍可重新执行", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sandbox-reset-"));
  const provider = create_test_sandbox_provider();
  const workspace = new Workspace({
    id: "reset-home",
    path: root_path,
    shell: new Shell({ sandbox_provider: provider }),
    runtime_path: path.join(root_path, "runtime"),
  });
  t.after(async () => {
    await workspace.dispose();
    await fs.rm(root_path, { recursive: true, force: true });
  });

  await workspace.shell.run_sandbox_command({
    execution_id: "write-before-reset",
    cmd: "printf temporary > \"$HOME/tool.txt\"",
    cwd: workspace.path,
    shell_path: "/bin/sh",
    login: false,
    env: {},
  });
  await workspace.shell.reset_sandbox();
  const result = await workspace.shell.run_sandbox_command({
    execution_id: "read-after-reset",
    cmd: "if [ -e \"$HOME/tool.txt\" ]; then printf exists; else printf missing; fi",
    cwd: workspace.path,
    shell_path: "/bin/sh",
    login: false,
    env: {},
  });

  assert.equal(result.stdout, "missing");
});

test("Sandbox cwd 只能映射当前 Workspace", async (t) => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-sandbox-cwd-"));
  const provider = create_test_sandbox_provider();
  const workspace = new Workspace({
    id: "cwd-boundary",
    path: root_path,
    shell: new Shell({ sandbox_provider: provider }),
    runtime_path: path.join(root_path, "runtime"),
  });
  t.after(async () => {
    await workspace.dispose();
    await fs.rm(root_path, { recursive: true, force: true });
  });

  await assert.rejects(
    workspace.shell.run_sandbox_command({
      execution_id: "escape",
      cmd: "pwd",
      cwd: path.dirname(workspace.path),
      shell_path: "/bin/sh",
      login: false,
      env: {},
    }),
    /escapes Workspace/,
  );
});
