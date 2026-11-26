/** 合成私有目录验证统一 Memory 的事务、来源、抑制和迁移边界；绝不打开真实平台数据。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { BuiltinMemoryProvider, FileMemoryStorageAdapter, MemoryStorageRouter, preview_memory_migration, memory_migration_preview_hash, publish_memory_migration } from "@downcity/powers/memory";
import { MemoryRecords } from "../bin/memory/application/MemoryRecords.js";
import { bind_memory_sources, management_memory_sources, capture_memory_source } from "../bin/memory/application/MemorySourceBinding.js";
import { resolve_writable_memory_address } from "../bin/memory/runtime/MemoryAddress.js";
import { read_memory_manifest, read_memory_version } from "../bin/memory/storage/MemoryRecordStore.js";
import { memory_remember_schema, memory_read_schema, memory_update_schema, memory_forget_schema, memory_revise_schema } from "../bin/memory/runtime/MemorySchema.js";
import { create_file_memory_legacy_probe, prepare_memory_scope } from "../bin/memory/storage/MemoryScopeLifecycle.js";

const access = { agent_id: "synthetic_agent", workspace_id: "synthetic_project", city_memory_available: true };
const request_sources = (text = "request") => [capture_memory_source({ source_type: "request", role: "request" }, text)];
const user_sources = (text = "以后保留完整条件") => management_memory_sources(randomUUID(), { content: text });
async function fixture(context, scopes = ["agent"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-records-boundary-"));
  context.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const storage = new FileMemoryStorageAdapter({ root_path: root });
  const provider = new BuiltinMemoryProvider({ storage });
  await provider.initialize(); context.after(async () => await provider.dispose());
  for (const scope of scopes) {
    const address = resolve_writable_memory_address(access, scope);
    const preview = preview_memory_migration(address.scope, [], []);
    await publish_memory_migration({ storage, scope_prefix: address.prefix, preview, expected_preview_hash: memory_migration_preview_hash(preview),
      authorization: "explicit_management_migration", confirmed_empty: true, with_write_barrier: async (publish) => await publish() });
  }
  return { root, storage, provider, records: new MemoryRecords(provider) };
}
const create = async (provider, content, sources = request_sources(), kind = "knowledge", title = "独立标题") => (await provider.commit({
  access, scope: "agent", commit_id: randomUUID(), changes: [{ operation: "create", kind, content, ...(kind === "knowledge" ? { title } : {}), sources }],
})).changes[0].record;

async function empty_routed_fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-empty-scope-"));
  context.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const storage = new MemoryStorageRouter({
    shared_storage: new FileMemoryStorageAdapter({ root_path: path.join(root, "powers/memory") }),
    user_storage: new FileMemoryStorageAdapter({ root_path: path.join(root, "user/memory") }),
    create_agent_storage: (agent_id) => new FileMemoryStorageAdapter({ root_path: path.join(root, "agents", agent_id, "memory") }),
  });
  const legacy_scope_probe = create_file_memory_legacy_probe(root);
  const provider = new BuiltinMemoryProvider({ storage, legacy_scope_probe });
  await provider.initialize(); context.after(async () => await provider.dispose());
  return { root, storage, provider, legacy_scope_probe };
}

// 并发读写不能互相覆盖初始化或已提交的数据，重复读取不改变 manifest 字节。
test("concurrent first use prepares normal/internal/User/new-Agent scopes and preserves published records", async (context) => {
  const { storage, provider } = await empty_routed_fixture(context);
  for (const workspace_id of ["synthetic_project", "agent-main:synthetic_agent", "group-main:synthetic_group"]) {
    const scoped_access = { ...access, workspace_id };
    await Promise.all(Array.from({ length: 6 }, () => provider.assert_ready(scoped_access)));
    const address = resolve_writable_memory_address(scoped_access, "workspace");
    const text = await storage.read(`${address.prefix}/runtime/records/current.json`);
    assert.equal(JSON.parse(text).activation, "confirmed_empty");
    assert.equal(JSON.parse(text).scope_version, "0");
    await provider.list({ access: scoped_access });
    assert.equal(await storage.read(`${address.prefix}/runtime/records/current.json`), text);
  }
  const fresh_access = { ...access, agent_id: "fresh_agent" };
  await Promise.all(Array.from({ length: 10 }, (_, index) => index % 2
    ? provider.list({ access: fresh_access, scope: "agent" })
    : provider.commit({ access: fresh_access, scope: "agent", commit_id: `first-${index}`, changes: [{ operation: "create", kind: "knowledge", title: `Title ${index}`, content: `body ${index}`, sources: request_sources() }] })));
  const address = resolve_writable_memory_address(fresh_access, "agent");
  const text = await storage.read(`${address.prefix}/runtime/records/current.json`);
  assert.equal((await provider.list({ access: fresh_access, scope: "agent" })).total, 5);
  assert.equal(JSON.parse(text).scope_version, "5");
  await provider.assert_ready(fresh_access);
  assert.equal(await storage.read(`${address.prefix}/runtime/records/current.json`), text);
  await assert.rejects(provider.read({ access, memory_id: `${address.prefix}/wiki/foreign` }), /outside/);
  await assert.rejects(prepare_memory_scope(storage, { scope: { type: "workspace", id: "other" }, prefix: address.prefix }), /prefix mismatch/);
});

test("activated manifests retain exact bytes despite external legacy files and later use", async (context) => {
  const { root, storage, provider } = await empty_routed_fixture(context);
  await provider.read_version({ access, scope: "agent" });
  const address = resolve_writable_memory_address(access, "agent");
  const key = `${address.prefix}/runtime/records/current.json`;
  const manifest = JSON.parse(await storage.read(key));
  manifest.activation = "migrated"; manifest.scope_version = "17";
  const bytes = JSON.stringify(manifest, null, 2); await storage.write(key, bytes);
  await fs.writeFile(path.join(root, "agents/synthetic_agent/PROFILE.md"), "retained old profile");
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, "17");
  assert.equal((await provider.list({ access, scope: "agent" })).total, 0);
  assert.equal(await storage.read(key), bytes);
});

test("old Profile/ledger/knowledge/history/suppression/unfinished material never activates a scope", async (context) => {
  const { root, provider, storage } = await empty_routed_fixture(context);
  const cases = [
    ["agent", "agents/synthetic_agent/PROFILE.md"],
    ["agent", "agents/synthetic_agent/memory/profile-state.json"],
    ["agent", "agents/synthetic_agent/memory/profile-backup.md"],
    ["agent", "agents/synthetic_agent/memory/runtime/knowledge/current.json"],
    ["agent", "agents/synthetic_agent/memory/wiki/old.md"],
    ["agent", "agents/synthetic_agent/memory/runtime/records/versions/unpublished.json"],
    ["agent", "agents/synthetic_agent/memory/runtime/records/current.json.interrupted.tmp"],
    ["agent", "agents/synthetic_agent/memory/history/only.json"],
    ["agent", "agents/synthetic_agent/memory/suppressions/only.json"],
    ["agent", "agents/synthetic_agent/powers/memory/processing/history.json"],
    ["user", "user/PROFILE.md"],
    ["user", "user/memory/profile-state.json"],
    ["workspace", `powers/memory/workspaces/${Buffer.from(access.workspace_id).toString("hex")}/history/only.json`],
    ["workspace", "workspaces/synthetic_project/powers/memory/history/only.json"],
    ["workspace", "workspaces/synthetic_project/memory/wiki/only.md"],
  ];
  for (const [scope, relative] of cases) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, "synthetic material");
    await assert.rejects(provider.read_version({ access, scope }), /MEMORY_MIGRATION_REQUIRED/, relative);
    const address = resolve_writable_memory_address(access, scope);
    assert.equal(await storage.has(`${address.prefix}/runtime/records/current.json`), false, relative);
    await fs.unlink(target);
  }
  // User 仍有旧材料时，新 Agent 可单独激活，但完整 Session 必需的 User 继续阻断。
  await fs.writeFile(path.join(root, "user/PROFILE.md"), "old user rule");
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, "0");
  await assert.rejects(provider.assert_ready(access), /MEMORY_MIGRATION_REQUIRED: user\/local/);
});

test("damaged manifests, symlinks and metadata failures are never treated as empty", async (context) => {
  const { root, provider, storage } = await empty_routed_fixture(context);
  const address = resolve_writable_memory_address(access, "agent");
  const key = `${address.prefix}/runtime/records/current.json`;
  await storage.write(key, "invalid json");
  await assert.rejects(provider.read_version({ access, scope: "agent" }), SyntaxError);
  assert.equal(await storage.read(key), "invalid json"); await storage.delete(key);
  const owner = path.join(root, "agents/synthetic_agent");
  await fs.symlink(path.join(root, "missing-profile"), path.join(owner, "PROFILE.md"));
  await assert.rejects(provider.read_version({ access, scope: "agent" }), /symbolic link/);
  await fs.unlink(path.join(owner, "PROFILE.md"));
  await fs.symlink(path.join(root, "missing-old-file"), path.join(owner, "memory/link.tmp"));
  await assert.rejects(provider.read_version({ access, scope: "agent" }), /symbolic link/);
  await fs.unlink(path.join(owner, "memory/link.tmp"));
  const original_probe = storage.has_entries.bind(storage);
  storage.has_entries = async () => { throw Object.assign(new Error("synthetic access denied"), { code: "EACCES" }); };
  await assert.rejects(provider.read_version({ access, scope: "agent" }), { code: "EACCES" });
  storage.has_entries = original_probe;
  assert.equal(await storage.has(key), false);
  const file = path.join(root, "not-directory"); await fs.writeFile(file, "x");
  await fs.symlink(path.join(root, "user/memory"), path.join(root, "linked-root"));
  await assert.rejects(new FileMemoryStorageAdapter({ root_path: path.join(root, "linked-root") }).initialize(), /symbolic link/);
  await assert.rejects(new FileMemoryStorageAdapter({ root_path: file }).initialize(), /directory/);
});

test("scope preparation rechecks material and already-published markers inside the lock", async (context) => {
  const { storage, provider } = await empty_routed_fixture(context);
  const address = resolve_writable_memory_address(access, "workspace");
  const key = `${address.prefix}/runtime/records/current.json`;
  const original_lock = storage.with_scope_lock.bind(storage);
  let introduced = false;
  storage.with_scope_lock = async (scope_key, run) => original_lock(scope_key, async () => {
    if (!introduced) { introduced = true; await storage.write(`${address.prefix}/history/racing.json`, "legacy"); }
    return await run();
  });
  await assert.rejects(provider.read_version({ access, scope: "workspace" }), /MEMORY_MIGRATION_REQUIRED/);
  assert.equal(await storage.has(key), false);
  await storage.delete(`${address.prefix}/history/racing.json`);
  const migrated = { schema_version: 2, activation: "migrated", scope: address.scope, scope_prefix: address.prefix, scope_version: "23", records: {}, history: {}, receipts: {}, suppressions: [] };
  storage.with_scope_lock = async (scope_key, run) => original_lock(scope_key, async () => { await storage.write(key, JSON.stringify(migrated)); return await run(); });
  assert.equal((await provider.read_version({ access, scope: "workspace" })).scope_version, "23");
  assert.equal(await storage.read(key), JSON.stringify(migrated));
});

test("strict schema rejects old fields, forged sources, unsupported scope and Unicode overflow", () => {
  assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "agreement", title: "forbidden", content: "rule" }));
  assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "knowledge", content: "missing title" }));
  assert.throws(() => memory_remember_schema.parse({ scope: "workspace", kind: "agreement", content: "rule" }));
  for (const key of ["mode", "target", "topic", "memory_type", "owner", "subject", "metadata", "confidence"]) {
    assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "knowledge", title: "a", content: "b", [key]: "old" }));
  }
  assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "agreement", content: "a", source_refs: [{ message_id: "m", role: "user" }] }));
  assert.doesNotThrow(() => memory_remember_schema.parse({ scope: "agent", kind: "knowledge", title: "😀".repeat(160), content: "a" }));
  assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "knowledge", title: "😀".repeat(161), content: "a" }));
});

test("Agreement tombstones remain readable for audit and never poison subsequent scope transactions", async (context) => {
  const { provider, storage } = await fixture(context);
  await assert.rejects(create(provider, "以后保留条件", request_sources(), "agreement"), /AGREEMENT_SOURCE_REQUIRED/);
  const agreement = await create(provider, "以后保留条件", user_sources(), "agreement");
  const receipt = await provider.commit({ access, scope: "agent", commit_id: "delete-rule", changes: [{ operation: "delete", memory_id: agreement.memory_id, expected_version: agreement.version, sources: request_sources("delete") }] });
  assert.equal(receipt.changes[0].record.state, "deleted"); assert.equal("content" in receipt.changes[0].record, false);
  assert.equal((await provider.read({ access, memory_id: agreement.memory_id })).memory, null);
  await create(provider, "unrelated new knowledge");
  const manifest = await read_memory_manifest(storage, resolve_writable_memory_address(access, "agent"));
  assert.equal((await read_memory_version(storage, manifest, agreement.memory_id)).state, "deleted");
  assert.equal(manifest.history[agreement.memory_id].length, 1);
  await assert.rejects(create(provider, "以后保留条件", user_sources(), "agreement"), /SUPPRESSED/);
});

test("same-body provenance updates stay writable; stale versions and duplicate batch identities do not publish", async (context) => {
  const { provider } = await fixture(context);
  let current = await create(provider, "same body");
  for (let index = 0; index < 3; index++) {
    const receipt = await provider.commit({ access, scope: "agent", commit_id: `provenance-${index}`, changes: [{ operation: "update", memory_id: current.memory_id,
      expected_version: current.version, content: current.content, title: current.title, sources: request_sources(`evidence-${index}`) }] });
    current = receipt.changes[0].record;
  }
  const before = await provider.read_version({ access, scope: "agent" });
  await assert.rejects(provider.commit({ access, scope: "agent", commit_id: "atomic-failure", changes: [
    { operation: "create", kind: "knowledge", title: "never published", content: "not visible", sources: request_sources() },
    { operation: "update", memory_id: current.memory_id, expected_version: "stale", title: current.title, content: "wrong", sources: request_sources() },
  ] }), /changed/);
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, before.scope_version);
  const same = { operation: "update", memory_id: current.memory_id, expected_version: current.version, title: current.title, content: current.content, sources: current.sources };
  await assert.rejects(provider.commit({ access, scope: "agent", commit_id: "duplicate-unchanged", changes: [same, same] }), /Duplicate/);
});

test("application replay works after update/delete and across tool-call identities, rejects reused business key", async (context) => {
  const { records } = await fixture(context);
  const first_context = { agent: { id: access.agent_id }, call: { tool_call_id: "call-a" } };
  const second_context = { agent: { id: access.agent_id }, call: { tool_call_id: "call-b" } };
  const payload = { scope: "agent", kind: "knowledge", title: "Title", content: "body", request_id: "same-request" };
  const first = await records.remember(first_context, access, payload);
  assert.deepEqual(await records.remember(second_context, access, payload), first);
  await assert.rejects(records.remember(second_context, access, { ...payload, content: "different" }), /IDEMPOTENCY_CONFLICT/);
  const update = { memory_id: first.record.memory_id, expected_version: first.record.version, title: "Changed title", content: "changed body", request_id: "update-request" };
  const updated = await records.update(first_context, access, update);
  assert.deepEqual(await records.update(second_context, access, update), updated);
  const removal = { memory_id: first.record.memory_id, expected_version: updated.record.version, request_id: "delete-request" };
  const deleted = await records.forget(first_context, access, removal);
  assert.deepEqual(await records.forget(second_context, access, removal), deleted);
});

test("canonical Part evidence distinguishes runtime actors, exact excerpts and bounded pages", async () => {
  const message = { message_id: "m", session_id: "s", turn_id: "t", role: "user", meta: { from: { kind: "user", user_id: "local" } }, parts: [{ part_id: "p", type: "text", text: "以后保留完整条件。" }] };
  const context = { agent: { id: access.agent_id }, session: { id: "s", type: "chat" }, turn: { id: "t" }, call: { tool_call_id: "c" } };
  let reads = 0;
  const host = { system: { read_agent_session_message: async () => null, read_agent_session_messages: async (input) => { reads++; assert.equal(input.limit, 100); assert.equal(input.max_bytes, 256000); return { messages: [message] }; } } };
  const bound = await bind_memory_sources(context, { content: "rule" }, [], true, host);
  assert.equal(bound[0].role, "request"); assert.equal(bound[1].role, "user"); assert.equal(reads, 1);
  message.meta.from = { kind: "runtime", namespace: "task", object_id: "x" };
  assert.equal((await bind_memory_sources(context, {}, [], true, host)).length, 1);
  const selected = await bind_memory_sources(context, {}, [{ message_id: "m", part_id: "p", excerpt: "保留完整条件" }], false, host);
  assert.equal(selected[1].role, "request"); assert.equal(selected[1].locator.start_offset, 2);
  await assert.rejects(bind_memory_sources(context, {}, [{ message_id: "m", excerpt: "invented" }], false, host), /MISMATCH/);
  await assert.rejects(bind_memory_sources(context, {}, [{ message_id: "foreign" }], false, host), /UNAVAILABLE/);
});

test("title-only retrieval keeps body line offsets and private scope isolation", async (context) => {
  const { provider } = await fixture(context, ["agent", "workspace", "user"]);
  const memory = await create(provider, "first line\nsecond line", request_sources(), "knowledge", "UnicornToken");
  const result = await provider.recall({ access, query: "UnicornToken", scope: "agent" });
  assert.equal(result.items[0].matched_field, "title"); assert.equal(result.items[0].start_line, 1);
  assert.equal(result.items[0].memory.memory_id, memory.memory_id);
  assert.equal((await provider.read({ access, memory_id: memory.memory_id, from_line: 2, line_count: 1 })).memory.content, "second line");
  await assert.rejects(provider.read({ access: { ...access, agent_id: "other_agent" }, memory_id: memory.memory_id }), /outside/);
  await assert.rejects(provider.read({ access: { ...access, workspace_id: "other_project" }, memory_id: `workspace/${Buffer.from("foreign").toString("hex")}/wiki/id` }), /outside/);
});

test("migration preview blocks missing coverage, stale review, scheduled validity and overwrite", async (context) => {
  const { storage } = await fixture(context);
  const scope = { type: "agent", id: access.agent_id };
  const material = { legacy_id: "profile", original_text: "条件和否定都保留", format: "profile_block", state: "active", scope, audit: {} };
  assert.match(preview_memory_migration(scope, [material], []).blockers.join(), /Uncovered/);
  const preview = preview_memory_migration(scope, [material], [{ legacy_ids: ["profile"], content: { kind: "agreement", content: material.original_text }, state: "active", reviewed: true, review_note: "人工逐条核对保留" }], { complete: true, history_snapshots: [], suppressions: [] });
  assert.equal(preview.blockers.length, 0);
  const input = { storage, scope_prefix: `agent/${access.agent_id}`, preview, expected_preview_hash: memory_migration_preview_hash(preview), authorization: "explicit_management_migration", with_write_barrier: async (publish) => await publish() };
  await assert.rejects(publish_memory_migration(input), /already activated/);
  await assert.rejects(publish_memory_migration({ ...input, expected_preview_hash: "stale" }), /CHANGED/);
  assert.match(preview_memory_migration(scope, [{ ...material, scheduled_validity: true }], preview.candidates).blockers.join(), /Scheduled/);
});


test("failure before manifest publish leaves old snapshot, persistent receipt recovers post-publish interruption", async (context) => {
  const { provider, storage } = await fixture(context);
  const original = await create(provider, "old snapshot");
  const write = storage.write.bind(storage);
  storage.write = async (key, text) => { if (key.endsWith("records/current.json")) throw new Error("synthetic pre-publish crash"); return await write(key, text); };
  const input = { access, scope: "agent", commit_id: "crash-recovery", changes: [{ operation: "update", memory_id: original.memory_id, expected_version: original.version, title: original.title, content: "new snapshot", sources: request_sources() }] };
  await assert.rejects(provider.commit(input), /pre-publish crash/);
  assert.equal((await provider.read({ access, memory_id: original.memory_id })).memory.content, "old snapshot");
  storage.write = write;
  const receipt = await provider.commit(input);
  assert.equal((await provider.read({ access, memory_id: original.memory_id })).memory.content, "new snapshot");
  assert.deepEqual(await provider.read_commit_receipt({ access, scope: "agent", commit_id: input.commit_id }), receipt);
  assert.deepEqual(await provider.commit(input), receipt);
});

test("managed recreation creates a new ID linked to an unchanged tombstone; ordinary calls cannot bypass suppression", async (context) => {
  const { provider, storage } = await fixture(context);
  const original = await create(provider, "remember after explicit management authorization");
  const deleted = (await provider.commit({ access, scope: "agent", commit_id: "remove-recreation", changes: [{ operation: "delete", memory_id: original.memory_id, expected_version: original.version, sources: request_sources() }] })).changes[0].record;
  const change = { operation: "create", kind: "knowledge", title: original.title, content: original.content, sources: user_sources() };
  await assert.rejects(provider.commit({ access, scope: "agent", commit_id: "fake-recreation", recreation: { memory_id: original.memory_id, expected_version: deleted.version }, changes: [change] }), /AUTHORIZATION/);
  const management = { authority: "local_user", user_id: "local", city_memory_available: false, managed_scope: { type: "agent", id: access.agent_id } };
  const saved = (await provider.commit({ access: management, scope: "agent", commit_id: "explicit-recreation", recreation: { memory_id: original.memory_id, expected_version: deleted.version }, changes: [change] })).changes[0].record;
  assert.notEqual(saved.memory_id, original.memory_id);
  assert.equal((await provider.read({ access, memory_id: original.memory_id })).memory, null);
  const manifest = await read_memory_manifest(storage, resolve_writable_memory_address(access, "agent"));
  assert.equal(manifest.recreations[0].tombstone_id, original.memory_id);
  await assert.rejects(provider.read_history({ access, memory_id: original.memory_id }), /authenticated/);
  assert.equal((await provider.read_history({ access: management, memory_id: original.memory_id })).length, 2);
});


test("two processes initialize one empty scope under the same lock and share a fixed idempotent receipt", async (context) => {
  const { root, provider } = await fixture(context, []);
  const module_url = new URL("../bin/memory.js", import.meta.url).href;
  const source_url = new URL("../bin/memory/application/MemorySourceBinding.js", import.meta.url).href;
  const worker = path.join(root, "synthetic-worker.mjs");
  await fs.writeFile(worker, `import { BuiltinMemoryProvider, FileMemoryStorageAdapter } from ${JSON.stringify(module_url)};
import { capture_memory_source } from ${JSON.stringify(source_url)};
const provider = new BuiltinMemoryProvider({ storage: new FileMemoryStorageAdapter({ root_path: process.argv[2] }) });
await provider.initialize();
const source = capture_memory_source({ source_type: "request", role: "request" }, "same input");
const receipt = await provider.commit({ access: { agent_id: "synthetic_agent", city_memory_available: true }, scope: "agent", commit_id: "multiprocess", changes: [{ operation: "create", kind: "knowledge", title: "One title", content: "One body", sources: [source] }] });
process.stdout.write(JSON.stringify(receipt)); await provider.dispose();`);
  const execute = promisify(execFile);
  const [first, second] = await Promise.all([execute(process.execPath, [worker, root]), execute(process.execPath, [worker, root])]);
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, "1");
});


test("File Adapter retains traversal and symlink boundaries", async (context) => {
  const { root, storage } = await fixture(context);
  await assert.rejects(storage.write("../outside.md", "blocked"), /Invalid Memory storage key/);
  await assert.rejects(storage.read("wiki/../../outside.md"), /Invalid Memory storage key/);
  if (process.platform !== "win32") {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-records-outside-"));
    context.after(async () => await fs.rm(outside, { recursive: true, force: true }));
    await fs.symlink(outside, path.join(root, "linked"), "dir");
    await assert.rejects(storage.write("linked/outside.md", "blocked"), /symbolic link/);
  }
});

test("reviewed nonempty migration retains unsupported sources as legacy snapshots and old suppression", async (context) => {
  const { provider, storage } = await fixture(context, []);
  const scope = { type: "agent", id: access.agent_id };
  const original = "legacy knowledge body";
  const material = { legacy_id: "legacy-record", original_text: original, format: "knowledge", state: "active", scope, audit: { observed_at: "2020-01-01" }, sources: [{ source_id: "unverifiable", source_type: "old", role: "unknown" }] };
  const suppressed = "previously forgotten original";
  const preservation = { complete: true, history_snapshots: [{ legacy_id: "old-history", text: "fixed original history" }], suppressions: [{ memory_id: "old-id", version: "old-version", content_hash: (await import("../bin/memory/storage/MemoryRecordStore.js")).memory_content_hash(suppressed), sources: [], reason: "delete" }] };
  const preview = preview_memory_migration(scope, [material], [{ legacy_ids: [material.legacy_id], content: { kind: "knowledge", title: "Reviewed title", content: original }, state: "active", reviewed: true, review_note: "Exact content and historical time reviewed" }], preservation);
  const receipt = await publish_memory_migration({ storage, scope_prefix: `agent/${access.agent_id}`, preview, expected_preview_hash: memory_migration_preview_hash(preview), authorization: "explicit_management_migration", with_write_barrier: async (publish) => await publish() });
  const record = (await provider.read({ access, memory_id: receipt.mappings[material.legacy_id][0].memory_id })).memory;
  assert.equal(record.content, original); assert.equal(record.sources[0].source_type, "legacy_snapshot");
  await assert.rejects(create(provider, suppressed), /SUPPRESSED/);
});


test("credential patterns reject automatic user capture and management source before persistence", async () => {
  const fake_credential = "api_key = synthetic_not_a_real_credential";
  const context = { agent: { id: access.agent_id }, session: { id: "synthetic-source-session", type: "chat" }, turn: { id: "synthetic-turn" }, call: { tool_call_id: "synthetic-call" } };
  const message = { message_id: "synthetic-message", session_id: context.session.id, turn_id: context.turn.id, role: "user", meta: { from: { kind: "user", user_id: "local" } },
    parts: [{ part_id: "synthetic-part", type: "text", text: `Keep complete conditions. Unrelated sample: ${fake_credential}` }] };
  const host = { system: { read_agent_session_messages: async () => ({ messages: [message] }) } };
  await assert.rejects(bind_memory_sources(context, { content: "Keep complete conditions" }, [], true, host), (error) => {
    assert.equal(error.message.includes(fake_credential), false);
    return error.message.includes("MEMORY_SENSITIVE_TEXT");
  });
  assert.throws(() => management_memory_sources("synthetic-operation", { password: "synthetic_value_only" }), /MEMORY_SENSITIVE_TEXT/);
  assert.throws(() => capture_memory_source({ source_type: "request", role: "request" }, fake_credential), /MEMORY_SENSITIVE_TEXT/);
});

test("Agreement body and direct bound-source writes reject explicit credentials without publishing a version", async (context) => {
  const { provider } = await fixture(context);
  const fake_credential = "password: synthetic_value_only";
  assert.throws(() => memory_remember_schema.parse({ scope: "agent", kind: "agreement", content: fake_credential }), /MEMORY_SENSITIVE_TEXT/);
  const before = await provider.read_version({ access, scope: "agent" });
  await assert.rejects(create(provider, fake_credential, user_sources(), "agreement"), /MEMORY_SENSITIVE_TEXT/);
  const forged_bound_source = { source_id: "synthetic-bound-source", source_type: "request", role: "request", captured_at: new Date().toISOString(), excerpt: fake_credential,
    content_hash: `sha256:${createHash("sha256").update(fake_credential).digest("hex")}` };
  await assert.rejects(create(provider, "safe body", [forged_bound_source]), /MEMORY_SENSITIVE_TEXT/);
  assert.equal((await provider.read_version({ access, scope: "agent" })).scope_version, before.scope_version);
});

// 规范 ID 同时约束模型动作、管理历史和直接事务；引用字符串不是记录身份。
test("record entry points reject ID aliases and out-of-scope transactions", async (context) => {
  const { provider } = await fixture(context);
  const current = await create(provider, "Canonical identity");
  const management = { authority: "local_user", user_id: "local", city_memory_available: false,
    managed_scope: { type: "agent", id: access.agent_id } };
  const aliases = [`memory://builtin/${current.memory_id}`, `/${current.memory_id}`, ` ${current.memory_id}`,
    `${current.memory_id} `, `memory:${current.memory_id}@${current.version}#L1-L1`,
    current.memory_id.replace("/wiki/", "/runtime/"), `${current.memory_id}/extra`, "agent/synthetic_agent"];
  for (const memory_id of aliases) {
    for (const [schema, input] of [
      [memory_read_schema, { memory_id }],
      [memory_update_schema, { memory_id, expected_version: current.version, title: "Title", content: "Body" }],
      [memory_forget_schema, { memory_id, expected_version: current.version }],
      [memory_revise_schema, { memory_id, expected_version: current.version, instruction: "Revise" }],
    ]) assert.equal(schema.safeParse(input).success, false);
    await assert.rejects(provider.read({ access, memory_id }), /canonical Memory ID/);
    await assert.rejects(provider.read_history({ access: management, memory_id }), /canonical Memory ID/);
    await assert.rejects(provider.commit({ access, scope: "agent", commit_id: randomUUID(), changes: [
      { operation: "delete", memory_id, expected_version: current.version, sources: request_sources() },
    ] }), /canonical Memory ID/);
    await assert.rejects(provider.commit({ access: management, scope: "agent", commit_id: randomUUID(),
      recreation: { memory_id, expected_version: current.version }, changes: [
        { operation: "create", kind: "knowledge", title: "Title", content: "Body", sources: user_sources() },
      ] }), /canonical Memory ID/);
  }
  await assert.rejects(provider.commit({ access, scope: "agent", commit_id: randomUUID(), changes: [
    { operation: "delete", memory_id: current.memory_id.replace("synthetic_agent", "foreign_agent"), expected_version: current.version, sources: request_sources() },
  ] }), /escapes scope/);
  assert.equal((await provider.read({ access, memory_id: current.memory_id })).memory.content, current.content);
});

test("router lists exact complete scope prefixes with stable Workspace physical mapping", async (context) => {
  const { storage, root } = await empty_routed_fixture(context);
  const workspace_prefix = resolve_writable_memory_address(access, "workspace").prefix;
  for (const prefix of ["agent/synthetic_agent", "user/6c6f63616c", workspace_prefix]) {
    await storage.write(`${prefix}/runtime/records/current.json`, "manifest");
    await storage.write(`${prefix}/runtime/records/versions/record.json`, "version");
    await storage.write(`${prefix}/unknown/material.txt`, "unknown");
    assert.deepEqual((await storage.list(prefix)).map(({ key }) => key), [
      `${prefix}/runtime/records/current.json`, `${prefix}/runtime/records/versions/record.json`, `${prefix}/unknown/material.txt`,
    ]);
    assert.deepEqual((await storage.list(`${prefix}/runtime/records/versions`)).map(({ key }) => key), [`${prefix}/runtime/records/versions/record.json`]);
    assert.equal(await storage.has_entries(prefix), true);
  }
  assert.equal(await fs.readFile(path.join(root, "powers/memory", workspace_prefix.replace(/^workspace\//u, "workspaces/"), "runtime/records/current.json"), "utf8"), "manifest");
  for (const key of ["city/wiki", "users/6c6f63616c/wiki", "workspaces/70726f6a/wiki", "/agent/synthetic_agent", " agent/synthetic_agent", "agent\\synthetic_agent"])
    await assert.rejects(storage.list(key), /Memory (scope|router)/);
});

test("Workspace readability honors the shared storage capability boundary", async (context) => {
  const { provider } = await empty_routed_fixture(context);
  const scoped_access = { ...access, city_memory_available: false };
  await provider.assert_ready(scoped_access);
  assert.equal((await provider.list({ access: scoped_access })).scope_counts.workspace, 0);
  await assert.rejects(provider.list({ access: scoped_access, scope: "workspace" }), /requires City Memory/);
});
