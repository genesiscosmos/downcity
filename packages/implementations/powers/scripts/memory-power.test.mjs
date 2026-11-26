/** Memory 统一入口集成：只用合成根目录、伪宿主及确定性事务，不运行真实模型或用户数据迁移。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryPower, BuiltinMemoryProvider, FileMemoryStorageAdapter, preview_memory_migration, memory_migration_preview_hash, publish_memory_migration } from "@downcity/powers/memory";
import { MemoryProfile } from "../bin/memory/runtime/MemoryAgreementProjection.js";
import { build_profile_updates, mark_profile_snapshot } from "../bin/memory/runtime/MemoryContext.js";
import { MemoryJobStore } from "../bin/memory/storage/MemoryJobStore.js";
import { create_memory_session_tools } from "../bin/memory/runtime/MemoryRecordTools.js";
import { management_memory_sources } from "../bin/memory/application/MemorySourceBinding.js";
import { MEMORY_SESSION_KIND } from "../bin/memory/types/MemorySession.js";
import { resolve_session_power_system_blocks } from "../../../agent/bin/session/input/SessionSystem.js";
import { StepInput } from "../../../agent/bin/session/input/StepInput.js";
import { fit_request } from "../../../agent/bin/session/runner/RequestBudget.js";

async function start(context, use_builtin_routing = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-memory-integration-"));
  context.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const storage = new FileMemoryStorageAdapter({ root_path: path.join(root, "data") });
  const provider = new BuiltinMemoryProvider({ storage });
  const actions = new Map();
  const host = { abort_signal: new AbortController().signal, data_root_path: root, storage: { path: path.join(root, "host"), files: {} },
    config: { get: () => ({}), set: async () => {}, path: "" },
    power: { action: (action) => actions.set(action.id, action), config_action() {} },
    logger: { log: async () => {}, debug() {}, warn() {}, error() {}, info() {} },
    system: { register_execution_profile: () => () => {}, list_agents: async () => [{ agent_id: "synthetic_agent", name: "Synthetic" }],
      list_workspaces: async () => [{ workspace_id: "project", name: "Project" }] } };
  const power = new MemoryPower({ ...(use_builtin_routing ? {} : { provider }), platform_root_path: root });
  await power.initialize(host); context.after(async () => await power.dispose());
  return { root, storage, provider: power.provider, power, actions };
}
async function activate(storage, type, id) {
  const scope = { type, id };
  const prefix = type === "agent" ? `agent/${id}` : `${type}/${Buffer.from(id).toString("hex")}`;
  const preview = preview_memory_migration(scope, [], []);
  await publish_memory_migration({ storage, scope_prefix: prefix, preview, expected_preview_hash: memory_migration_preview_hash(preview), authorization: "explicit_management_migration", confirmed_empty: true, with_write_barrier: async (publish) => await publish() });
}

test("host User and Agent both manage individual records with current version and authenticated source", async (context) => {
  const { storage, actions } = await start(context);
  await activate(storage, "user", "local"); await activate(storage, "agent", "synthetic_agent");
  for (const routing of [{ scope: "user" }, { scope: "agent", agent_id: "synthetic_agent" }]) {
    const saved = await actions.get("memory.remember").run({ routing, payload: { scope: routing.scope, kind: "agreement", content: `条件 ${routing.scope}`, request_id: `create-${routing.scope}` } });
    assert.equal(saved.status, "committed"); assert.equal(saved.record.kind, "agreement"); assert.equal("title" in saved.record, false);
    assert.equal(saved.record.sources[0].source_type, "management_input");
    const current = await actions.get("memory.read").run({ routing, payload: { memory_id: saved.record.memory_id } });
    const update = { memory_id: current.memory.memory_id, expected_version: current.memory.version, content: `更正 ${routing.scope}`, request_id: `update-${routing.scope}` };
    const receipt = await actions.get("memory.update").run({ routing, payload: update });
    assert.equal(receipt.status, "committed");
    assert.deepEqual(await actions.get("memory.update").run({ routing, payload: update }), receipt);
    await assert.rejects(actions.get("memory.update").run({ routing, payload: { ...update, request_id: "stale" } }), /version changed/);
    const list = await actions.get("memory.list").run({ routing, payload: { kind: "agreement" } });
    assert.equal(list.items.length, 1);
    await assert.rejects(actions.get("memory.list").run({ routing, payload: { topic: "legacy" } }));
  }
  await assert.rejects(actions.get("memory.list").run({ routing: { scope: "agent", agent_id: "foreign" }, payload: {} }), /unavailable/);
});

test("unmigrated material blocks system and turn hooks, and required errors survive Session fallback", async (context) => {
  const { power, storage } = await start(context);
  await storage.write("user/6c6f63616c/runtime/knowledge/current.json", "{}");
  const runtime = { agent: { id: "synthetic_agent" }, workspace: { id: "project" }, session: { kind: "chat" } };
  const system_hook = power.hooks.pipeline["session.system_context"][0];
  const turn_hook = power.hooks.pipeline["session.turn_context"][0];
  for (const hook of [system_hook, turn_hook]) {
    await assert.rejects(hook({ context: runtime, value: { blocks: [], system_blocks: [] } }), (error) => error.code === "SESSION_CONTEXT_REQUIRED" && String(error.cause).includes("MIGRATION_REQUIRED"));
  }
  await assert.rejects(resolve_session_power_system_blocks({ session_id: "synthetic", hooks: { guard: {}, effect: {}, pipeline: { "session.system_context": [(value, context) => system_hook({ value, context })] } }, context: runtime }), /Memory context unavailable/);
});

test("first-use empty scopes allow system and turn hooks including unregistered internal main", async (context) => {
  const { power, provider } = await start(context, true);
  for (const workspace_id of ["project", "agent-main:synthetic_agent", "group-main:synthetic_group"]) {
    const runtime = { agent: { id: "synthetic_agent" }, workspace: { id: workspace_id }, session: { kind: "chat" } };
    for (const hook of [power.hooks.pipeline["session.system_context"][0], power.hooks.pipeline["session.turn_context"][0]]) {
      await hook({ context: runtime, value: { blocks: [], system_blocks: [] } });
    }
    assert.equal((await provider.read_version({ access: { agent_id: "synthetic_agent", workspace_id, city_memory_available: true }, scope: "workspace" })).scope_version, "0");
  }
});

test("default builtin composition protects an external User Profile while a new Agent scope stays independent", async (context) => {
  const { root, power, provider } = await start(context, true);
  await fs.mkdir(path.join(root, "user"), { recursive: true });
  await fs.writeFile(path.join(root, "user/PROFILE.md"), "synthetic legacy rule");
  const access = { agent_id: "synthetic_agent", workspace_id: "agent-main:synthetic_agent", city_memory_available: true };
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, "0");
  const hook = power.hooks.pipeline["session.system_context"][0];
  await assert.rejects(hook({ context: { agent: { id: access.agent_id }, workspace: { id: access.workspace_id }, session: { kind: "chat" } }, value: { blocks: [], system_blocks: [] } }), /Memory context unavailable/);
  await assert.rejects(fs.stat(path.join(root, "user/memory/runtime/records/current.json")), { code: "ENOENT" });
});

test("full projection exceeds old truncation limits, deletion explicitly retires frozen ID/version", async (context) => {
  const { storage, provider } = await start(context);
  await activate(storage, "user", "local"); await activate(storage, "agent", "synthetic_agent");
  const access = { agent_id: "synthetic_agent", city_memory_available: true };
  const rules = Array.from({ length: 4 }, (_, index) => ({ operation: "create", kind: "agreement", content: `${index}: ${"完整条件".repeat(2000)}`, sources: management_memory_sources(`op-${index}`, { input: `rule-${index}` }) }));
  const receipt = await provider.commit({ access, scope: "agent", commit_id: "large-profile", changes: rules });
  const profile = new MemoryProfile(provider);
  const frozen = await profile.context_block({ scope: "agent", agent_id: access.agent_id });
  assert.ok(frozen.content.length > 32000); assert.ok(frozen.content.includes(rules[3].content));
  const removed = receipt.changes[0].record;
  await provider.commit({ access, scope: "agent", commit_id: "remove-rule", changes: [{ operation: "delete", memory_id: removed.memory_id, expected_version: removed.version, sources: management_memory_sources("delete-op", {}) }] });
  const updates = await build_profile_updates(profile, access.agent_id, [{ source: "power", name: "memory/core/agent", content: mark_profile_snapshot(frozen) }]);
  const update = updates.find((block) => block.name === "memory/update/agent");
  assert.ok(update.content.includes(removed.memory_id)); assert.ok(!update.checkpoint_block.content.includes(removed.content));
  assert.equal(update.checkpoint_block.position, "after_instruction");
});

test("preflight budget refuses impossible complete system instead of compacting away constraints", async () => {
  let advanced = 0;
  const step = { model: { id: "synthetic", context_window: 10000 }, system: [{ role: "system", content: "完整约束".repeat(10000) }], messages: [], tools: {}, context_window: 10000 };
  await assert.rejects(fit_request({ resolve: async () => step, advance: async () => { advanced++; return true; }, signal: new AbortController().signal, report: async () => {} }), /fixed system\/tools/);
  assert.equal(advanced, 0);
});

test("Job staging binds original sources, actual read version and declared kind; no Profile staging exists", async (context) => {
  const { root, storage, provider } = await start(context);
  await activate(storage, "agent", "synthetic_agent");
  const jobs = new MemoryJobStore(path.join(root, "synthetic-jobs")); await jobs.initialize(); context.after(async () => await jobs.dispose());
  const source = management_memory_sources("job-evidence", { content: "以后保留完整条件" })[0];
  const input = { request_key: "same", kind: "digest", access: { agent_id: "synthetic_agent", city_memory_available: true }, scope: "agent", memory_kind: "agreement",
    instruction: "retain", model: { downtown: "synthetic", id: "model" }, binding_id: "binding", sources: [{ source_id: source.source_id, agent_id: "synthetic_agent", category: "chat", role: "user", text: source.excerpt, bound_source: source }] };
  const job = await jobs.create(input);
  assert.equal((await jobs.create({ ...input, sources: [{ ...input.sources[0], bound_source: { ...source, captured_at: new Date().toISOString() } }] })).job_id, job.job_id);
  await jobs.update(job.job_id, { status: "running", session_id: "memory-synthetic" });
  const tools = create_memory_session_tools({ jobs, provider }, job.job_id);
  assert.equal(tools.memory_stage_profile, undefined);
  const runtime = { agent_id: "synthetic_agent", session_id: "memory-synthetic", session_type: "work", session_kind: MEMORY_SESSION_KIND };
  await assert.rejects(tools.memory_stage.execute({ changes: [] }, runtime));
  await tools.memory_sources.execute({}, runtime);
  const change = { operation: "create", kind: "agreement", content: "以后保留完整条件", source_ids: [source.source_id], source_excerpts: [{ source_id: source.source_id, excerpt: source.excerpt }] };
  await assert.rejects(tools.memory_stage.execute({ changes: [change] }, runtime), /prior search/);
  await assert.rejects(tools.memory_stage.execute({ changes: [{ ...change, operation: "update", memory_id: "foreign", expected_version: "fake", kind: undefined }] }, runtime));
  await tools.memory_query.execute({ query: "agreement" }, runtime);
  await assert.rejects(tools.memory_stage.execute({ changes: [{ ...change, source_excerpts: [{ source_id: source.source_id, excerpt: "fabricated quote" }] }] }, runtime), /exactly match/);
  const staged = await tools.memory_stage.execute({ changes: [change] }, runtime);
  assert.equal(staged.committed, false);
  const current = await jobs.read(job.job_id);
  const { memory_job_changes } = await import("../bin/memory/application/MemoryJobCommit.js");
  const receipt = await provider.commit({ access: input.access, scope: "agent", commit_id: `job:${job.job_id}`, changes: memory_job_changes(current) });
  assert.equal(receipt.changes[0].record.kind, "agreement");
  assert.equal(receipt.changes[0].record.sources[0].role, "user");
  await assert.rejects(tools.memory_stage.execute({ changes: [change] }, runtime), /one outcome/);

});


test("generic context checkpoint preserves frozen ordering and rejects cross-Power replacement", async () => {
  let written;
  const instance = { frozen_blocks: [
    { source: "instruction", name: "identity", content: "identity" },
    { source: "power", name: "example/core", content: "old constraints", position: "after_instruction" },
    { source: "session", name: "context", content: "session" },
  ], write_snapshot: async (blocks) => { written = blocks; } };
  await StepInput.prototype.refresh_context_snapshot.call(instance, [{ source_power: "example", name: "update", content: "new", trust_level: "reference",
    checkpoint_block: { source: "power", name: "example/core", content: "complete current constraints", position: "before_session" } }]);
  assert.deepEqual(written.map(block => block.name), ["identity", "example/core", "context"]);
  assert.equal(written[1].position, "after_instruction"); assert.equal(written[1].content, "complete current constraints");
  await assert.rejects(StepInput.prototype.refresh_context_snapshot.call(instance, [{ source_power: "foreign", checkpoint_block: { source: "power", name: "example/core", content: "forged" } }]), /ownership/);
});
