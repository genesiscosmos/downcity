/**
 * 确定性知识提交：范围 manifest 是唯一权威状态，记录、抑制与回执一次发布。
 * 写入全程持有 Adapter 的跨进程锁；读者固定一次 manifest，不读取未发布文件。
 * 旧 Markdown 仅经显式导入进入有效集合，不在读取或初始化时转换用户数据。
 */
import { createHash } from "node:crypto";
import type { MemoryRecord } from "../types/Memory.js";
import type { MemoryStorageAdapter } from "../types/MemoryStorage.js";
import type {
  MemoryChangeSet, MemoryCommitReceipt, MemoryVersionedRecord, MemorySuppression,
} from "../types/MemoryChangeSet.js";
import { MemoryVersionConflictError, normalize_memory_content } from "../types/MemoryChangeSet.js";
import type { MemorySubjectAddress } from "./MemoryAddress.js";
import { create_citation, normalize_memory_id } from "./BuiltinMemoryDocument.js";

/** 已发布的完整范围状态；所有逻辑 key 都属于同一个 prefix。 */
export interface MemoryScopeManifest {
  /** 文件协议版本，未知版本明确拒绝读取。 */
  schema_version: 1;
  /** 从可信 access/target 解析的范围绑定。 */
  scope_prefix: string;
  /** 当前发布版本；空范围为 0。 */
  scope_version: string;
  /** 记录的当前版本，包含退出有效集合的逻辑墓碑。 */
  records: Record<string, MemoryVersionedRecord>;
  /** 与数据同批发布的稳定提交回执。 */
  receipts: Record<string, MemoryCommitReceipt>;
  /** 退出或被替代内容的精确抑制信息。 */
  suppressions: MemorySuppression[];
}

