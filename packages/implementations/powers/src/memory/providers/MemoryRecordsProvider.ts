/** Builtin 统一记录后端：所有查询固定 manifest，范围过滤先于排序及分页。 */
import type { BuiltinMemoryProviderOptions } from "../types/BuiltinMemoryProvider.js";
import type { MemoryProvider, MemoryStatusResult, MemoryReadInput, MemoryListInput, MemoryRecallInput, MemoryRecallItem, MemoryProviderCapabilities } from "../types/MemoryProtocol.js";
import type { MemoryKnowledgeAccess } from "../types/MemoryAccess.js";
import type { MemoryStorageAdapter } from "../types/MemoryStorage.js";
import type { MemoryChangeSet, MemoryCommitProvider, MemoryVersionInput, MemoryCommitReceiptInput } from "../types/MemoryTransaction.js";
import { resolve_readable_memory_addresses, resolve_writable_memory_address, resolve_readable_memory_address } from "../runtime/MemoryAddress.js";
import { active_memory_records, read_memory_version, commit_memory_changes, memory_hash } from "../storage/MemoryRecordStore.js";
import { prepare_memory_scope } from "../storage/MemoryScopeLifecycle.js";
import type { MemoryScopeAddress } from "../runtime/MemoryAddress.js";
import { memory_display_label, memory_read_schema, memory_list_schema, memory_search_schema } from "../runtime/MemorySchema.js";
import { chunk_memory_record, score_memory_chunk, tokenize_memory_query } from "../runtime/MemoryRecall.js";
import { notify_memory_change } from "../types/MemoryChange.js";

