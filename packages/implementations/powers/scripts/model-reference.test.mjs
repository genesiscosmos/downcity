/** 后台模型回归：Job、Task TOML 与执行配置始终保存精确来源，禁止同名跨来源替换。 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Town } from "@downcity/city";
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

test("Memory 执行配置恢复直接客户端来源，忽略同名的当前默认模型", async () => {
  const town = new Town("memory-test");
  const model = { id: "shared-model", binding_id: "original-account", stream: async () => new ReadableStream({ start(controller) { controller.close(); } }) };
  const reference = town.models.register({ source_id: "original", client: model });
  let profile;
  const host = { town, system: { register_execution_profile(value) { profile = value; return () => {}; } } };
  const unregister = register_memory_session_profile(host, {});
  try {
    const context = { creation_key: `memory:${"a".repeat(64)}:1`, model_id: reference.id, model_reference: reference, binding_id: "original-account", default_model: { ...model, model_reference: { client: "other", id: reference.id } } };
    const resources = await profile.resolve(context);
    assert.deepEqual(resources.model.model_reference, reference);
    assert.equal(resources.model.binding_id, "original-account");
    await assert.rejects(profile.resolve({ ...context, binding_id: "another-account" }), { code: "town_model_identity_confirmation_required" });
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
});
