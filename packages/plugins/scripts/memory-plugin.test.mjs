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
import { SESSION_PLUGIN_POINTS } from "@downcity/agent";

/** 创建测试使用的最小 Agent 访问上下文。 */
function create_access(workspace_id, session_id, agent_id = "memory_test_agent") {
  return {
    agent_id,
    workspace_id,
    ...(session_id ? { session_id } : {}),
    city_memory_available: false,
  };
}

/** 创建符合公开协议的最小 PluginContext。 */
function create_plugin_context(agent_id = "memory_test_agent", user_id) {
  const embassy = user_id ? {
    user: {
      current: async () => ({
        user: { user_id, bureau_id: "city-1" },
        profile: null,
      }),
    },
  } : undefined;
  return {
    city: {
      ...(embassy ? { embassy } : {}),
      plugins: {
        get: () => null,
        snapshots: () => [],
        run_action: async () => ({ success: false }),
        pipeline: async (_point_name, value) => value,
        effect: async () => {},
      },
    },
    agent: {
      id: agent_id,
      name: agent_id,
      description: "",
      instructions: [],
      sessions: {},
    },
    workspace: {
      id: "shared-workspace",
      path: "/workspace",
      files: {},
      env: {},
    },
    profile: { id: "default", config: {} },
    storage: { path: "/memory", files: {} },
    logger: {
      log: async () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    abort_signal: new AbortController().signal,
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
  await provider.initialize();

  const remembered = await provider.remember({
    access: create_access("memory_test_workspace"),
    target: "agent",
    content: "The user prefers concise answers.",
    topic: "user-preferences",
    memory_type: "preference",
    source: "explicit user statement",
  });
  assert.match(remembered.memory_id, /^agent\/id_[A-Za-z0-9_-]+\/wiki\/user-preferences$/);
  assert.equal(remembered.mode, "created");
  assert.equal(await fs.stat(path.join(memory_root, `${remembered.memory_id}.md`)).then(() => true), true);
  assert.equal(await fs.access(path.join(workspace_path, ".downcity", "memory")).then(() => true).catch(() => false), false);

  const recalled = await provider.recall({
    access: create_access("memory_test_workspace"),
    query: "concise answers",
    min_score: 0.1,
  });
  assert.equal(recalled.items[0]?.memory.memory_id, remembered.memory_id);
  assert.deepEqual(recalled.items[0]?.memory.owner, {
    kind: "agent",
    agent_id: "memory_test_agent",
  });
  assert.deepEqual(recalled.items[0]?.memory.subject, {
    kind: "agent",
    agent_id: "memory_test_agent",
  });
  assert.match(recalled.items[0]?.memory.citation || "", /^memory:\/\/builtin\//);
  assert.equal(JSON.stringify(recalled).includes(memory_root), false);

  const read = await provider.read({
    access: create_access("memory_test_workspace"),
    memory_id: remembered.memory_id,
  });
  assert.match(read.memory?.content || "", /concise answers/);
  assert.deepEqual(read.memory?.subject, {
    kind: "agent",
    agent_id: "memory_test_agent",
  });

  await provider.remember({
    access: create_access("memory_test_workspace", "session-that-must-not-own-memory"),
    target: "agent",
    content: "The user also prefers structured results.",
    topic: "user-preferences",
    memory_type: "preference",
    source: "second explicit user statement",
  });
  const updated_read = await provider.read({
    access: create_access("memory_test_workspace"),
    memory_id: remembered.memory_id,
  });
  assert.equal(updated_read.memory?.source_refs.length, 2);
  assert.equal(updated_read.memory?.subject.kind, "agent");

  await assert.rejects(provider.read({
    access: { agent_id: "another_agent", city_memory_available: false },
    memory_id: remembered.memory_id,
  }), /outside the current access context/);
  await assert.rejects(provider.digest({
    access: create_access("memory_test_workspace", "empty-session"),
    session_id: "empty-session",
    transcript: "",
    message_count: 0,
  }), /requires transcript content/);

  const revised = await provider.revise({
    access: create_access("memory_test_workspace"),
    memory_id: remembered.memory_id,
    instruction: "Add the latest preference.",
    evidence: "The user also prefers structured results.",
  });
  assert.equal(revised.mode, "appended");
  assert.match(revised.evidence_id || "", /\/evidence\/manual\//);
  const revised_read = await provider.read({
    access: create_access("memory_test_workspace"),
    memory_id: remembered.memory_id,
  });
  assert.match(revised_read.memory?.content || "", /structured results/);
  assert.equal(revised_read.memory?.source_refs.length, 3);

  const forgotten = await provider.forget({
    access: create_access("memory_test_workspace"),
    memory_id: remembered.memory_id,
  });
  assert.equal(forgotten.forgotten, true);
  assert.equal((await provider.read({
    access: create_access("memory_test_workspace"),
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
  await provider.initialize();
  await assert.rejects(provider.read({
    access: create_access("memory_test_workspace"),
    memory_id: "agent/id_bWVtb3J5X3Rlc3RfYWdlbnQ/wiki/invalid.name",
  }), /Invalid memory_id/);
  assert.equal(
    get_default_file_memory_root_path({
      platform_root_path: "/platform-root",
      agent_id: "memory_test_agent",
    }),
    path.join("/platform-root", "agents", "memory_test_agent", "plugins", "memory"),
  );
  await provider.dispose();
});

test("Builtin Provider 在 initialize 阶段延迟创建 City 共享 Adapter", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-factory-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  let create_count = 0;
  const provider = new BuiltinMemoryProvider({
    create_storage() {
      create_count += 1;
      return new FileMemoryStorageAdapter({
        root_path: path.join(temporary_root, `adapter-${create_count}`),
      });
    },
  });
  assert.equal(create_count, 0);
  await provider.initialize();
  assert.equal(create_count, 1);
  await provider.dispose();
  await provider.initialize();
  assert.equal(create_count, 2);
  await provider.dispose();
});

test("MemoryPlugin 使用显式运行时目录并公开完整 Action", async (context) => {
  const memory_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-plugin-"));
  context.after(async () => await fs.rm(memory_root, { recursive: true, force: true }));
  const plugin = new MemoryPlugin({ storage_root_path: memory_root });
  const plugin_context = create_plugin_context();
  await plugin.lifecycle.start();
  const result = await plugin.actions.remember.execute({
    context: plugin_context,
    input: {
      content: "Remember this",
      target: "agent",
      topic: "test",
      memory_type: "fact",
    },
    plugin_name: "memory",
    action_name: "remember",
  });
  assert.equal(result.success, true);
  assert.match(result.data.memory_id, /\/wiki\/test$/);
  assert.equal(
    await fs.access(path.join(memory_root, `${result.data.memory_id}.md`)).then(() => true).catch(() => false),
    true,
  );
  assert.equal("files" in plugin_context, false);
  await plugin.lifecycle.stop();
});

test("MemoryPlugin 通过现有 Session Hook points 分离 Usage、Core 与 Recall", async (context) => {
  const memory_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-hooks-"));
  context.after(async () => await fs.rm(memory_root, { recursive: true, force: true }));
  const plugin = new MemoryPlugin({ storage_root_path: memory_root });
  const plugin_context = create_plugin_context();
  await plugin.lifecycle.start();
  await plugin.actions.remember.execute({
    context: plugin_context,
    input: {
      content: "The user prefers concise answers.",
      target: "agent",
      topic: "user-preferences",
      memory_type: "preference",
    },
    plugin_name: "memory",
    action_name: "remember",
  });

  const usage = await plugin.system(plugin_context);
  assert.match(usage, /Memory actions usage|Preferred flow/);
  assert.doesNotMatch(usage, /prefers concise answers/);

  const system_hook = plugin.hooks.pipeline[SESSION_PLUGIN_POINTS.system_context][0];
  const system_value = await system_hook({
    context: plugin_context,
    plugin: "memory",
    value: { session_id: "session-1", blocks: [] },
  });
  assert.equal(system_value.blocks.length, 1);
  assert.equal(system_value.blocks[0].name, "memory/core/agent");
  assert.match(system_value.blocks[0].content, /prefers concise answers/);

  const turn_hook = plugin.hooks.pipeline[SESSION_PLUGIN_POINTS.turn_context][0];
  const turn_value = await turn_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-1",
      user_messages: [{ message_id: "user-1", text: "concise answers" }],
      blocks: [],
    },
  });
  assert.equal(turn_value.blocks.length, 1);
  assert.equal(turn_value.blocks[0].name, "recall");
  assert.equal(turn_value.blocks[0].trust_level, "reference");
  assert.match(turn_value.blocks[0].content, /prefers concise answers/);

  const committed_hook = plugin.hooks.effect[SESSION_PLUGIN_POINTS.turn_committed][0];
  const canonical_messages = [{
    message_id: "user-capture-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "user",
    input_type: "prompt",
    parts: [{
      part_id: "text-capture-1",
      type: "text",
      text: "以后回答请保持简洁。",
      state: "done",
    }],
  }];
  await committed_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-1",
      status: "completed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-1",
      status: "completed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-failed",
      status: "failed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-greeting",
      status: "completed",
      messages: canonical_messages.map((message) => ({
        ...message,
        turn_id: "turn-greeting",
        parts: message.parts.map((part) => ({ ...part, text: "继续" })),
      })),
    },
  });
  await committed_hook({
    context: plugin_context,
    plugin: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-sensitive",
      status: "completed",
      messages: canonical_messages.map((message) => ({
        ...message,
        turn_id: "turn-sensitive",
        parts: message.parts.map((part) => ({
          ...part,
          text: "api_key: sk-sensitive-example-token",
        })),
      })),
    },
  });
  const agent_prefix = result_memory_prefix("memory_test_agent");
  const capture_root = path.join(memory_root, agent_prefix, "capture-jobs");
  const capture_jobs = await fs.readdir(capture_root);
  assert.equal(capture_jobs.length, 1);
  const capture_job = JSON.parse(await fs.readFile(
    path.join(capture_root, capture_jobs[0]),
    "utf8",
  ));
  assert.equal(capture_job.status, "pending");
  assert.equal(capture_job.turn_id, "turn-1");
  assert.equal(capture_job.messages[0].text, "以后回答请保持简洁。");

  await plugin.lifecycle.stop();
});