/** Provider 生命周期由 MemoryPower 持有，底层 Adapter 不理解领域内容。 */
export class BuiltinMemoryProvider implements MemoryProvider, MemoryCommitProvider {
  /** 稳定后端名。 */
  readonly name = "builtin";
  /** 同一实例提供统一事务。 */
  readonly transactions: MemoryCommitProvider = this;
  /** 不支持弱事务降级。 */
  readonly capabilities: MemoryProviderCapabilities = Object.freeze({ remember: true, recall: true, read: true, list: true, forget: true, transactions: true });
  /** 独占低层存储。 */
  private storage?: MemoryStorageAdapter;
  /** 只有成功初始化后开放访问。 */
  private initialized = false;
  constructor(private readonly options: BuiltinMemoryProviderOptions) {
    if (Boolean(options.storage) === (typeof options.create_storage === "function")) throw new Error("Exactly one storage or create_storage is required");
    this.storage = options.storage;
  }
  /** 初始化资源，不扫描或转换运行记忆。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const storage = this.storage ?? await this.options.create_storage?.();
    if (!storage) throw new Error("Memory storage unavailable");
    this.storage = storage;
    await storage.initialize();
    this.initialized = true;
  }
  /** 生命周期检查不打开任何范围。 */
  async inspect(): Promise<MemoryStatusResult> {
    return { provider: this.name, state: this.initialized ? "ready" : "degraded", capabilities: this.capabilities };
  }
  /** 每次 Session 加载准备全部可信范围；真正空范围激活，有旧材料则阻止。 */
  async assert_ready(access: MemoryKnowledgeAccess): Promise<void> {
    for (const address of resolve_readable_memory_addresses(access)) await this.prepare_scope(address);
  }
  /** 工具、管理、CLI 和 Session 共享同一个范围生命周期。 */
  private async prepare_scope(address: MemoryScopeAddress) {
    return await prepare_memory_scope(this.active_storage, address, this.options.legacy_scope_probe);
  }
  /** 状态计量只在显式授权范围进行。 */
  async status(access: MemoryKnowledgeAccess): Promise<MemoryStatusResult> {
    await this.assert_ready(access);
    const result = await this.list({ access });
    return { provider: this.name, state: "ready", capabilities: this.capabilities, details: { scope_counts: result.scope_counts } };
  }
  /** 固定范围版本。 */
  async read_version(input: MemoryVersionInput) {
    const manifest = await this.prepare_scope(resolve_writable_memory_address(input.access, input.scope));
    return { scope_version: manifest.scope_version, suppressions: manifest.suppressions };
  }
  /** 唯一写入入口，回调失败不撤销已提交数据。 */
  async commit(input: MemoryChangeSet) {
    const address = resolve_writable_memory_address(input.access, input.scope);
    await this.prepare_scope(address);
    const receipt = await commit_memory_changes(this.active_storage, address, input);
    for (const change of receipt.changes) if (change.status === "committed") {
      notify_memory_change(this.options.on_changed, { kind: "record", operation: change.record.state === "active" ? "written" : "deleted", memory_id: change.record.memory_id });
    }
    return receipt;
  }
  /** 历史只向已认证管理权限开放，不进入 list/search。 */
  async read_history(input: { /** 管理权限。 */ access: MemoryKnowledgeAccess; /** 对象身份。 */ memory_id: string }) {
    if (!("authority" in input.access) || input.access.authority !== "local_user") throw new Error("Memory history requires authenticated management access");
    const address = resolve_readable_memory_address(input.access, input.memory_id);
    const manifest = await this.prepare_scope(address);
    const pointers = [...(manifest.history[input.memory_id] ?? []), ...(manifest.records[input.memory_id] ? [manifest.records[input.memory_id]!] : [])];
    return (await Promise.all(pointers.map(pointer => read_memory_version(this.active_storage, manifest, input.memory_id, pointer)))).filter((record): record is import("../types/MemoryProtocol.js").MemoryRecord => record !== null);
  }
  /** 恢复固定持久回执。 */
  async read_commit_receipt(input: MemoryCommitReceiptInput) {
    const manifest = await this.prepare_scope(resolve_writable_memory_address(input.access, input.scope));
    return manifest.receipts[memory_hash(input.commit_id)] ?? null;
  }
  /** 精确读取只返回 active；正文范围不加入独立标题。 */
  async read(input: MemoryReadInput) {
    const { access, ...payload } = input;
    memory_read_schema.parse(payload);
    const address = resolve_readable_memory_address(access, input.memory_id);
    const manifest = await this.prepare_scope(address);
    const pointer = manifest.records[input.memory_id];
    if (!pointer || pointer.state !== "active") return { memory_id: input.memory_id, memory: null };
    const record = await read_memory_version(this.active_storage, manifest, input.memory_id, pointer);
    if (!record || (!input.from_line && !input.line_count)) return { memory_id: input.memory_id, memory: record };
    const start = (input.from_line ?? 1) - 1;
    const lines = record.content.split("\n");
    const selected = lines.slice(start, input.line_count ? start + input.line_count : undefined);
    return { memory_id: input.memory_id, memory: { ...record, content: selected.join("\n") }, range: { start_line: start + 1, end_line: start + selected.length, total_lines: lines.length } };
  }
  /** 列表只投影唯一 label，不猜测标题。 */
  async list(input: MemoryListInput) {
    const { access, ...payload } = input;
    memory_list_schema.parse(payload);
    const addresses = input.scope ? [resolve_writable_memory_address(access, input.scope)] : resolve_readable_memory_addresses(access);
    const records = (await Promise.all(addresses.map(async (address) => await active_memory_records(this.active_storage, await this.prepare_scope(address))))).flat();
    const scope_counts = { user: 0, agent: 0, workspace: 0 };
    for (const record of records) scope_counts[record.scope.type]++;
    const filtered = records.filter((record) => !input.kind || record.kind === input.kind)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.memory_id.localeCompare(right.memory_id));
    const offset = input.offset ?? 0;
    return { provider: this.name, items: filtered.slice(offset, offset + (input.limit ?? 100)).map((record) => ({ ...record, label: memory_display_label(record) })), total: filtered.length, scope_counts };
  }
  /** 检索标题和正文分别打分，正文引用保持原行号和版本。 */
  async recall(input: MemoryRecallInput) {
    const { access, ...payload } = input;
    memory_search_schema.parse(payload);
    const addresses = input.scope ? [resolve_writable_memory_address(access, input.scope)] : resolve_readable_memory_addresses(access);
    const tokens = tokenize_memory_query(input.query);
    const records = (await Promise.all(addresses.map(async (address) => await active_memory_records(this.active_storage, await this.prepare_scope(address))))).flat()
      .filter((record) => !input.kind || record.kind === input.kind);
    const items: MemoryRecallItem[] = records.flatMap((record) => {
      const title_score = record.kind === "knowledge" ? score_memory_chunk(record.title, tokens) : 0;
      return chunk_memory_record(record).map((chunk) => {
        const content_score = score_memory_chunk(chunk.text, tokens);
        return { memory: record, score: Math.max(title_score, content_score), snippet: chunk.text,
          matched_field: title_score > content_score ? "title" as const : "content" as const,
          start_line: chunk.start_line, end_line: chunk.end_line,
          citation: `memory:${record.memory_id}@${record.version}#L${chunk.start_line}-L${chunk.end_line}` };
      });
    }).filter((item) => item.score >= (input.min_score ?? 0.1))
      .sort((left, right) => right.score - left.score || left.memory.memory_id.localeCompare(right.memory.memory_id));
    // 每个对象保留最佳片段，标题命中不会把同一对象重复占满结果。
    const seen = new Set<string>();
    return { provider: this.name, items: items.filter((item) => { if (seen.has(item.memory.memory_id)) return false; seen.add(item.memory.memory_id); return true; }).slice(0, input.max_results ?? 6) };
  }
  /** 全部资源独立收口。 */
  async dispose(): Promise<void> {
    try { await this.storage?.dispose(); } finally { this.storage = undefined; this.initialized = false; }
  }
  /** 未初始化不允许隐式创建数据。 */
  private get active_storage(): MemoryStorageAdapter {
    if (!this.initialized || !this.storage) throw new Error("Memory provider not initialized");
    return this.storage;
  }
}
