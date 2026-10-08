/**
 * MemoryPower Provider 与本地 Adapter 回归测试。
 *
 * 关键点（中文）
 * - MemoryPower 只委托 Provider，不读取 Workspace 文件。
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
  MemoryPower,
  get_default_file_memory_root_path,
} from "@downcity/powers/memory";
import { SESSION_HOOK_POINTS } from "@downcity/agent";

/** 创建测试使用的最小 Agent 访问上下文。 */
function create_access(workspace_id, session_id, agent_id = "memory_test_agent") {
  return {
    agent_id,
    workspace_id,
    ...(session_id ? { session_id } : {}),
    city_memory_available: false,
  };
}

/** 创建符合公开协议的最小 PowerContext。 */
function create_power_context(agent_id = "memory_test_agent") {
  return {
    city: {
      powers: {
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

/** 创建 MemoryPower 生命周期测试使用的最小 City 上下文。 */
function create_start_context(storage_path) {
  return {
    storage: { path: storage_path, files: {} },
    power: { id: "memory", action() {}, config_action() {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      list_agents: async () => [],
      list_workspaces: async () => [],
      invoke_agent_power: async () => ({}),
      open_external: async () => {},
      show_item_in_folder: async () => {},
      write_clipboard_text: async () => {},
    },
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
  // Agent 私有记忆使用原始 agent_id 作为逻辑地址段，物理上落在 Agent 私有根。
  assert.match(remembered.memory_id, /^agent\/memory_test_agent\/wiki\/user-preferences$/);
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

test("File Adapter 拒绝目录穿越并由 Memory Power 定义默认路径", async (context) => {
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
    memory_id: "agent/memory_test_agent/wiki/invalid.name",
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

test("MemoryPower 使用显式运行时目录并公开完整 Action", async (context) => {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-platform-"));
  context.after(async () => await fs.rm(platform_root, { recursive: true, force: true }));
  const memory_root = path.join(platform_root, "powers", "memory");
  const power = new MemoryPower({ platform_root_path: platform_root });
  const power_context = create_power_context();
  await power.initialize(create_start_context(memory_root));
  const result = await power.actions.remember.execute({
    context: power_context,
    input: {
      content: "Remember this",
      target: "agent",
      topic: "test",
      memory_type: "fact",
    },
    power_name: "memory",
    action_name: "remember",
  });
  assert.equal(result.success, true);
  assert.match(result.data.memory_id, /\/wiki\/test$/);
  // Agent 私有记忆落在 `agents/<agent_id>/memory`，逻辑前缀不进入物理路径。
  assert.equal(
    await fs.access(path.join(platform_root, "agents", "memory_test_agent", "memory", "wiki", "test.md")).then(() => true).catch(() => false),
    true,
  );
  assert.equal("files" in power_context, false);
  assert.deepEqual(Object.keys(power.actions).sort(), [
    "digest",
    "forget",
    "list",
    "read",
    "remember",
    "revise",
    "search",
    "status",
  ]);
  await power.dispose();
});

test("Builtin Provider 枚举记忆并区分证据与投影", async (context) => {
  const memory_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-list-"));
  context.after(async () => await fs.rm(memory_root, { recursive: true, force: true }));
  const provider = new BuiltinMemoryProvider({
    storage: new FileMemoryStorageAdapter({ root_path: memory_root }),
  });
  await provider.initialize();
  const access = create_access("memory_list_workspace");
  await provider.remember({
    access,
    target: "agent",
    content: "User prefers concise answers.",
    topic: "user-preferences",
    memory_type: "preference",
  });
  await provider.remember({
    access,
    target: "agent",
    content: "Deploy uses the native sandbox backend.",
    topic: "deploy-notes",
    memory_type: "decision",
  });

  const listed = await provider.list({ access });
  assert.equal(listed.provider, "builtin");
  // 索引与两条投影都是 wiki 条目；证据条目默认不进入列表。
  assert.equal(listed.items.some((item) => item.is_evidence), false);
  assert.equal(listed.items.every((item) => item.subject.kind === "agent"), true);
  assert.equal(listed.subject_counts.agent, listed.total);
  assert.equal(listed.subject_counts.city, 0);
  assert.equal(listed.items.some((item) => item.title === "user-preferences"), true);

  const filtered = await provider.list({
    access,
    memory_types: ["decision"],
  });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].memory_type, "decision");
  // 过滤只影响 items，subject_counts 仍描述未过滤前的可读总量。
  assert.equal(filtered.subject_counts.agent, listed.total);

  const paged = await provider.list({ access, limit: 1, offset: 1 });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, listed.total);
  assert.notEqual(paged.items[0].memory_id, listed.items[0].memory_id);

  const with_evidence = await provider.list({ access, include_evidence: true });
  assert.equal(with_evidence.items.some((item) => item.is_evidence), true);
  assert.ok(with_evidence.total > listed.total);
  await provider.dispose();
});

test("MemoryPower 通过现有 Session Hook points 分离 Usage、Core 与 Recall", async (context) => {
  const platform_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-hooks-"));
  context.after(async () => await fs.rm(platform_root, { recursive: true, force: true }));
  const memory_root = path.join(platform_root, "powers", "memory");
  const power = new MemoryPower({ platform_root_path: platform_root });
  const power_context = create_power_context();
  await power.initialize(create_start_context(memory_root));
  await power.actions.remember.execute({
    context: power_context,
    input: {
      content: "The project prefers concise answers.",
      target: "agent",
      topic: "project-overview",
      memory_type: "preference",
    },
    power_name: "memory",
    action_name: "remember",
  });

  const usage = await power.system(power_context);
  assert.match(usage, /Memory actions usage|Preferred flow/);
  assert.doesNotMatch(usage, /prefers concise answers/);

  const system_hook = power.hooks.pipeline[SESSION_HOOK_POINTS.system_context][0];
  const system_value = await system_hook({
    context: power_context,
    power: "memory",
    value: { session_id: "session-1", blocks: [] },
  });
  assert.equal(system_value.blocks.length, 1);
  assert.equal(system_value.blocks[0].name, "memory/core/agent");
  assert.match(system_value.blocks[0].content, /prefers concise answers/);

  const turn_hook = power.hooks.pipeline[SESSION_HOOK_POINTS.turn_context][0];
  const turn_value = await turn_hook({
    context: power_context,
    power: "memory",
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

  const committed_hook = power.hooks.effect[SESSION_HOOK_POINTS.turn_committed][0];
  const canonical_messages = [{
    message_id: "user-capture-1",
    session_id: "session-1",
    turn_id: "turn-1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "user",
    parts: [{
      part_id: "text-capture-1",
      sequence: 1,
      type: "text",
      text: "以后回答请保持简洁。",
    }],
  }];
  await committed_hook({
    context: power_context,
    power: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-1",
      status: "completed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: power_context,
    power: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-1",
      status: "completed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: power_context,
    power: "memory",
    value: {
      session_id: "session-1",
      turn_id: "turn-failed",
      status: "failed",
      messages: canonical_messages,
    },
  });
  await committed_hook({
    context: power_context,
    power: "memory",
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
    context: power_context,
    power: "memory",
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
  const agent_prefix = "agent/memory_test_agent";
  const capture_root = path.join(platform_root, "agents", "memory_test_agent", "memory", "capture-jobs");
  const capture_jobs = await fs.readdir(capture_root);
  assert.equal(capture_jobs.length, 1);
  const capture_job = JSON.parse(await fs.readFile(
    path.join(capture_root, capture_jobs[0]),
    "utf8",
  ));
  assert.equal(capture_job.status, "pending");
  assert.equal(capture_job.turn_id, "turn-1");
  assert.equal(capture_job.messages[0].text, "以后回答请保持简洁。");

  await power.dispose();
});

test("City 共享记忆在两个 Agent 间可见，Agent 私有记忆保持隔离", async (context) => {
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-city-"));
  context.after(async () => await fs.rm(temporary_root, { recursive: true, force: true }));
  const platform_root = path.join(temporary_root, "platform");
  const city_root = path.join(temporary_root, "city-memory");
  const power = new MemoryPower({ platform_root_path: platform_root });
  const first_context = create_power_context("agent_a");
  const second_context = create_power_context("agent_b");
  await power.initialize(create_start_context(city_root));

  const private_memory = await power.actions.remember.execute({
    context: first_context,
    input: {
      content: "This Agent learned to run typecheck first.",
      target: "agent",
      topic: "project-overview",
      memory_type: "procedure",
    },
    power_name: "memory",
    action_name: "remember",
  });
  assert.equal(private_memory.success, true);
  assert.match(private_memory.data.memory_id, /^agent\/agent_a\/wiki\/project-overview$/);

  const shared_memory = await power.actions.remember.execute({
    context: first_context,
    input: {
      content: "This Workspace always uses pnpm.",
      target: "current_workspace",
      topic: "project-overview",
      memory_type: "decision",
    },
    power_name: "memory",
    action_name: "remember",
  });
  assert.equal(shared_memory.success, true);
  // Workspace 不是 Subject，current_workspace 写入共享根并落为 city 记忆。
  assert.match(shared_memory.data.memory_id, /^city\/wiki\/project-overview$/);

  const system_hook = power.hooks.pipeline[SESSION_HOOK_POINTS.system_context][0];
  const second_value = await system_hook({
    context: second_context,
    power: "memory",
    value: { session_id: "session-b", blocks: [] },
  });
  // 另一个 Agent 能看到共享记忆，但看不到 agent_a 的私有记忆。
  const shared_core = second_value.blocks.find((block) => block.name === "memory/core/city");
  assert.match(shared_core?.content || "", /always uses pnpm/);
  assert.equal(
    second_value.blocks.some((block) => block.content.includes("run typecheck first")),
    false,
  );

  const cross_agent_read = await power.actions.read.execute({
    context: second_context,
    input: { memory_id: private_memory.data.memory_id },
    power_name: "memory",
    action_name: "read",
  });
  assert.equal(cross_agent_read.success, false);
  assert.match(cross_agent_read.error, /outside the current access context/);

  await power.dispose();
});
