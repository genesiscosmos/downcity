/**
 * MemoryPlugin Provider 与本地 Adapter 回归测试。
 *
 * 关键点（中文）
 * - MemoryPlugin 只委托 Provider，不读取 Workspace 文件。
 * - Builtin Provider 只公开 memory_id/citation，不泄漏物理路径。
 * - File Adapter 始终把逻辑 key 限制在独占根目录。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BuiltinMemoryProvider,
  FileMemoryStorageAdapter,
  MemoryPlugin,
  get_default_file_memory_root_path,
} from "@downcity/plugins/memory";

/** 创建测试使用的最小 Agent scope。 */
function create_scope(workspace_path, session_id) {
  return {
    agent_id: "memory_test_agent",
    workspace_id: workspace_path,
    ...(session_id ? { session_id } : {}),
  };
}

test("Builtin Provider 把 Memory 数据写入独立 Adapter 根而不是 Workspace", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  const workspace_path = path.join(temporary_root, "workspace");
  const memory_root = path.join(temporary_root, "agent-data", "memory");
  await fs.mkdir(workspace_path, { recursive: true });
  const provider = new BuiltinMemoryProvider({
    storage: new FileMemoryStorageAdapter({ root_path: memory_root }),
  });
  await provider.initialize({ agent_id: "memory_test_agent" });

  const remembered = await provider.remember({
    scope: create_scope(workspace_path),
    content: "The user prefers concise answers.",
    topic: "user-preferences",
    memory_type: "preference",
    source: "explicit user statement",
  });
  assert.equal(remembered.memory_id, "wiki/user-preferences");
  assert.equal(remembered.mode, "created");
  assert.equal(await fs.stat(path.join(memory_root, "wiki", "user-preferences.md")).then(() => true), true);
  assert.equal(await fs.access(path.join(workspace_path, ".downcity", "memory")).then(() => true).catch(() => false), false);

  const recalled = await provider.recall({
    scope: create_scope(workspace_path),
    query: "concise answers",
    min_score: 0.1,
  });
  assert.equal(recalled.items[0]?.memory.memory_id, "wiki/user-preferences");
  assert.deepEqual(recalled.items[0]?.memory.scope, { agent_id: "memory_test_agent" });
  assert.match(recalled.items[0]?.memory.citation || "", /^memory:\/\/builtin\//);
  assert.equal(JSON.stringify(recalled).includes(memory_root), false);

  const read = await provider.read({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
  });
  assert.match(read.memory?.content || "", /concise answers/);
  assert.deepEqual(read.memory?.scope, { agent_id: "memory_test_agent" });

  await provider.remember({
    scope: create_scope(workspace_path, "session-that-must-not-own-memory"),
    content: "The user also prefers structured results.",
    topic: "user-preferences",
    memory_type: "preference",
    source: "second explicit user statement",
  });
  const updated_read = await provider.read({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
  });
  assert.equal(updated_read.memory?.source_refs.length, 2);
  assert.deepEqual(updated_read.memory?.scope, { agent_id: "memory_test_agent" });

  await assert.rejects(provider.read({
    scope: { agent_id: "another_agent" },
    memory_id: remembered.memory_id,
  }), /does not match initialized Provider/);
  await assert.rejects(provider.digest({
    scope: create_scope(workspace_path, "empty-session"),
    session_id: "empty-session",
    transcript: "",
    message_count: 0,
  }), /requires transcript content/);

  const revised = await provider.revise({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
    instruction: "Add the latest preference.",
    evidence: "The user also prefers structured results.",
  });
  assert.equal(revised.mode, "appended");
  assert.match(revised.evidence_id || "", /^evidence\/manual\//);
  const revised_read = await provider.read({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
  });
  assert.match(revised_read.memory?.content || "", /structured results/);
  assert.equal(revised_read.memory?.source_refs.length, 3);

  const forgotten = await provider.forget({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
  });
  assert.equal(forgotten.forgotten, true);
  assert.equal((await provider.read({
    scope: create_scope(workspace_path),
    memory_id: remembered.memory_id,
  })).memory, null);
  await provider.dispose();
});

test("File Adapter 拒绝目录穿越并由 Memory Plugin 定义默认路径", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-key-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  const adapter = new FileMemoryStorageAdapter({ root_path: temporary_root });
  await adapter.initialize();
  await assert.rejects(adapter.write("../outside.md", "blocked"), /Invalid Memory storage key/);
  await assert.rejects(adapter.read("wiki/../../outside.md"), /Invalid Memory storage key/);
  if (process.platform !== "win32") {
    const outside_root = path.join(path.dirname(temporary_root), `${path.basename(temporary_root)}-outside`);
    await fs.mkdir(outside_root, { recursive: true });
    context.after(async () => await fs.rm(outside_root, { recursive: true, force: true }));
    await fs.symlink(outside_root, path.join(temporary_root, "linked"), "dir");
    await assert.rejects(
      adapter.write("linked/outside.md", "blocked"),
      /contains symbolic link/,
    );
  }
  const provider = new BuiltinMemoryProvider({ storage: adapter });
  await provider.initialize({ agent_id: "memory_test_agent" });
  await assert.rejects(provider.read({
    scope: { agent_id: "memory_test_agent" },
    memory_id: "wiki/invalid.name",
  }), /Invalid memory_id/);
  assert.equal(
    get_default_file_memory_root_path({
      platform_root_path: "/platform-root",
      agent_id: "memory_test_agent",
    }),
    path.join("/platform-root", "agents", "memory_test_agent", "memory"),
  );
  await provider.dispose();
});

test("Builtin Provider 在 initialize 阶段按 Agent 延迟创建 Adapter", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-factory-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  const initialized_agents = [];
  const provider = new BuiltinMemoryProvider({
    create_storage(input) {
      initialized_agents.push(input.agent_id);
      return new FileMemoryStorageAdapter({
        root_path: path.join(temporary_root, input.agent_id),
      });
    },
  });
  assert.deepEqual(initialized_agents, []);
  await provider.initialize({ agent_id: "memory_test_agent" });
  assert.deepEqual(initialized_agents, ["memory_test_agent"]);
  await provider.dispose();
  await provider.initialize({ agent_id: "memory_test_agent" });
  assert.deepEqual(initialized_agents, ["memory_test_agent", "memory_test_agent"]);
  await provider.dispose();
});

test("MemoryPlugin 使用显式运行时目录并公开完整 Action", async (context) => {
  const memory_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-plugin-"));
  context.after(async () => await fs.rm(memory_root, { recursive: true, force: true }));
  const plugin = new MemoryPlugin({ root_path: memory_root });
  const plugin_context = {
    agent_id: "memory_test_agent",
    workspace_path: "/workspace",
  };
  await plugin.lifecycle.start(plugin_context);
  const result = await plugin.actions.remember.execute({
    context: plugin_context,
    input: {
      content: "Remember this",
      topic: "test",
      memory_type: "fact",
    },
    plugin_name: "memory",
    action_name: "remember",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.memory_id, "wiki/test");
  assert.equal(
    await fs.access(path.join(memory_root, "wiki", "test.md")).then(() => true).catch(() => false),
    true,
  );
  assert.equal("files" in plugin_context, false);
  await plugin.lifecycle.stop(plugin_context);
});
