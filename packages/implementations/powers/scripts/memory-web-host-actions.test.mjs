/**
 * Memory / Web Power 宿主管理 actions 的行为测试。
 *
 * 关键点（中文）
 * - Provider 快照与范围目录不调用领域 action，不依赖 Agent，也不读取记忆。
 * - 内容 action 沿用领域权限；Job 管理必须使用显式选定的 Agent 与可选 Workspace。
 * - 快照只暴露脱敏配置：密钥字段本身不得出现在任何界面协议里。
 * - 领域失败必须还原为异常，不能被界面当成空数据。
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BuiltinMemoryProvider, MemoryPower } from "@downcity/powers/memory";
import { WebPower } from "@downcity/powers/web";

/** 记录一次领域 action 调用。 */
function create_invocation_log() {
  return [];
}

/** 启动 Memory Power，并让宿主 system 记录领域调用。 */
async function start_memory_power(context, options = {}) {
  const actions = new Map();
  const invocations = create_invocation_log();
  const platform_root = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-memory-host-"));
  const storage_root = path.join(platform_root, "powers", "memory");
  const power = new MemoryPower({ ...options.power_options, platform_root_path: platform_root });
  const scope_reads = [];
  context.after(async () => {
    try { await power.dispose(); }
    finally { fs.rmSync(platform_root, { recursive: true, force: true }); }
  });
  await power.initialize({
    abort_signal: new AbortController().signal,
    config: { get: () => structuredClone(options.config ?? {}), set: async () => {}, path: "" },
    power: {
      id: "memory",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    storage: { path: storage_root, files: {} },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      register_execution_profile() { return () => {}; },
      async list_agents() {
        scope_reads.push("agents");
        return options.agents ?? [
          { agent_id: "agent-a", name: "Agent A" },
          { agent_id: "agent-b", name: "Agent B" },
        ];
      },
      async list_workspaces() {
        scope_reads.push("workspaces");
        return options.workspaces ?? [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: storage_root }];
      },
      async invoke_agent_power(input) {
        invocations.push(input);
        return await (options.on_invoke?.(input) ?? { success: true, data: {} });
      },
      async open_external() {},
      async show_item_in_folder() {},
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations, scope_reads, power, platform_root, storage_root };
}

/** 在当前 City 的真实 JobStore 目录发布测试记录，避免以界面身份伪造执行范围。 */
function write_memory_job(storage_root, id, overrides = {}) {
  const job = {
    job_id: id.repeat(64), request_key: `host-record-${id}`, kind: "digest", instruction: "Keep original evidence",
    access: { agent_id: "agent-a", city_memory_available: true, exclude_city: true },
    target: "agent", mode: "knowledge", status: "failed", attempt: 1,
    sources: [{ source_id: "original", agent_id: "agent-a", category: "work", role: "user", text: "Original evidence" }],
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
  const directory = path.join(storage_root, "processing", "jobs");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${job.job_id}.json`), JSON.stringify(job));
  return job;
}

/** 测试只调整已登记的整理账本，范围键与持久协议一致。 */
function dream_ledger_file(platform_root, scope) {
  const key = createHash("sha256").update(JSON.stringify([scope.agent_id, scope.workspace_id ?? null, scope.target])).digest("hex");
  return path.join(platform_root, "memory", "dreaming", "scopes", `${key}.json`);
}

/** 启动 Web Power，并让宿主 system 记录领域调用。 */
async function start_web_power(options = {}) {
  const actions = new Map();
  const invocations = create_invocation_log();
  let stored_config = options.config ?? {};
  const power = new WebPower();
  await power.initialize({
    abort_signal: new AbortController().signal,
    power: {
      id: "web",
      action(action) { actions.set(action.id, action); },
      config_action() {},
    },
    config: {
      path: options.config_path ?? "/tmp/downcity/powers/web/config.toml",
      get() { return structuredClone(stored_config); },
      async set(next) { stored_config = structuredClone(next); },
    },
    logger: { log: async () => {}, debug() {}, info() {}, warn() {}, error() {} },
    notifications: { publish: async () => {}, dismiss: async () => {} },
    system: {
      async list_agents() {
        return [{ agent_id: "agent-a", name: "Agent A" }];
      },
      async list_workspaces() {
        return [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/tmp" }];
      },
      async invoke_agent_power(input) {
        invocations.push(input);
        return await (options.on_invoke?.(input) ?? { success: true, data: {} });
      },
      async open_external(input) { options.on_open_external?.(input); },
      async show_item_in_folder(input) { options.on_show_item_in_folder?.(input); },
      async write_clipboard_text() {},
    },
  });
  return { actions, invocations };
}

test("Memory records 全局排序、筛选和分页只覆盖当前 City 可管理范围", async (context) => {
  const { actions, storage_root, invocations } = await start_memory_power(context);
  const a = write_memory_job(storage_root, "a");
  const b = write_memory_job(storage_root, "b", { access: { ...a.access, agent_id: "agent-b", workspace_id: "workspace-a" } });
  const c = write_memory_job(storage_root, "c", { updated_at: "2026-03-01T00:00:00.000Z" });
  write_memory_job(storage_root, "d", { access: { ...a.access, agent_id: "deleted-agent" } });
  write_memory_job(storage_root, "e", { access: { ...a.access, workspace_id: "deleted-workspace" } });
  // 同平台另一个 City 的目录不属于当前 JobStore。
  write_memory_job(path.join(storage_root, "other-city"), "f");
  const list = (input) => actions.get("memory.records.list").run(input);
  const all = await list();
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((item) => item.job_id), [c.job_id, a.job_id, b.job_id]);
  assert.ok(all.items.every((item) => !Object.hasOwn(item, "sources") && !Object.hasOwn(item, "access")));
  assert.deepEqual(await list({ limit: 1, offset: 1 }), { items: [all.items[1]], total: 3 });
  assert.deepEqual(await list({ limit: 1, offset: 20 }), { items: [], total: 3 });
  assert.deepEqual((await list({ agent_id: "agent-b" })).items, [all.items[2]]);
  assert.deepEqual((await list({ workspace_id: "workspace-a" })).items, [all.items[2]]);
  assert.deepEqual((await list({ workspace_id: "" })).items, all.items.slice(0, 2));
  assert.equal((await list({ agent_id: "agent-a", workspace_id: "workspace-a" })).total, 0);
  assert.equal((await list({ agent_id: "deleted-agent" })).total, 0);
  for (const input of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }]) {
    await assert.rejects(() => list(input));
  }
  assert.deepEqual(invocations, []);
});

test("Memory records 无 Agent 返回空列表，已删除范围的详情和重试均拒绝", async (context) => {
  const agents = [{ agent_id: "agent-a", name: "Agent A" }];
  const workspaces = [{ workspace_id: "workspace-a", name: "Workspace A" }];
  const { actions, storage_root } = await start_memory_power(context, { agents, workspaces });
  const job = write_memory_job(storage_root, "a", { access: { agent_id: "agent-a", workspace_id: "workspace-a" } });
  const detail = actions.get("memory.records.detail");
  const retry = actions.get("memory.records.retry");
  workspaces.length = 0;
  for (const action of [detail, retry]) {
    await assert.rejects(() => action.run({ job_id: job.job_id }), /host management scope/u);
  }
  assert.deepEqual(await actions.get("memory.records.list").run(), { items: [], total: 0 });
  write_memory_job(storage_root, "b");
  agents.length = 0;
  assert.deepEqual(await actions.get("memory.records.list").run(), { items: [], total: 0 });
  for (const action of [detail, retry]) {
    await assert.rejects(() => action.run({ job_id: "b".repeat(64) }), /host management scope/u);
    await assert.rejects(() => action.run({ job_id: job.job_id, agent_id: "agent-a" }));
    await assert.rejects(() => action.run({ job_id: "f".repeat(64) }), /not found/u);
  }
});

test("Memory records 详情与重试使用 Job 原 access，普通 Agent 权限不扩大", async (context) => {
  const { actions, storage_root, power, invocations } = await start_memory_power(context);
  const changes = [{ operation: "create", topic: "Captured", before: null, after: { content: "Fixed snapshot" },
    captured_at: "2026-01-01T00:00:00.000Z", sources: [] }];
  const job = write_memory_job(storage_root, "a", {
    access: { agent_id: "agent-b", workspace_id: "workspace-a", city_memory_available: true, exclude_city: true },
    change_details: changes,
  });
  const detail = await actions.get("memory.records.detail").run({ job_id: job.job_id });
  assert.deepEqual(detail.changes, changes);
  assert.equal(detail.job.agent_id, "agent-b");
  assert.equal(detail.job.workspace_id, "workspace-a");
  const retried = [];
  // 私有字段只在隔离验证中替换执行入口；保留 Service 的真实访问检查，不启动模型。
  power.coordinator.retry = async (original) => { retried.push(structuredClone(original)); return { ...original, status: "queued" }; };
  const result = await actions.get("memory.records.retry").run({ job_id: job.job_id });
  assert.equal(result.status, "queued");
  assert.deepEqual(retried, [job]);
  const foreign_access = { ...job.access, agent_id: "agent-a" };
  for (const method of ["job_detail", "retry"]) {
    await assert.rejects(() => power.service_instance[method](foreign_access, job.job_id), /outside the current execution context/u);
  }
  assert.equal(retried.length, 1);
  assert.deepEqual(invocations, []);
});

test("Memory dream.list 只读已启用合法范围，不创建空 ledger 且传播读取错误", async (context) => {
  const { actions, platform_root, invocations } = await start_memory_power(context);
  const list = () => actions.get("memory.dream.list").run();
  const directory = path.join(platform_root, "memory", "dreaming", "scopes");
  assert.deepEqual(await list(), { items: [] });
  assert.equal(fs.existsSync(directory), false);
  const valid = { agent_id: "agent-a", target: "agent" };
  const disabled = { agent_id: "agent-b", target: "agent" };
  const deleted_agent = { agent_id: "deleted", target: "agent" };
  const deleted_workspace = { agent_id: "agent-a", workspace_id: "deleted", target: "agent" };
  const missing_workspace = { agent_id: "agent-a", target: "current_workspace" };
  const shared = { agent_id: "agent-b", workspace_id: "workspace-a", target: "current_workspace" };
  await actions.get("memory.dream.configure").run({ ...valid, enabled: true });
  await actions.get("memory.dream.configure").run({ ...disabled, enabled: false });
  const base = JSON.parse(fs.readFileSync(dream_ledger_file(platform_root, valid), "utf8"));
  for (const scope of [valid, deleted_agent, deleted_workspace, missing_workspace, shared]) {
    fs.writeFileSync(dream_ledger_file(platform_root, scope), JSON.stringify({ ...base, scope, enabled: true,
      signals: [{ state: "processed" }, { state: "received" }, { state: "error" }], last_error: "Source unavailable" }));
  }
  const files_before = fs.readdirSync(directory).sort();
  const summaries = await list();
  summaries.items.sort((left, right) => left.scope.agent_id.localeCompare(right.scope.agent_id));
  assert.deepEqual(summaries, { items: [valid, shared].map((scope) => ({ scope, backlog: 2, last_error: "Source unavailable" })) });
  assert.deepEqual(fs.readdirSync(directory).sort(), files_before);
  fs.writeFileSync(dream_ledger_file(platform_root, valid), "invalid json");
  await assert.rejects(list, SyntaxError);
  assert.deepEqual(invocations, []);
});

test("Memory records dream 重试沿原 scope 与 batch 执行冷却、启用和次数预算", async (context) => {
  const { actions, platform_root, storage_root, power } = await start_memory_power(context);
  const scope = { agent_id: "agent-b", workspace_id: "workspace-a", target: "agent" };
  await actions.get("memory.dream.configure").run({ ...scope, enabled: true });
  const job = write_memory_job(storage_root, "a", { kind: "dream", access: {
    agent_id: scope.agent_id, workspace_id: scope.workspace_id, city_memory_available: true, exclude_city: true,
  } });
  const ledger_path = dream_ledger_file(platform_root, scope);
  const ledger = JSON.parse(fs.readFileSync(ledger_path, "utf8"));
  ledger.batches = [{ batch_id: "b".repeat(64), job_id: job.job_id, owner_id: power.dreaming.owner_id, status: "failed", signal_ids: [] }];
  const save = () => fs.writeFileSync(ledger_path, JSON.stringify(ledger));
  const retry = () => actions.get("memory.records.retry").run({ job_id: job.job_id });
  const retried = [];
  power.coordinator.reconcile_committed = async (original) => original;
  power.coordinator.retry = async (original) => {
    retried.push(structuredClone(original));
    return write_memory_job(storage_root, "a", { ...original, status: "queued" });
  };
  ledger.enabled = false; save();
  await assert.rejects(retry, /Enable this exact dream scope/u);
  ledger.enabled = true; ledger.next_run_at = new Date(Date.now() + 60_000).toISOString(); save();
  await assert.rejects(retry, /cooldown or daily budget/u);
  ledger.next_run_at = undefined; ledger.budget_used = 100; save();
  await assert.rejects(retry, /Daily dream computation budget/u);
  ledger.budget_used = 0; save();
  write_memory_job(storage_root, "a", { ...job, attempt: 3 });
  await assert.rejects(retry, /attempt budget/u);
  write_memory_job(storage_root, "a", job);
  ledger.batches[0].owner_id = "another-city"; save();
  await assert.rejects(retry, /another City/u);
  assert.equal(retried.length, 0);
  ledger.batches[0].owner_id = power.dreaming.owner_id; save();
  const result = await retry();
  assert.equal(result.job_id, job.job_id);
  assert.equal(result.status, "queued");
  assert.deepEqual(retried, [job]);
  const updated = JSON.parse(fs.readFileSync(ledger_path, "utf8"));
  assert.equal(updated.budget_used, 1);
  assert.ok(Date.parse(updated.next_run_at) > Date.now());
});

test("Memory Provider 无 Agent 或 Workspace 也能返回真实状态，且不读取范围目录", async (context) => {
  const { actions, invocations, scope_reads, power } = await start_memory_power(context, {
    agents: [], workspaces: [],
    on_invoke: () => { throw new Error("Provider snapshot must not invoke domain actions"); },
  });
  scope_reads.length = 0;
  const snapshot = await actions.get("memory.config.snapshot").run(undefined);
  assert.equal(snapshot.knowledge.status.provider, "builtin");
  assert.equal(snapshot.knowledge.status.state, "ready");
  assert.equal(snapshot.knowledge.status.capabilities.list, true);
  assert.deepEqual(snapshot.knowledge.status.details, {
    initialized: true, storage_adapter: "owner-router", city_memory_available: true,
  });
  assert.equal(Object.hasOwn(snapshot, "model_id"), false);
  assert.deepEqual(scope_reads, []);
  assert.deepEqual(invocations, []);

  await power.provider.dispose();
  const stopped = await actions.get("memory.config.snapshot").run(undefined);
  assert.equal(stopped.knowledge.status.state, "degraded");
  assert.equal(stopped.knowledge.status.details.initialized, false);
  assert.deepEqual(scope_reads, []);
  assert.deepEqual(invocations, []);
});

test("Memory Provider 模型快照使用初始化时的 options/config 选择", async (context) => {
  for (const [power_options, config, expected_model] of [
    [{ model_id: "option-model" }, { model_id: "config-model" }, "option-model"],
    [{}, { model_id: "config-model" }, "config-model"],
    [{}, { model_id: 123 }, undefined],
  ]) {
    const { actions } = await start_memory_power(context, { power_options, config });
    const snapshot = await actions.get("memory.config.snapshot").run(undefined);
    assert.equal(snapshot.processing.model_id, expected_model);
    if (expected_model === undefined) assert.equal(Object.hasOwn(snapshot, "model_id"), false);
  }
});

test("Builtin Provider 检查初始化失败和释放后的真实生命周期，不读取存储内容", async () => {
  let fail_initialization = true;
  const provider = new BuiltinMemoryProvider({
    city_memory_available: false,
    create_storage: async () => ({
      name: "test-adapter",
      async initialize() { if (fail_initialization) throw new Error("Adapter unavailable"); },
      async dispose() {},
      async list() { throw new Error("inspect must not enumerate memories"); },
      async read() { throw new Error("inspect must not read memories"); },
    }),
  });
  const pending = await provider.inspect();
  assert.equal(pending.state, "degraded");
  assert.equal(pending.details.initialized, false);
  assert.equal(Object.hasOwn(pending.details, "storage_adapter"), false);
  await assert.rejects(() => provider.initialize(), /Adapter unavailable/u);
  assert.equal((await provider.inspect()).state, "degraded");
  fail_initialization = false;
  await provider.initialize();
  try {
    const ready = await provider.inspect();
    assert.equal(ready.state, "ready");
    assert.deepEqual(ready.details, {
      initialized: true, storage_adapter: "test-adapter", city_memory_available: false,
    });
  } finally { await provider.dispose(); }
  const stopped = await provider.inspect();
  assert.equal(stopped.state, "degraded");
  assert.equal(Object.hasOwn(stopped.details, "storage_adapter"), false);
});

test("Memory scopes 只返回宿主目录，不调用领域工具或枚举知识", async (context) => {
  const agents = [{ agent_id: "agent-a", name: "Agent A", memory_count: 99, extra: "private" }];
  const workspaces = [{ workspace_id: "workspace-a", name: "Workspace A", workspace_path: "/private/path" }];
  const { actions, invocations } = await start_memory_power(context, {
    agents, workspaces,
    on_invoke: () => { throw new Error("Scope directory must not invoke domain actions"); },
  });
  assert.deepEqual(await actions.get("memory.scopes").run(undefined), {
    agents: [{ agent_id: "agent-a", name: "Agent A" }],
    workspaces: [{ workspace_id: "workspace-a", name: "Workspace A" }],
  });
  assert.deepEqual(invocations, []);
  agents.length = 0;
  workspaces.length = 0;
  assert.deepEqual(await actions.get("memory.scopes").run(undefined), { agents: [], workspaces: [] });
  assert.deepEqual(invocations, []);
});

test("Memory Job 管理要求有效 Agent，空 Workspace 表示无项目且不回退", async (context) => {
  const { actions, invocations } = await start_memory_power(context);
  for (const action_id of ["memory.jobs", "memory.job_status", "memory.job_detail", "memory.retry"]) {
    const action = actions.get(action_id);
    const base = { job_id: "a".repeat(64) };
    for (const agent_id of ["", "missing-agent"]) {
      await assert.rejects(() => action.run({ ...base, agent_id }), /selected Agent|Agent was not found/u);
    }
    await assert.rejects(() => action.run({ ...base, agent_id: "agent-a", workspace_id: "missing-workspace" }),
      /Workspace was not found/u);
    assert.equal(invocations.length, 0);
  }
  for (const action_id of ["memory.jobs", "memory.job_status", "memory.job_detail", "memory.retry"]) {
    const action = actions.get(action_id);
    const base = { agent_id: "agent-b", job_id: "a".repeat(64) };
    for (const workspace_id of [undefined, "", "workspace-a"]) {
      await action.run({ ...base, ...(workspace_id === undefined ? {} : { workspace_id }) });
      const call = invocations.at(-1);
      assert.equal(call.agent_id, "agent-b");
      assert.equal(call.workspace_id, workspace_id || undefined);
      if (!workspace_id) assert.equal(Object.hasOwn(call, "workspace_id"), false);
    }
  }
});

test("Memory 内容 action 拒绝无效范围，空 Workspace 不回退且共享入口可省略 Agent", async (context) => {
  const memory_id = "agent/agent-a/wiki/x";
  const { actions, invocations } = await start_memory_power(context, {
    on_invoke: async (input) => {
      if (input.action_id === "list") return { success: true, data: { provider: "builtin", items: [], total: 0 } };
      if (input.action_id === "read") return { success: true, data: { memory_id, memory: null } };
      return { success: true, data: { memory_id, forgotten: true, status: "queued", job_id: "a".repeat(64) } };
    },
  });
  for (const action_id of ["memory.list", "memory.read", "memory.remember", "memory.revise", "memory.forget"]) {
    const base = { memory_id, content: "x", instruction: "y", target: "agent" };
    const action = actions.get(action_id);
    await assert.rejects(() => action.run({ ...base, agent_id: "missing-agent" }), /Agent was not found/u);
    await assert.rejects(() => action.run({ ...base, agent_id: "agent-a", workspace_id: "missing-workspace" }),
      /Workspace was not found/u);
    for (const agent_id of ["agent-a", ""]) {
      for (const workspace_id of [undefined, ""]) {
        invocations.length = 0;
        await action.run({ ...base, agent_id, ...(workspace_id === undefined ? {} : { workspace_id }) });
        assert.ok(invocations.length > 0);
        for (const call of invocations) {
          assert.equal(call.agent_id, "agent-a");
          assert.equal(Object.hasOwn(call, "workspace_id"), false);
        }
      }
    }
  }
  await assert.rejects(() => actions.get("memory.remember").run({
    agent_id: "agent-a", workspace_id: "", content: "x", target: "current_workspace",
  }), /Workspace memory requires a Workspace/u);
});

test("Memory 内容与 Job action 在选定执行范围上调用领域 action", async (context) => {
  const job_view = {
    job_id: "a".repeat(64), kind: "revise", status: "queued",
    target: "agent", mode: "knowledge", agent_id: "agent-a", workspace_id: "workspace-a",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  };
  const { actions, invocations } = await start_memory_power(context, {
    on_invoke: async (input) => {
      if (input.action_id === "list") {
        return { success: true, data: { provider: "builtin", items: [], total: 0 } };
      }
      if (input.action_id === "read") {
        return { success: true, data: { memory_id: "agent/agent_a/wiki/x", memory: null } };
      }
      if (input.action_id === "remember") {
        return { success: true, data: {
          memory_id: "agent/agent_a/wiki/x", target: "agent", mode: "knowledge",
          status: "created", version: "1:1", activation: "on_recall", location: "wiki",
        } };
      }
      if (["revise", "job_status", "retry"].includes(input.action_id)) {
        return { success: true, data: job_view };
      }
      if (input.action_id === "jobs") {
        return { success: true, data: { items: [job_view], total: 1 } };
      }
      return { success: true, data: { memory_id: "agent/agent_a/wiki/x", forgotten: true } };
    },
  });
  const scope = { scope: "agent", agent_id: "agent-a", workspace_id: "workspace-a" };

  const scopes = await actions.get("memory.scopes").run(undefined);
  assert.deepEqual(scopes.agents.map((agent) => agent.agent_id), ["agent-a", "agent-b"]);
  const snapshot = await actions.get("memory.config.snapshot").run(undefined);
  assert.equal(snapshot.knowledge.status.provider, "builtin");
  assert.equal(snapshot.knowledge.status.capabilities.list, true);
  assert.deepEqual(invocations, []);

  await actions.get("memory.list").run({ ...scope, limit: 10 });
  await actions.get("memory.read").run({ ...scope, memory_id: "agent/agent_a/wiki/x" });
  await actions.get("memory.remember").run({ ...scope, content: "x", target: "agent" });
  const revision = await actions.get("memory.revise").run({ ...scope, memory_id: "agent/agent_a/wiki/x", instruction: "y" });
  assert.match(revision.message, /queued/);
  assert.match(revision.message, new RegExp(job_view.job_id));
  assert.doesNotMatch(revision.message, /记忆已修订/);
  assert.deepEqual(await actions.get("memory.jobs").run({ ...scope, limit: 10, offset: 0 }), {
    items: [job_view], total: 1,
  });
  assert.deepEqual(await actions.get("memory.job_status").run({ ...scope, job_id: job_view.job_id }), job_view);
  assert.deepEqual(await actions.get("memory.retry").run({ ...scope, job_id: job_view.job_id }), job_view);
  await actions.get("memory.forget").run({ ...scope, memory_id: "agent/agent_a/wiki/x" });

  // 每个领域调用都必须带上界面选定的 Agent 与 Workspace。
  const domain_calls = invocations.filter((item) => item.agent_id === "agent-a");
  assert.ok(domain_calls.length >= 7, "界面 action 没有把执行范围交给领域 action");
  for (const call of domain_calls) {
    assert.equal(call.power_id, "memory");
    assert.equal(call.workspace_id, "workspace-a");
  }
  const remember_call = invocations.find((item) => item.action_id === "remember");
  assert.deepEqual(remember_call.input, { content: "x", target: "agent" });
  assert.deepEqual(invocations.find((item) => item.action_id === "jobs").input, { limit: 10, offset: 0 });
  for (const action_id of ["job_status", "retry"]) {
    assert.deepEqual(invocations.find((item) => item.action_id === action_id).input, { job_id: job_view.job_id });
  }
});

test("共享范围借用真实 Agent 执行，agent_id 为空也能读取", async (context) => {
  const { actions, invocations } = await start_memory_power(context, {
    on_invoke: async () => ({ success: true, data: { provider: "builtin", items: [], total: 0 } }),
  });

  const scopes = await actions.get("memory.scopes").run(undefined);
  assert.equal(scopes.agents[0].agent_id, "agent-a");
  assert.deepEqual(invocations, []);

  // 共享内容入口不指定 Agent 时，使用目录中的第一个真实 Agent 执行领域 action。
  await actions.get("memory.list").run({ scope: "city", agent_id: "", workspace_id: "workspace-a" });
  const shared_list_call = invocations.filter((item) => item.action_id === "list").at(-1);
  assert.deepEqual(shared_list_call.input.subject_kinds, ["city"]);
  assert.equal(shared_list_call.agent_id, "agent-a");
});

test("Memory 领域失败还原为异常，而不是空结果", async (context) => {
  const { actions } = await start_memory_power(context, {
    on_invoke: async () => ({ success: false, error: "Memory is outside the current access context" }),
  });
  await assert.rejects(
    () => actions.get("memory.read").run({
      agent_id: "agent-a",
      workspace_id: "workspace-a",
      memory_id: "agent/agent-b/wiki/secret",
    }),
    /outside the current access context/u,
  );
});

test("Memory 写入目标由界面传入，不被宿主 action 改写", async (context) => {
  const { actions, invocations } = await start_memory_power(context, {
    on_invoke: async (input) => input.action_id === "list"
      ? { success: true, data: { provider: "builtin", items: [], total: 0 } }
      : { success: true, data: {
        memory_id: "workspace/workspace-a/wiki/x", target: "current_workspace", mode: "knowledge",
        status: "created", version: "1:1", activation: "on_recall", location: "wiki",
      } },
  });
  await actions.get("memory.remember").run({
    scope: "city",
    agent_id: "agent-a",
    workspace_id: "workspace-a",
    content: "prefers concise answers",
    target: "current_workspace",
    memory_type: "preference",
  });
  const remember_call = invocations.find((item) => item.action_id === "remember");
  assert.equal(remember_call.input.target, "current_workspace");
  assert.equal(remember_call.input.memory_type, "preference");
});

test("Web 快照只返回脱敏配置，且浏览器会话来自领域 action", async () => {
  const { actions, invocations } = await start_web_power({
    config: {
      search_provider: "tavily",
      tavily_api_key: "secret-key",
      document_provider: "fetch",
      browser_provider: "local",
    },
    on_invoke: async (input) => input.action_id === "status"
      ? {
        success: true,
        data: {
          provider: "web",
          search_provider: "tavily",
          document_provider: "fetch",
          browser_provider: "local",
          available: true,
          reasons: [],
        },
      }
      : {
        success: true,
        data: {
          provider: "playwright-cdp",
          sessions: [{
            session_id: "s1",
            url: "https://example.com",
            title: "Example",
            observation_generation: 2,
          }],
        },
      },
  });
  // 配置是全局的：快照不再接收执行范围，内部自动选用第一个 Agent 与 Workspace。
  const snapshot = await actions.get("web.snapshot").run(undefined);
  assert.equal(snapshot.search.available, true);
  assert.equal(snapshot.search.provider, "tavily");
  assert.equal(snapshot.document.available, true);
  assert.equal(snapshot.browser.available, true);
  assert.equal(snapshot.config.tavily_api_key_configured, true);
  // 配置文件的真实路径由宿主告知，界面只展示与打开。
  assert.equal(snapshot.config_path, "/tmp/downcity/powers/web/config.toml");
  // 状态协议里绝不能出现密钥明文。
  assert.equal(JSON.stringify(snapshot).includes("secret-key"), false);

  const sessions = await actions.get("web.sessions").run(undefined);
  assert.equal(sessions.available, true);
  assert.deepEqual(sessions.sessions, [{
    session_id: "s1",
    url: "https://example.com",
    title: "Example",
    observation_generation: 2,
  }]);
  // 解析用的是宿主登记的第一个范围，而不是界面传入的值。
  for (const call of invocations) {
    assert.equal(call.agent_id, "agent-a");
    assert.equal(call.workspace_id, "workspace-a");
  }
  assert.deepEqual(invocations.map((item) => item.action_id), ["status", "status", "browser_list_sessions"]);
});

test("Web 浏览器关闭时明确报告不可用，而不是返回空列表", async () => {
  const { actions, invocations } = await start_web_power({
    config: { browser_provider: "disabled" },
    on_invoke: async () => ({
      success: true,
      data: {
        provider: "web",
        search_provider: "",
        document_provider: "fetch",
        browser_provider: "",
        available: true,
        reasons: [],
      },
    }),
  });
  const sessions = await actions.get("web.sessions").run(undefined);
  assert.equal(sessions.available, false);
  assert.deepEqual(sessions.sessions, []);
  assert.match(sessions.note, /浏览器/u);
  // 浏览器不可用时不得再去调用浏览器领域 action。
  assert.equal(invocations.some((item) => item.action_id === "browser_list_sessions"), false);
});

test("Web 配置文件的打开动作把路径交给宿主，没有路径时明确失败", async () => {
  const revealed = [];
  const { actions } = await start_web_power({
    config_path: "/tmp/downcity/powers/web/config.toml",
    on_show_item_in_folder: (input) => revealed.push(input.path),
  });

  const opened = await actions.get("web.config.reveal_file").run(undefined);
  assert.equal(opened.success, true);
  assert.deepEqual(revealed, ["/tmp/downcity/powers/web/config.toml"]);

  // 没有文件存储时不能编一个路径出来。
  const without_file = await start_web_power({ config_path: "" });
  const failed = await without_file.actions.get("web.config.reveal_file").run(undefined);
  assert.equal(failed.success, false);
  assert.match(failed.message, /文件/u);
});

test("Web 控制台跳转只接受已知凭据项，地址由服务端映射决定", async () => {
  const opened = [];
  const { actions } = await start_web_power({
    on_open_external: (input) => opened.push(input.url),
  });

  const result = await actions.get("web.config.open_console").run({ target: "tavily_api_key" });
  assert.equal(result.success, true);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\//u);

  // 渲染层不能借这个动作打开任意地址：只认枚举里的凭据项。
  await assert.rejects(
    () => actions.get("web.config.open_console").run({ target: "https://evil.example.com" }),
    /Unknown credential target/u,
  );
  assert.equal(opened.length, 1);
});

/** Ownership filters do not require a live executor for historical user records. */
test("User records stay separate from Agent records after an executor is removed", async (context) => {
  const agents = [{ agent_id: "agent-a", name: "Agent A" }];
  const { actions, storage_root } = await start_memory_power(context, { agents, workspaces: [] });
  const user_job = write_memory_job(storage_root, "a", { target: "user" });
  const agent_job = write_memory_job(storage_root, "b");
  assert.deepEqual((await actions.get("memory.records.list").run({ target: "user" })).items.map((item) => item.job_id), [user_job.job_id]);
  assert.deepEqual((await actions.get("memory.records.list").run({ target: "agent", agent_id: "agent-a" })).items.map((item) => item.job_id), [agent_job.job_id]);
  agents.length = 0;
  assert.deepEqual((await actions.get("memory.records.list").run({ target: "user" })).items.map((item) => item.job_id), [user_job.job_id]);
  assert.equal((await actions.get("memory.records.detail").run({ job_id: user_job.job_id })).job.target, "user");
  await assert.rejects(actions.get("memory.records.retry").run({ job_id: user_job.job_id }), /management scope/);
});

/** User Profile management is independent of Agent creation and uses versioned replay. */
test("User Profile append is available without Agents and preserves idempotency", async (context) => {
  const { actions } = await start_memory_power(context, { agents: [], workspaces: [] });
  const read = () => actions.get("memory.profile_read").run({ target: "user" });
  const before = await read();
  const input = { target: "user", content: "Use concise answers.", version: before.version, request_id: randomUUID() };
  const receipt = await actions.get("memory.profile_append").run(input);
  assert.deepEqual(await actions.get("memory.profile_append").run(input), receipt);
  assert.equal((await read()).content.match(/Use concise answers/g).length, 1);
  await assert.rejects(actions.get("memory.profile_append").run({ ...input, content: "Changed request" }), /reused/);
  await assert.rejects(actions.get("memory.profile_append").run({ ...input, request_id: randomUUID() }), /version changed/);
});

/** Zero-Agent user operations must remain scoped, versioned and idempotent. */
test("User knowledge is manageable without Agents and rejects foreign owners", async (context) => {
  const { actions, power, invocations } = await start_memory_power(context, { agents: [], workspaces: [] });
  const list = (query = "", extra = {}) => actions.get("memory.user_knowledge.list").run({ query, ...extra });
  assert.deepEqual(await list(), { items: [], total: 0 });
  const input = { content: "User background alpha", request_id: randomUUID() };
  const created = await actions.get("memory.user_knowledge.create").run(input);
  assert.deepEqual(await actions.get("memory.user_knowledge.create").run(input), created);
  assert.equal((await list()).total, 1);
  await assert.rejects(actions.get("memory.user_knowledge.create").run({ ...input, content: "changed payload" }), /reused/);
  const memory_id = created.changes[0].memory_id;
  const read = () => actions.get("memory.user_knowledge.read").run({ memory_id });
  const before = (await read()).memory;
  assert.equal(before.owner.kind, "user");
  assert.equal(before.subject.kind, "user");
  const update = { memory_id, version: before.version, content: "User background beta", request_id: randomUUID() };
  const updated = await actions.get("memory.user_knowledge.update").run(update);
  assert.deepEqual(await actions.get("memory.user_knowledge.update").run(update), updated);
  await assert.rejects(actions.get("memory.user_knowledge.update").run({ ...update, request_id: randomUUID() }), /version changed/);
  assert.equal((await list("alpha")).total, 0);
  assert.equal((await list("beta")).total, 1);
  const foreign = await power.provider.transactions.commit({ access: { agent_id: "foreign_agent", city_memory_available: true }, target: "agent",
    commit_id: "seed-foreign", changes: [{ operation: "create", content: "Foreign Agent secret", source_refs: [{ source_id: "original", source_type: "manual" }] }] });
  const foreign_id = foreign.changes[0].memory_id;
  await assert.rejects(actions.get("memory.user_knowledge.read").run({ memory_id: foreign_id }), /outside/);
  await assert.rejects(actions.get("memory.user_knowledge.update").run({ ...update, memory_id: foreign_id, request_id: randomUUID() }), /outside/);
  assert.equal((await list("secret")).total, 0);
  const current = (await read()).memory;
  const deletion = { memory_id, version: current.version, request_id: randomUUID() };
  const deleted = await actions.get("memory.user_knowledge.forget").run(deletion);
  assert.deepEqual(await actions.get("memory.user_knowledge.forget").run(deletion), deleted);
  assert.equal((await read()).memory, null);
  assert.equal((await list()).total, 0);
  assert.equal(invocations.length, 0);
});