/** 规范 JSON：字段顺序不影响请求幂等性，数组顺序保留业务含义。 */
function canonical_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical_json(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 规范正文的精确指纹，不声称具备语义去重能力。 */
export function memory_content_hash(content: string): string {
  return hash_value(normalize_memory_content(content));
}

/** 对字符串生成稳定 SHA-256。 */
function hash_value(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 范围的唯一发布入口。整个文件为完整 manifest，rename 是单一可见性边界。 */
function manifest_key(prefix: string): string {
  return `${prefix}/runtime/knowledge/current.json`;
}

/** 读取一次已发布快照；既不自动导入旧数据，也不生成默认知识。 */
export async function read_memory_manifest(
  storage: MemoryStorageAdapter, prefix: string,
): Promise<MemoryScopeManifest> {
  const content = await storage.read(manifest_key(prefix));
  if (content === null) return {
    schema_version: 1, scope_prefix: prefix, scope_version: "0",
    records: {}, receipts: {}, suppressions: [],
  };
  const manifest = JSON.parse(content) as MemoryScopeManifest;
  if (manifest.schema_version !== 1 || manifest.scope_prefix !== prefix
    || typeof manifest.scope_version !== "string" || !manifest.records
    || !manifest.receipts || !Array.isArray(manifest.suppressions)) {
    throw new Error(`Invalid Memory scope manifest: ${prefix}`);
  }
  for (const [memory_id, record] of Object.entries(manifest.records)) {
    if (!memory_id.startsWith(`${prefix}/wiki/`) && !memory_id.startsWith(`${prefix}/evidence/`)) {
      throw new Error("Memory manifest record escapes its scope");
    }
    if (record.memory.memory_id !== memory_id || record.version !== record.memory.version
      || record.validity !== record.memory.validity) throw new Error("Invalid Memory record version");
  }
  return manifest;
}

/** 从一次固定快照提取当前时间有效的记录。 */
export function active_memory_records(manifest: MemoryScopeManifest, now = Date.now()): MemoryRecord[] {
  return Object.values(manifest.records).filter((record) => record.validity === "active"
    && (!record.memory.valid_from || Date.parse(record.memory.valid_from) <= now)
    && (!record.memory.valid_to || Date.parse(record.memory.valid_to) > now))
    .map((record) => record.memory);
}

/** 校验 ISO 8601 时间，避免无效时间令记录意外进入读取集合。 */
function validate_interval(valid_from?: string, valid_to?: string): void {
  for (const value of [valid_from, valid_to]) {
    if (value !== undefined && (!value || !Number.isFinite(Date.parse(value)))) {
      throw new Error("Memory validity dates must be valid ISO 8601 timestamps");
    }
  }
  if (valid_from && valid_to && Date.parse(valid_from) >= Date.parse(valid_to)) {
    throw new Error("Memory valid_to must be later than valid_from");
  }
}

/** 在真实跨进程范围锁内检查版本并发布完整快照，回执与数据不可分离。 */
export async function commit_memory_changes(
  storage: MemoryStorageAdapter, address: MemorySubjectAddress, input: MemoryChangeSet,
): Promise<MemoryCommitReceipt> {
  // 在首个 await 前复制请求，避免等待锁期间调用方修改已验证数据。
  const request = structuredClone(input);
  const commit_id = String(request.commit_id || "").trim();
  if (!commit_id || commit_id.length > 512) throw new Error("Memory commit requires a bounded commit_id");
  if (!Array.isArray(request.changes) || request.changes.length === 0 || request.changes.length > 500) {
    throw new Error("Memory commit requires 1..500 changes");
  }
  const request_hash = hash_value(canonical_json({
    scope_prefix: address.prefix, target: request.target,
    requested_by: request.access.agent_id, request_id: request.request_id ?? commit_id,
    expected_scope_version: request.expected_scope_version, changes: request.changes,
  }));
  return await storage.with_scope_lock(manifest_key(address.prefix), async () => {
    const manifest = await read_memory_manifest(storage, address.prefix);
    const receipt_key = hash_value(commit_id);
    const existing_receipt = manifest.receipts[receipt_key];
    if (existing_receipt) {
      if (existing_receipt.request_hash !== request_hash) throw new Error("Memory commit_id was reused for a different request");
      return existing_receipt;
    }
    if (request.request_id) {
      const request_receipt = Object.values(manifest.receipts).find((receipt) => receipt.request_id === request.request_id);
      if (request_receipt) {
        if (request_receipt.request_hash !== request_hash) throw new Error("Memory request_id was reused for a different request");
        return request_receipt;
      }
    }
    if (request.expected_scope_version !== undefined && request.expected_scope_version !== manifest.scope_version) {
      throw new MemoryVersionConflictError(`Memory scope version changed: ${address.prefix}`);
    }
    const committed_at = new Date().toISOString();
    const scope_version = String(BigInt(manifest.scope_version) + 1n);
    const changes: MemoryCommitReceipt["changes"] = [];
    const changed_ids = new Set<string>();
    for (const [index, change] of request.changes.entries()) {
      if (!["create", "update", "delete", "invalidate"].includes(change.operation)) throw new Error("Unknown Memory operation");
      const memory_id = normalize_memory_id(change.memory_id ?? (change.operation === "create"
        ? `${address.prefix}/wiki/${hash_value(`${commit_id}:${index}`)}` : ""));
      if (!memory_id.startsWith(`${address.prefix}/wiki/`)) throw new Error("Memory commit cannot change another target or namespace");
      if (changed_ids.has(memory_id)) throw new Error("Memory commit contains duplicate memory_id");
      changed_ids.add(memory_id);
      const previous = manifest.records[memory_id];
      if (change.operation === "create") {
        if (previous) throw new MemoryVersionConflictError(`Memory already exists: ${memory_id}`);
        if (change.expected_version !== undefined) throw new Error("Memory create cannot specify expected_version");
      } else if (!previous || !change.expected_version || previous.version !== change.expected_version) {
        throw new MemoryVersionConflictError(`Memory record version changed or absent: ${memory_id}`);
      }
      if (!Array.isArray(change.source_refs)) throw new Error("Memory changes require source_refs");
      for (const source of change.source_refs) {
        if (!source || !String(source.source_id || "").trim() || !String(source.source_type || "").trim()) {
          throw new Error("Memory source_refs require source_id and source_type");
        }
      }
      const replaces_content = change.operation === "create" || change.operation === "update";
      if (replaces_content && (!change.content?.trim() || !change.source_refs.length)) {
        throw new Error("Memory create/update requires full content and source_refs");
      }
      if (previous && previous.validity !== "active" && change.operation === "update" && !change.allow_recreation) {
        throw new Error("Memory reactivation requires explicit allow_recreation authorization");
      }
      if (replaces_content) {
        validate_interval(change.valid_from, change.valid_to);
        if (change.memory_type && !["fact", "preference", "decision", "episode", "procedure", "document"].includes(change.memory_type)) {
          throw new Error("Invalid Memory memory_type");
        }
        const suppressed = manifest.suppressions.some((item) => item.content_hash === memory_content_hash(change.content!));
        if (suppressed && !change.allow_recreation) throw new Error("Memory content was suppressed; explicit authorization is required to remember it again");
      }
      if (previous) manifest.suppressions.push({
        memory_id, version: previous.version, content_hash: memory_content_hash(previous.memory.content),
        source_refs: previous.memory.source_refs,
        reason: change.operation as "update" | "delete" | "invalidate",
      });
      const version = `${scope_version}:${index + 1}`;
      const validity = change.operation === "delete" ? "deleted" : change.operation === "invalidate" ? "invalidated" : "active";
      const memory: MemoryRecord = replaces_content ? {
        memory_id, owner: address.owner, subject: address.subject,
        memory_type: change.memory_type ?? previous?.memory.memory_type ?? "fact",
        content: normalize_memory_content(change.content!), observed_at: committed_at,
        source_refs: change.source_refs,
        ...(change.valid_from ? { valid_from: change.valid_from } : {}),
        ...(change.valid_to ? { valid_to: change.valid_to } : {}),
        metadata: { title: change.topic ?? previous?.memory.metadata?.title ?? memory_id },
        citation: create_citation(memory_id), version, validity,
      } : { ...previous!.memory, source_refs: [...previous!.memory.source_refs, ...change.source_refs], version, validity };
      manifest.records[memory_id] = { memory, version, validity };
      changes.push({ operation: change.operation, memory_id, version, validity });
    }
    const receipt: MemoryCommitReceipt = {
      commit_id, request_id: request.request_id ?? commit_id, scope_prefix: address.prefix,
      request_hash, previous_scope_version: manifest.scope_version, scope_version, changes, committed_at,
    };
    manifest.scope_version = scope_version;
    manifest.receipts[receipt_key] = receipt;
    // 完整 manifest 先 fsync 再 rename；崩溃前读旧版，发布后回执与所有变更一起可见。
    await storage.write(manifest_key(address.prefix), JSON.stringify(manifest));
    return receipt;
  });
}

/** 显式导入结果，调用方必须先确认数据来源、目标范围及备份。 */
export interface MemoryLegacyImportInput extends Omit<MemoryChangeSet, "changes"> {
  /** 已由调用方明确选择的旧记录，不自行扫描用户运行数据根。 */
  records: MemoryRecord[];
}

/** 显式转换旧记录为同一提交；来源缺失时仅标记为 legacy_import，不推断原始证据。 */
export function create_memory_import_changeset(input: MemoryLegacyImportInput): MemoryChangeSet {
  return {
    ...input,
    changes: input.records.map((record) => ({
      operation: "create", memory_id: record.memory_id, content: record.content,
      memory_type: record.memory_type, topic: String(record.metadata?.title ?? record.memory_id),
      valid_from: record.valid_from, valid_to: record.valid_to,
      source_refs: record.source_refs.length ? record.source_refs : [{
        source_id: record.memory_id, source_type: "legacy_import", label: "Explicit import; original evidence unavailable",
      }],
    })),
  };
}

/** 读取范围内已经发布的提交回执。 */
export async function read_memory_commit_receipt(
  storage: MemoryStorageAdapter, prefix: string, commit_id: string,
): Promise<MemoryCommitReceipt | null> {
  return (await read_memory_manifest(storage, prefix)).receipts[hash_value(commit_id)] ?? null;
}
