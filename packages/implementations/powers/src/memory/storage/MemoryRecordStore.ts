/** Canonical records Store：不可变版本先持久化，再原子发布 manifest、历史、抑制及固定回执。 */
import { createHash } from "node:crypto";
import type { MemoryStorageAdapter } from "../types/MemoryStorage.js";
import type { MemoryRecord, MemorySource, MemoryWriteResult } from "../types/MemoryRecord.js";
import type { MemoryScopeAddress } from "../runtime/MemoryAddress.js";
import type { MemoryChangeSet, MemoryCommitReceipt, MemoryRecordPointer, MemoryScopeManifest } from "../types/MemoryTransaction.js";
import { MemoryVersionConflictError, normalize_memory_content } from "../types/MemoryTransaction.js";
import { assert_memory_text_safe } from "../runtime/MemorySensitiveText.js";
import { memory_id_schema, validate_memory_content } from "../runtime/MemorySchema.js";

/** 固定键排序，数组顺序保留语义。 */
export function canonical_memory_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_memory_json).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical_memory_json(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
/** 内容指纹，只用于精确比较，不证明真实性。 */
export function memory_hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
/** 正文抑制的统一指纹。 */
export function memory_content_hash(content: string): string { return memory_hash(normalize_memory_content(content)); }
/** 一个 scope 的唯一发布地址。 */
export function memory_manifest_key(prefix: string): string { return `${prefix}/runtime/records/current.json`; }

/** 无标记的 scope 必须显式迁移或确认空，不能被当作空数据库。 */
export async function read_memory_manifest(storage: MemoryStorageAdapter, address: MemoryScopeAddress): Promise<MemoryScopeManifest> {
  const text = await storage.read(memory_manifest_key(address.prefix));
  if (text === null) throw new Error(`MEMORY_MIGRATION_REQUIRED: ${address.scope.type}/${address.scope.id}`);
  const manifest = JSON.parse(text) as MemoryScopeManifest;
  if (manifest.schema_version !== 2 || manifest.scope_prefix !== address.prefix
    || canonical_memory_json(manifest.scope) !== canonical_memory_json(address.scope)
    || !["migrated", "confirmed_empty"].includes(manifest.activation)
    || !/^\d+$/u.test(manifest.scope_version) || !manifest.records || !manifest.history
    || !manifest.receipts || !Array.isArray(manifest.suppressions)) throw new Error("Invalid records manifest");
  for (const [memory_id, pointer] of Object.entries(manifest.records)) {
    memory_id_schema.parse(memory_id);
    if (!memory_id.startsWith(`${address.prefix}/wiki/`) || !pointer.key.startsWith(`${address.prefix}/runtime/records/versions/`)
      || pointer.key.includes("..") || !pointer.version || !["active", "invalidated", "deleted"].includes(pointer.state)) {
      throw new Error("Record pointer escapes scope or has invalid state");
    }
  }
  return manifest;
}
/** 读取 manifest 指向的固定版本，拒绝损坏或越权身份。 */
export async function read_memory_version(storage: MemoryStorageAdapter, manifest: MemoryScopeManifest, memory_id: string, pointer = manifest.records[memory_id]): Promise<MemoryRecord | null> {
  memory_id_schema.parse(memory_id);
  if (!memory_id.startsWith(`${manifest.scope_prefix}/wiki/`)) throw new Error("Memory ID escapes scope");
  if (!pointer) return null;
  if (!pointer.key.startsWith(`${manifest.scope_prefix}/runtime/records/versions/`) || pointer.key.includes("..")) throw new Error("Invalid record version key");
  const text = await storage.read(pointer.key);
  if (!text || memory_hash(text) !== pointer.hash) throw new Error("Memory immutable version missing or corrupt");
  const record = JSON.parse(text) as MemoryRecord;
  if (record.memory_id !== memory_id || record.version !== pointer.version || record.state !== pointer.state
    || canonical_memory_json(record.scope) !== canonical_memory_json(manifest.scope)) throw new Error("Memory immutable identity mismatch");
  validate_memory_content(record.kind, record.content, record.title);
  validate_sources(record.sources, record.state === "active" && record.kind === "agreement");
  return record;
}
/** 只返回 active，墓碑及历史不进入召回。 */
export async function active_memory_records(storage: MemoryStorageAdapter, manifest: MemoryScopeManifest): Promise<MemoryRecord[]> {
  const records = await Promise.all(Object.entries(manifest.records).filter(([, pointer]) => pointer.state === "active")
    .map(([memory_id, pointer]) => read_memory_version(storage, manifest, memory_id, pointer)));
  return records.filter((record): record is MemoryRecord => record !== null);
}
/** request 绝不能充当 user，Agreement 必须有真实用户消息或管理输入。 */
export function validate_sources(sources: MemorySource[], agreement: boolean): void {
  if (!Array.isArray(sources) || !sources.length || sources.length > 100) throw new Error("Memory requires 1..100 bound sources");
  for (const source of sources) {
    if (source.excerpt !== undefined) assert_memory_text_safe(source.excerpt);
    if (!["request", "management_input", "session_message", "task_fact", "legacy_snapshot"].includes(source.source_type)
      || !["request", "user", "agent", "tool", "unknown"].includes(source.role)) throw new Error("Invalid source type or role");
    if (source.source_type === "task_fact" && (!source.locator || !("event_id" in source.locator) || !source.locator.event_id || !source.locator.task_id || !source.locator.item_id)) throw new Error("Invalid TaskFact locator");
    if (source.source_type === "legacy_snapshot" && (!source.locator || !("snapshot_id" in source.locator) || !source.locator.snapshot_id)) throw new Error("Invalid legacy snapshot locator");
    if (!source.source_id || !/^sha256:[a-f0-9]{64}$/u.test(source.content_hash) || !Number.isFinite(Date.parse(source.captured_at))) throw new Error("Invalid bound Memory source");
    if (source.source_type === "request" && source.role !== "request") throw new Error("Request provenance cannot claim user role");
    if (source.source_type === "management_input" && (source.role !== "user" || !source.locator || !("operation_id" in source.locator) || !source.locator.operation_id)) throw new Error("Management source requires authenticated operation");
    if (source.source_type === "session_message") {
      const locator = source.locator;
      if (!locator || !("message_id" in locator) || !locator.agent_id || !locator.session_id || !locator.session_type || !locator.part_id
        || !Number.isInteger(locator.start_offset) || !Number.isInteger(locator.end_offset) || locator.start_offset < 0 || locator.end_offset < locator.start_offset
        || typeof source.excerpt !== "string" || source.excerpt.length !== locator.end_offset - locator.start_offset) throw new Error("Invalid canonical Part source");
    }
    if (source.excerpt !== undefined && `sha256:${memory_hash(source.excerpt)}` !== source.content_hash) throw new Error("Source excerpt hash mismatch");
  }
  if (agreement && !sources.some((source) => source.role === "user" && ["session_message", "management_input"].includes(source.source_type))) {
    throw new Error("AGREEMENT_SOURCE_REQUIRED");
  }
}
/** 规范内容判重；标题不作为唯一键。 */
function same_content(left: MemoryRecord, right: Pick<MemoryRecord, "kind" | "content" | "title">): boolean {
  return left.kind === right.kind && normalize_memory_content(left.content) === normalize_memory_content(right.content)
    && (left.kind !== "knowledge" || left.title === right.title);
}
/** 捕获时间及随机来源身份不参与请求幂等，实际来源定位与内容必须保持一致。 */
function request_fingerprint(input: MemoryChangeSet, address: MemoryScopeAddress): string {
  return memory_hash(canonical_memory_json({ scope: address.scope,
    requested_by: "authority" in input.access ? `user:${input.access.user_id}` : `agent:${input.access.agent_id}`,
    request_id: input.request_id ?? input.commit_id, expected_scope_version: input.expected_scope_version,
    business_hash: input.business_hash, recreation: input.recreation,
    changes: input.changes.map((change) => ({ ...change, sources: change.sources.map(({ captured_at, source_id, ...source }) => source.source_type === "request" ? { ...source, locator: undefined } : source) })),
  }));
}

/** 同 scope 全部变更在锁内计算；任何前置失败均不发布 manifest。 */
export async function commit_memory_changes(storage: MemoryStorageAdapter, address: MemoryScopeAddress, input: MemoryChangeSet): Promise<MemoryCommitReceipt> {
  const request = structuredClone(input);
  if (!request.commit_id || request.commit_id.length > 512 || (request.request_id !== undefined && (!request.request_id || request.request_id.length > 512))) throw new Error("Invalid Memory idempotency key");
  if (!Array.isArray(request.changes) || !request.changes.length || request.changes.length > 500) throw new Error("Memory commit requires 1..500 changes");
  // 直接事务调用与公开入口采用相同 ID 语法和范围校验，先拒绝无效身份再读取回执。
  const target_ids = request.changes.flatMap((change) => change.operation === "create" ? [] : [change.memory_id]);
  if (request.recreation) target_ids.push(request.recreation.memory_id);
  for (const memory_id of target_ids) {
    memory_id_schema.parse(memory_id);
    if (!memory_id.startsWith(`${address.prefix}/wiki/`)) throw new Error("Memory ID escapes scope");
  }
  const request_hash = request_fingerprint(request, address);
  return await storage.with_scope_lock(memory_manifest_key(address.prefix), async () => {
    const manifest = await read_memory_manifest(storage, address);
    const receipt_key = memory_hash(request.commit_id);
    const replay = manifest.receipts[receipt_key] ?? Object.values(manifest.receipts).find((receipt) => receipt.request_id === (request.request_id ?? request.commit_id));
    if (replay) {
      if (replay.request_hash !== request_hash) throw new Error("IDEMPOTENCY_CONFLICT");
      return replay;
    }
    if (request.expected_scope_version !== undefined && request.expected_scope_version !== manifest.scope_version) throw new MemoryVersionConflictError("Memory scope changed", manifest.scope_version);
    const scope_version = String(BigInt(manifest.scope_version) + 1n);
    const committed_at = new Date().toISOString();
    const results: MemoryWriteResult[] = [];
    const touched = new Set<string>();
    const loaded = new Map<string, MemoryRecord>();
    for (const [memory_id, pointer] of Object.entries(manifest.records)) {
      const record = await read_memory_version(storage, manifest, memory_id, pointer);
      if (record) loaded.set(memory_id, record);
    }
    const tombstone = request.recreation ? loaded.get(request.recreation.memory_id) : undefined;
    if (request.recreation && (!("authority" in request.access) || request.access.authority !== "local_user" || request.changes.length !== 1
      || request.changes[0]!.operation !== "create" || !tombstone || tombstone.state === "active" || tombstone.version !== request.recreation.expected_version
      || !request.changes[0]!.sources.some(source => source.source_type === "management_input" && source.role === "user"))) throw new Error("RECREATION_AUTHORIZATION_REQUIRED");
    for (const [index, change] of request.changes.entries()) {
      if (!["create", "update", "delete", "invalidate"].includes(change.operation)) throw new Error("Invalid Memory operation");
      const previous = change.operation === "create" ? undefined : loaded.get(change.memory_id);
      if (change.operation !== "create" && (!previous || previous.version !== change.expected_version || previous.state !== "active")) {
        throw new MemoryVersionConflictError("Memory record changed or is unavailable", previous?.version);
      }
      const kind = change.operation === "create" ? change.kind : previous!.kind;
      const replaces = change.operation === "create" || change.operation === "update";
      validate_sources(change.sources, replaces && kind === "agreement");
      if (kind === "agreement" && address.scope.type === "workspace") throw new Error("Workspace supports Knowledge only");
      const content = replaces ? validate_memory_content(kind, change.content, change.title) : undefined;
      const normalized = content ? { ...content, content: normalize_memory_content(content.content) } : undefined;
      if (change.operation !== "create") {
        if (touched.has(change.memory_id)) throw new Error("Duplicate Memory identity in transaction");
        touched.add(change.memory_id);
      }
      if (change.operation === "create") {
        const duplicate = [...loaded.values()].find((record) => record.state === "active" && same_content(record, normalized!));
        if (duplicate) {
          results.push({ status: "unchanged", operation: "create", record: duplicate, request_id: request.request_id ?? request.commit_id,
            commit_id: request.commit_id, committed_at, activation: kind === "agreement" ? "next_turn_or_new_session" : "on_recall" });
          continue;
        }
      }
      const memory_id = change.operation === "create" ? `${address.prefix}/wiki/${memory_hash(`${request.commit_id}:${index}`)}` : change.memory_id;
      if (!memory_id.startsWith(`${address.prefix}/wiki/`) || memory_id.includes("..") || (change.operation === "create" && touched.has(memory_id))) throw new Error("Memory transaction has duplicate or foreign identity");
      touched.add(memory_id);
      if (change.operation === "create" && loaded.has(memory_id)) throw new MemoryVersionConflictError("Memory already exists");
      if (replaces && !request.recreation && (!previous || previous.content !== normalized!.content) && manifest.suppressions.some((item) => item.content_hash === memory_content_hash(normalized!.content))) throw new Error("MEMORY_SUPPRESSED: explicit management authorization required to remember again");
      // 完全不变时不造新版本；显式 update 只有新增合法来源时才发布来源新版本。
      const unchanged = change.operation === "update" && same_content(previous!, normalized!)
        && change.sources.every((source) => previous!.sources.some((existing) => existing.content_hash === source.content_hash
          && canonical_memory_json(existing.locator) === canonical_memory_json(source.locator)));
      if (unchanged) {
        results.push({ status: "unchanged", operation: change.operation, record: previous!, request_id: request.request_id ?? request.commit_id,
          commit_id: request.commit_id, committed_at, activation: kind === "agreement" ? "next_turn_or_new_session" : "on_recall" });
        continue;
      }
      const version = `${scope_version}:${index + 1}`;
      const state = change.operation === "delete" ? "deleted" : change.operation === "invalidate" ? "invalidated" : "active";
      const record = { ...(normalized ?? previous!), memory_id, scope: address.scope, version, state,
        sources: change.sources, created_at: previous?.created_at ?? committed_at, updated_at: committed_at } as MemoryRecord;
      const text = canonical_memory_json(record);
      const pointer: MemoryRecordPointer = { key: `${address.prefix}/runtime/records/versions/${memory_hash(memory_id)}/${memory_hash(version)}.json`, version, state, hash: memory_hash(text) };
      await storage.write(pointer.key, text);
      if (previous) {
        (manifest.history[memory_id] ??= []).push(manifest.records[memory_id]!);
        if (previous.content !== record.content || state !== "active") manifest.suppressions.push({ memory_id, version: previous.version, content_hash: memory_content_hash(previous.content), sources: previous.sources, reason: change.operation as "update" | "delete" | "invalidate" });
      }
      if (request.recreation && tombstone) (manifest.recreations ??= []).push({ tombstone_id: tombstone.memory_id, tombstone_version: tombstone.version, memory_id, commit_id: request.commit_id });
      manifest.records[memory_id] = pointer;
      loaded.set(memory_id, record);
      results.push({ status: "committed", operation: change.operation, request_id: request.request_id ?? request.commit_id, commit_id: request.commit_id, committed_at,
        record: state === "active" ? record : { memory_id, scope: record.scope, version, state },
        activation: kind === "agreement" ? "next_turn_or_new_session" : "on_recall" });
    }
    const receipt: MemoryCommitReceipt = { request_id: request.request_id ?? request.commit_id, scope: address.scope, commit_id: request.commit_id,
      request_hash, business_hash: request.business_hash, previous_scope_version: manifest.scope_version, scope_version, changes: results, committed_at };
    manifest.scope_version = scope_version;
    manifest.receipts[receipt_key] = receipt;
    await storage.write(memory_manifest_key(address.prefix), canonical_memory_json(manifest));
    return JSON.parse(canonical_memory_json(receipt)) as MemoryCommitReceipt;
  });
}
/** 恢复只读取已发布的固定回执。 */
export async function read_memory_commit_receipt(storage: MemoryStorageAdapter, address: MemoryScopeAddress, commit_id: string): Promise<MemoryCommitReceipt | null> {
  return (await read_memory_manifest(storage, address)).receipts[memory_hash(commit_id)] ?? null;
}
