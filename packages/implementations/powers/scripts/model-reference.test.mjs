/** 后台模型回归：Job、Task TOML 与执行配置始终保存精确来源，禁止同名跨来源替换。 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Town, City, Workspace, LocalStorageProvider } from "@downcity/city";
import { Agent } from "@downcity/agent";
import { MockModelClient } from "../../../agent/scripts/ModelClientMock.mjs";
import { Power } from "@downcity/city/power";
import { authorize_task_session, task_execution_hooks, TASK_EXECUTION_PROFILE } from "../bin/task/runtime/TaskSessionAuthorization.js";
import { SESSION_HOOK_POINTS } from "@downcity/type";
import { MemoryJobStore } from "../bin/memory/storage/MemoryJobStore.js";
import { require_memory_model } from "../bin/memory/application/MemoryModelBinding.js";
import { register_memory_session_profile } from "../bin/memory/runtime/MemorySession.js";
import { buildTaskToml, parseTaskDefinition } from "../bin/task/runtime/Model.js";
import { validate_task_model } from "../bin/task/runtime/TaskModelBinding.js";

const reference = { downtown: "original", id: "shared-model" };

test("Memory Job 跨仓储重建保留提交时来源和绑定，幂等重送不能替换基线", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "memory-reference-"));
  const store = new MemoryJobStore(root);
  try {
    await store.initialize();
    const input = { kind: "manual", request_key: "request", instruction: "Remember", access: { agent_id: "agent" }, target: "agent", mode: "knowledge", sources: [{ source_id: "source", text: "Remember this decision" }], model: reference, binding_id: "saved-account" };
    const job = await store.create(input);
    const second_store = new MemoryJobStore(root);
    await second_store.initialize();
    const restored = await second_store.read(job.job_id);
    assert.deepEqual(require_memory_model(restored), { model: reference, binding_id: "saved-account" });
    const duplicate = await second_store.create({ ...input, model: { downtown: "other", id: reference.id }, binding_id: "other-account" });
    assert.deepEqual(duplicate.model, reference);
    assert.equal(duplicate.binding_id, "saved-account");
    await second_store.dispose();
    assert.throws(() => require_memory_model({ model: "shared-model", binding_id: "saved-account" }), { code: "memory_model_configuration_required" });
  } finally { await store.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("Memory profile 只约束执行 Agent 已捕获模型，跨来源和授权变更均拒绝", async () => {
  const town = new Town("memory-test");
  const model = { id: "shared-model", binding_id: "original-account", stream: async () => new ReadableStream({ start(controller) { controller.close(); } }) };
  const reference = town.models.register({ source_id: "original", client: model });
  let profile;
  const job_id = "a".repeat(64);
  const job = { execution_agent_id: "memory-agent", access: { agent_id: "business-agent" }, session_id: "session", model: reference, binding_id: "original-account" };
  const host = { town, system: { register_execution_profile(value) { profile = value; return () => {}; } } };
  const unregister = register_memory_session_profile(host, { jobs: { read: async () => job } });
  try {
    const context = { agent_id: "memory-agent", session_id: "session", creation_key: `memory:${job_id}:1` };
    const resources = await profile.resolve(context);
    assert.equal("model" in resources, false);
    const guard = resources.hooks.guard[SESSION_HOOK_POINTS.model_execution][0];
    const actual = { model_id: reference.id, model_reference: reference, binding_id: "original-account" };
    await guard(actual, context);
    await assert.rejects(guard({ ...actual, model_reference: { client: "other", id: reference.id } }, context), { code: "execution_model_authorization_changed" });
    await assert.rejects(guard({ ...actual, binding_id: "another-account" }, context), { code: "execution_model_authorization_changed" });
    await assert.rejects(profile.resolve({ ...context, agent_id: "business-agent" }), /execution Agent/);
  } finally { unregister(); await town.close(); }
});

test("Task TOML 保存模型对象并恢复原始 ID；同名不同来源不能通过绑定校验", async () => {
  const task = { taskId: "task", title: "Test", when: "@manual", kind: "agent", schedule: "enabled", agent_id: "agent", workspace_id: "workspace", body: "Do work", model: reference, binding_id: "saved-account", workflow: {} };
  const text = buildTaskToml(task);
  const parsed = parseTaskDefinition({ taskId: "task", data_path: "/tmp/tasks", task_file_path: "/tmp/tasks/task/task.toml", text });
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.task.model, reference);
  await validate_task_model(parsed.task, { read: async () => ({ model: { ...reference }, binding_id: "saved-account" }) });
  await assert.rejects(validate_task_model(parsed.task, { read: async () => ({ model: { downtown: "other", id: reference.id }, binding_id: "saved-account" }) }), { code: "task_model_binding_changed" });
  const root = await mkdtemp(path.join(os.tmpdir(), "task-turn-authorization-"));
  const workspace = new Workspace({ id: "workspace", path: root });
  const storage = new LocalStorageProvider(path.join(root, "data"));
  const city = new City({ storage, workspaces: [workspace] });
  let host;
  let unauthorized_calls = 0;
  class AuthorizationPower extends Power {
    name = "task";
    hooks = task_execution_hooks(() => host);
    async initialize(context) { host = context; context.system.register_execution_profile({ ...TASK_EXECUTION_PROFILE, resolve: () => ({}) }); }
  }
  try {
    const client = new MockModelClient({ id: "shared", generate: async () => ({ text: "authorized" }) });
    client.binding_id = "saved-account";
    const local_reference = city.town.models.register({ source_id: "original", client });
    const agent = city.agents.add(new Agent({ id: "agent", model: city.town.models.client(local_reference) }));
    await city.powers.add({ power: new AuthorizationPower(), readme: import.meta.filename, has_config: false, has_page: false });
    const session = await agent.sessions.create_execution_session({ workspace, workspace_id: workspace.id, type: "work", kind: "task", execution_profile_id: TASK_EXECUTION_PROFILE.id, execution_profile_version: TASK_EXECUTION_PROFILE.version });
    await authorize_task_session(host.storage, { ...task, model: local_reference }, session.id);
    assert.equal((await (await session.prompt({ query: "authorized Task" })).finished).success, true);
    const changed = new MockModelClient({ id: client.id, generate: async () => { unauthorized_calls++; return { text: "must not run" }; } });
    changed.model_reference = { client: "other", id: client.id };
    changed.binding_id = "saved-account";
    agent.reconfigure({ model: changed });
    await assert.rejects(session.prompt({ query: "reject changed Agent before title or model request" }), /differs from the confirmed/);
    assert.equal(unauthorized_calls, 0);
    await session.stop();
    await city.powers.remove("task");
    await assert.rejects(session.prompt({ query: "Power removed cannot bypass authorization" }), /execution_profile_unavailable/);
  } finally { await city.close(); await rm(root, { recursive: true, force: true }); }
});