test("City User Memory 在两个 Agent 间共享并按可信用户隔离", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-city-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  const city_root = path.join(temporary_root, "city-memory");
  const plugin = new MemoryPlugin({ storage_root_path: city_root });
  const first_context = create_plugin_context("agent-a", "user/with unsafe path");
  const second_context = create_plugin_context("agent-b", "user/with unsafe path");
  await plugin.lifecycle.start();

  const remembered = await plugin.actions.remember.execute({
    context: first_context,
    input: {
      content: "The current user prefers concise answers.",
      target: "current_user",
      topic: "user-preferences",
      memory_type: "preference",
    },
    plugin_name: "memory",
    action_name: "remember",
  });
  assert.equal(remembered.success, true);
  assert.match(remembered.data.memory_id, /^city\/users\/id_[A-Za-z0-9_-]+\/wiki\/user-preferences$/);
  assert.equal(remembered.data.memory_id.includes("user/with unsafe path"), false);

  const workspace_memory = await plugin.actions.remember.execute({
    context: first_context,
    input: {
      content: "This Workspace always uses pnpm.",
      target: "current_workspace",
      topic: "project-overview",
      memory_type: "decision",
    },
    plugin_name: "memory",
    action_name: "remember",
  });
  assert.equal(workspace_memory.success, true);
  assert.match(workspace_memory.data.memory_id, /^city\/workspaces\/id_[A-Za-z0-9_-]+\/wiki\/project-overview$/);

  const system_hook = plugin.hooks.pipeline[SESSION_PLUGIN_POINTS.system_context][0];
  const system_value = await system_hook({
    context: second_context,
    plugin: "memory",
    value: { session_id: "session-b", blocks: [] },
  });
  assert.equal(system_value.blocks[0].name, "memory/core/user");
  assert.match(system_value.blocks[0].content, /prefers concise answers/);
  assert.equal(system_value.blocks[1].name, "memory/core/workspace");
  assert.match(system_value.blocks[1].content, /always uses pnpm/);

  const other_user_context = create_plugin_context("agent-b", "another-user");
  const isolated_value = await system_hook({
    context: other_user_context,
    plugin: "memory",
    value: { session_id: "session-other", blocks: [] },
  });
  assert.equal(
    isolated_value.blocks.some((block) => block.content.includes("prefers concise answers")),
    false,
  );
  assert.equal(
    isolated_value.blocks.some((block) => block.content.includes("always uses pnpm")),
    true,
  );

  const cross_user_read = await plugin.actions.read.execute({
    context: other_user_context,
    input: { memory_id: remembered.data.memory_id },
    plugin_name: "memory",
    action_name: "read",
  });
  assert.equal(cross_user_read.success, false);
  assert.match(cross_user_read.error, /outside the current access context/);

  const unauthenticated = await plugin.actions.remember.execute({
    context: create_plugin_context("agent-b"),
    input: {
      content: "Must not be written to a fallback user.",
      target: "current_user",
      topic: "user-preferences",
    },
    plugin_name: "memory",
    action_name: "remember",
  });
  assert.equal(unauthenticated.success, false);
  assert.match(unauthenticated.error, /authenticated user/);

  await plugin.lifecycle.stop();
});

/** 返回 Builtin Provider 对 Agent 数据使用的逻辑目录。 */
function result_memory_prefix(agent_id) {
  return `agent/id_${Buffer.from(agent_id, "utf8").toString("base64url")}`;
}
