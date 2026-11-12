/**
 * BuiltinMemoryProvider：Downcity 默认的本地长期记忆实现。
 *
 * 关键点（中文）
 * - Provider 负责 Memory 领域语义，底层 Storage Adapter 只负责文本持久化。
 * - memory_id、citation 与 access 均为逻辑协议，不暴露 Adapter 的物理位置。
 * - 当前召回使用确定性文本扫描；以后可在 Provider 内替换索引而不改变 Power API。
 */

import { get_logger } from "@downcity/agent";
import { notify_memory_change } from "@/memory/types/MemoryChange.js";
import type {
  BuiltinMemoryProviderOptions,
} from "@/memory/types/BuiltinMemoryProvider.js";
import type {
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryListInput,
  MemoryListResult,
  MemoryProvider,
  MemoryProviderCapabilities,
  MemoryReadInput,
  MemoryReadResult,
  MemoryRecallInput,
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryStatusResult,
} from "@/memory/types/Memory.js";
import type {
  MemoryKnowledgeAccess,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";
import type {
  MemoryStorageAdapter,
} from "@/memory/types/MemoryStorage.js";
import {
  resolve_readable_memory_address,
  resolve_readable_memory_addresses,
  resolve_writable_memory_address,
  type MemorySubjectAddress,
} from "@/memory/runtime/MemoryAddress.js";
import {
  chunk_memory_record,
  score_memory_chunk,
  tokenize_memory_query,
} from "@/memory/runtime/MemoryRecall.js";
import {
  clamp_number,
  count_memory_subjects,
  create_citation,
  memory_id_to_key,
  normalize_list_limit,
  normalize_list_offset,
  normalize_memory_id,
  normalize_memory_types,
  normalize_subject_kinds,
  to_memory_list_item,
} from "@/memory/runtime/BuiltinMemoryDocument.js";

import type { MemoryChangeSet, MemoryCommitReceipt, MemoryVersionInput, MemoryVersionResult, MemoryCommitReceiptInput, MemoryCommitProvider } from "../types/MemoryChangeSet.js";
import { commit_memory_changes, read_memory_manifest, read_memory_commit_receipt, active_memory_records } from "../runtime/MemoryCommit.js";

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.35;
const SNIPPET_MAX_CHARS = 700;

/** Downcity 默认的 provider-neutral Memory 实现。 */
export class BuiltinMemoryProvider implements MemoryProvider {
  /** 当前 Provider 稳定名称。 */
  readonly name = "builtin";

  /** Builtin 保留原生强事务端口，基础 Provider 不要求实现它。 */
  readonly transactions: MemoryCommitProvider = this;

  /** 当前 Provider 支持的完整能力。 */
  readonly capabilities: MemoryProviderCapabilities = Object.freeze({
    remember: true,
    recall: true,
    read: true,
    list: true,
    forget: true,
    transactions: true,
  });

  /** 调用方注入的内容变更回调。 */
  private readonly on_changed: BuiltinMemoryProviderOptions["on_changed"];

  /** 一条知识记录提交后发布业务事实，监听失败不影响数据结果。 */
  private notify_changed(memory_id: string, operation: "written" | "deleted" = "written"): void {
    notify_memory_change(this.on_changed, { kind: "knowledge", operation, memory_id },
      () => get_logger().error("Memory change callback failed"));
  }

  /** 当前 Provider 已创建的唯一低层存储 Adapter。 */
  private storage?: MemoryStorageAdapter;

  /** 当前 Provider 可选使用的延迟 Storage Adapter 工厂。 */
  private readonly create_storage: BuiltinMemoryProviderOptions["create_storage"];

  /** 当前统一 Adapter 是否包含 City 共享 Store。 */
  private readonly city_memory_available: boolean;

  /** 当前 Provider 的共享存储是否已经初始化。 */
  private initialized = false;

  constructor(options: BuiltinMemoryProviderOptions) {
    const has_storage = Boolean(options?.storage);
    const has_factory = typeof options?.create_storage === "function";
    if (has_storage === has_factory) {
      throw new Error("BuiltinMemoryProvider requires exactly one storage or create_storage");
    }
    this.on_changed = options.on_changed;
    this.storage = options.storage;
    this.create_storage = options.create_storage;
    this.city_memory_available = options.city_memory_available === true;
  }

  /** 初始化 Adapter 和默认索引投影。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const created_storage = !this.storage;
    const storage = this.storage ?? await this.create_storage?.();
    if (!storage) throw new Error("BuiltinMemoryProvider storage factory returned no Adapter");
    this.storage = storage;
    try {
      await storage.initialize();
    } catch (error) {
      if (created_storage) {
        await storage.dispose().catch(() => undefined);
        this.storage = undefined;
      }
      throw error;
    }
    this.initialized = true;
  }

  /** 读取固定范围快照的版本和精确抑制信息。 */
  async read_version(input: MemoryVersionInput): Promise<MemoryVersionResult> {
    this.assert_access(input.access);
    const address = resolve_writable_memory_address(input.access, input.target);
    const manifest = await read_memory_manifest(this.active_storage, address.prefix);
    return { scope_version: manifest.scope_version, suppressions: manifest.suppressions };
  }

  /** 唯一知识写入口：先绑定可信 target，再由跨进程锁保护版本校验与发布。 */
  async commit(input: MemoryChangeSet): Promise<MemoryCommitReceipt> {
    this.assert_access(input.access);
    const address = resolve_writable_memory_address(input.access, input.target);
    const receipt = await commit_memory_changes(this.active_storage, address, input);
    for (const change of receipt.changes) this.notify_changed(change.memory_id,
      change.validity === "active" ? "written" : "deleted");
    return receipt;
  }

  /** 通过相同 target 查询持久回执，供提交后中断的 Job 恢复。 */
  async read_commit_receipt(input: MemoryCommitReceiptInput): Promise<MemoryCommitReceipt | null> {
    this.assert_access(input.access);
    const address = resolve_writable_memory_address(input.access, input.target);
    return await read_memory_commit_receipt(this.active_storage, address.prefix, input.commit_id);
  }

  /** 直接检查当前实例的初始化与 Adapter 状态，不读取任何范围的记忆。 */
  async inspect(): Promise<MemoryStatusResult> {
    const ready = this.initialized && Boolean(this.storage);
    return {
      provider: this.name,
      state: ready ? "ready" : "degraded",
      capabilities: this.capabilities,
      details: {
        initialized: this.initialized,
        ...(this.storage ? { storage_adapter: this.storage.name } : {}),
        city_memory_available: this.city_memory_available,
      },
      ...(ready ? {} : { warnings: ["BuiltinMemoryProvider is not initialized"] }),
    };
  }

  /** 返回 Provider 状态与可重建统计。 */
  async status(access: MemoryKnowledgeAccess): Promise<MemoryStatusResult> {
    this.assert_access(access);
    const address = resolve_writable_memory_address(access, "authority" in access ? "user" : "agent");
    const manifest = await read_memory_manifest(this.active_storage, address.prefix);
    const records = active_memory_records(manifest);
    const legacy_entries = await this.active_storage.list(`${address.prefix}/wiki`);
    const chunk_count = records.reduce((count, memory) => count + chunk_memory_record(memory).length, 0);
    return {
      provider: this.name,
      state: "ready",
      capabilities: this.capabilities,
      ...(legacy_entries.length ? { warnings: ["Unimported Markdown files are retained outside the active versioned store; explicit import is required."] } : {}),
      details: {
        storage_adapter: this.active_storage.name,
        agent_memories: records.length,
        city_memory_available: this.city_memory_available,
        scope_version: manifest.scope_version,
        unimported_markdown_files: legacy_entries.length,
        evidence: records.reduce((count, record) => count + record.source_refs.length, 0),
        chunks: chunk_count,
      },
    };
  }

  /** 使用确定性扫描召回记忆，底层存储形态对调用方不可见。 */
  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.assert_access(input.access);
    const query = String(input.query || "").trim();
    if (!query) return { provider: this.name, items: [] };
    const tokens = tokenize_memory_query(query);
    if (tokens.length === 0) return { provider: this.name, items: [] };
    const addresses = input.target
      ? [resolve_writable_memory_address(input.access, input.target)]
      : resolve_readable_memory_addresses(input.access);
    const records = (await Promise.all(addresses.map(async (address) =>
      active_memory_records(await read_memory_manifest(this.active_storage, address.prefix))))).flat();
    const max_results = Math.floor(clamp_number(
      Number(input.max_results ?? DEFAULT_MAX_RESULTS),
      1,
      20,
    ));
    const min_score = clamp_number(
      Number(input.min_score ?? DEFAULT_MIN_SCORE),
      0,
      1,
    );
    const items = records
      .filter((memory) => !memory.metadata?.applicable_agent_id || memory.metadata.applicable_agent_id === input.access.agent_id)
      .flatMap((memory) => chunk_memory_record(memory))
      .map((chunk): MemoryRecallItem => {
        const score = score_memory_chunk(chunk.text, tokens);
        const citation = create_citation(
          chunk.memory.memory_id,
          chunk.start_line,
          chunk.end_line,
        );
        return {
          memory: { ...chunk.memory, citation },
          score,
          snippet: chunk.text.length <= SNIPPET_MAX_CHARS
            ? chunk.text
            : chunk.text.slice(0, SNIPPET_MAX_CHARS),
        };
      })
      .filter((item) => item.score >= min_score)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.memory.memory_id.localeCompare(right.memory.memory_id);
      })
      .slice(0, max_results);
    return { provider: this.name, items };
  }

  /** 按 memory_id 精确读取并应用可选行预算。 */
  async read(input: MemoryReadInput): Promise<MemoryReadResult> {
    this.assert_access(input.access);
    const memory_id = normalize_memory_id(input.memory_id);
    const address = resolve_readable_memory_address(input.access, memory_id);
    const manifest = await read_memory_manifest(this.active_storage, address.prefix);
    const base = active_memory_records(manifest).find((record) => record.memory_id === memory_id);
    if (!base) return { memory_id, memory: null };
    if (base.metadata?.applicable_agent_id && base.metadata.applicable_agent_id !== input.access.agent_id) {
      throw new Error("Memory is not applicable to the current Agent");
    }
    const from_line = input.from_line
      ? Math.max(1, Math.floor(input.from_line))
      : undefined;
    const line_count = input.line_count
      ? Math.max(1, Math.floor(input.line_count))
      : undefined;
    if (!from_line && !line_count) return { memory_id, memory: base };
    const lines = base.content.split("\n");
    const start = from_line ?? 1;
    const count = line_count ?? lines.length;
    const end = Math.min(lines.length, start + count - 1);
    return {
      memory_id,
      memory: {
        ...base,
        content: lines.slice(start - 1, end).join("\n"),
        citation: create_citation(memory_id, start, end),
      },
    };
  }

  /** 按当前访问上下文枚举可读记忆。 */
  async list(input: MemoryListInput): Promise<MemoryListResult> {
    this.assert_access(input.access);
    const subject_kinds = normalize_subject_kinds(input.subject_kinds);
    const memory_types = normalize_memory_types(input.memory_types);
    const include_evidence = input.include_evidence === true;
    const addresses = resolve_readable_memory_addresses(input.access);
    const collected = (await Promise.all(addresses.map(async (address) => {
      return active_memory_records(await read_memory_manifest(this.active_storage, address.prefix))
        .filter((record) => !record.metadata?.applicable_agent_id || record.metadata.applicable_agent_id === input.access.agent_id)
        .filter((record) => include_evidence || !record.memory_id.includes("/evidence/"))
        .map((record) => to_memory_list_item(record, memory_id_to_key(record.memory_id)));
    }))).flat();
    const subject_counts = count_memory_subjects(collected);
    const filtered = collected
      .filter((item) => subject_kinds.size === 0 || subject_kinds.has(item.subject.kind))
      .filter((item) => memory_types.size === 0 || memory_types.has(item.memory_type))
      .sort((left, right) => {
        if (left.observed_at !== right.observed_at) {
          return right.observed_at.localeCompare(left.observed_at);
        }
        return left.memory_id.localeCompare(right.memory_id);
      });
    const limit = normalize_list_limit(input.limit);
    const offset = normalize_list_offset(input.offset);
    return {
      provider: this.name,
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      subject_counts,
    };
  }

  /** 删除当前 Provider 中的指定记忆。 */
  async forget(input: MemoryForgetInput): Promise<MemoryForgetResult> {
    this.assert_access(input.access);
    const memory_id = normalize_memory_id(input.memory_id);
    const address = resolve_readable_memory_address(input.access, memory_id);
    this.assert_address_writable(input.access, address);
    const existing = (await this.read({ access: input.access, memory_id })).memory;
    if (!existing) return { memory_id, forgotten: false };
    const target = address.subject.kind === "workspace" ? "current_workspace" : address.subject.kind === "user" ? "user" : "agent";
    await this.commit({ access: input.access, target,
      commit_id: `delete:${memory_id}:${existing.version}`,
      changes: [{ operation: "delete", memory_id, expected_version: existing.version, source_refs: [] }],
    });
    return { memory_id, forgotten: true };
  }

  /** 释放底层 Adapter 并关闭当前绑定。 */
  async dispose(): Promise<void> {
    try {
      await this.storage?.dispose();
    } finally {
      if (this.create_storage) this.storage = undefined;
      this.initialized = false;
    }
  }

  /** 返回当前已创建的唯一 Storage Adapter。 */
  private get active_storage(): MemoryStorageAdapter {
    if (!this.storage) throw new Error("BuiltinMemoryProvider storage is not initialized");
    return this.storage;
  }

  /** 校验访问上下文完整，并且没有伪造 City 能力。 */
  private assert_access(access: MemoryKnowledgeAccess): void {
    if (!this.initialized) throw new Error("BuiltinMemoryProvider is not initialized");
    resolve_readable_memory_addresses(access);
    if (access.city_memory_available && !this.city_memory_available) {
      throw new Error("Memory access cannot enable an unavailable City Store");
    }
  }

  /** revise/forget 只允许当前 Agent 与当前 Workspace 共享记忆，拒绝直接修改其他范围。 */
  private assert_address_writable(
    access: MemoryKnowledgeAccess,
    address: MemorySubjectAddress,
  ): void {
    const targets: MemoryWriteTarget[] = ["agent", "user", "current_workspace"];
    const writable = targets.some((target) => {
      try {
        return resolve_writable_memory_address(access, target).prefix === address.prefix;
      } catch {
        return false;
      }
    });
    if (!writable) {
      throw new Error(`Memory Subject is read-only in the current access context: ${address.prefix}`);
    }
  }

}
