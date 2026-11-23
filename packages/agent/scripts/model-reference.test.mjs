/** 模型恢复边界：同名模型不构成同一来源，后台执行配置必须尊重显式来源。 */
import assert from "node:assert/strict";
import test from "node:test";
import { DeferredModelClient } from "../bin/index.js";
import { SessionExecutionProfiles } from "../bin/agent/SessionExecutionProfiles.js";

const reference = { downtown: "first", id: "shared" };
const model = { id: "shared", model_reference: reference, binding_id: "account", stream: async () => new ReadableStream() };

test("惰性模型拒绝宿主返回的同名不同来源客户端", async () => {
  const deferred = new DeferredModelClient(model.id, async () => ({ ...model, model_reference: { downtown: "second", id: model.id } }), "account", reference);
  await assert.rejects(deferred.resolve(), /different Session model/);
});

test("来源经过 JSON 恢复仍能解析，账号不匹配时拒绝", async () => {
  const restored = JSON.parse(JSON.stringify(reference));
  const deferred = new DeferredModelClient(model.id, async () => model, "account", restored);
  assert.equal(await deferred.resolve(), model);
  const invalid = new DeferredModelClient(model.id, async () => ({ ...model, binding_id: "another-account" }), "account", restored);
  await assert.rejects(invalid.resolve(), { code: "session_model_binding_changed" });
});

test("后台执行配置首次创建与恢复均固定结构化模型来源", async () => {
  const profiles = new SessionExecutionProfiles();
  let selected = model;
  profiles.register({ id: "test", version: 1, resolve: async () => ({ instruction: [], composer: {}, tools: {}, hooks: {}, model: selected }) });
  const selection = { execution_profile_id: "test", execution_profile_version: 1, model_reference: reference, binding_id: "account" };
  const context = { agent_id: "agent", session_id: "session", type: "work", kind: "test" };
  const first = await profiles.resolve(selection, context);
  assert.deepEqual(first.reference.model_reference, reference);
  selected = { ...model, model_reference: { downtown: "second", id: model.id } };
  await assert.rejects(profiles.resolve(selection, context), /selected model source/);
  await assert.rejects(profiles.resolve(selection, context, JSON.parse(JSON.stringify(first.reference))), /persisted model/);
});
