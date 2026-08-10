/** Cloudflare Computer Workspace 适配器行为测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareComputerWorkspace } from "../bin/index.js";

/** 创建只覆盖 Workspace 测试所需能力的内存 Computer 文件系统。 */
function create_memory_fs() {
  const files = new Map();
  return {
    async readFile(path) {
      if (!files.has(path)) throw new Error("ENOENT");
      return files.get(path);
    },
    async writeFile(path, content) { files.set(path, Buffer.from(content)); },
    async mkdir() {},
    async readdir() { return []; },
    async rm(path) { files.delete(path); },
    async rename(source_path, target_path) {
      if (!files.has(source_path)) throw new Error("ENOENT");
      files.set(target_path, files.get(source_path));
      files.delete(source_path);
    },
    async stat(path) {
      if (!files.has(path)) throw new Error("ENOENT");
      return { size: files.get(path).byteLength, isFile: true };
    },
  };
}

test("CloudflareComputerWorkspace 将相对路径限制在逻辑根目录", async () => {
  const workspace = new CloudflareComputerWorkspace({
    computer: { fs: create_memory_fs() },
  });
  await workspace.files.write_file_atomically("notes.md", "hello");
  assert.equal((await workspace.files.read_file("notes.md")).toString(), "hello");
  assert.equal(workspace.files.resolve_path("notes.md"), "/workspace/notes.md");
  assert.throws(() => workspace.files.resolve_path("../secret"), /escapes Workspace/);
  assert.deepEqual(Object.keys(workspace.tools).sort(), ["edit", "exec", "ls", "read", "write"]);
});

test("CloudflareComputerWorkspace 维持单 Agent 绑定和远程释放生命周期", async () => {
  let disposed = false;
  const workspace = new CloudflareComputerWorkspace({
    computer: { fs: create_memory_fs() },
    env: { NODE_ENV: "test" },
    dispose: () => { disposed = true; },
  });
  workspace.bind_agent("agent-one");
  assert.throws(() => workspace.bind_agent("agent-two"), /already bound/);
  assert.deepEqual(workspace.get_env(), { NODE_ENV: "test" });
  await workspace.dispose();
  assert.equal(disposed, true);
});

test("CloudflareComputerWorkspace 自动提供默认 Runtime exec 工具", async () => {
  const workspace = new CloudflareComputerWorkspace({
    computer: {
      fs: create_memory_fs(),
      shell: {
        async exec(command, options) {
          return {
            async result() {
              return {
                exitCode: 0,
                stdout: `${options.encoding}:${command}`,
                stderr: "",
              };
            },
          };
        },
      },
    },
  });
  const result = await workspace.tools.exec.execute({ command: "pwd" });
  assert.deepEqual(result, {
    command: "pwd",
    cwd: null,
    backend: null,
    exit_code: 0,
    stdout: "utf8:pwd",
    stderr: "",
  });
});
