/** 同步 Memory 用例：Power、SDK、CLI、管理端共用 schema、来源绑定和唯一事务提交器。 */
import { randomUUID } from "node:crypto";
import type { PowerContext, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider, MemoryRememberInput, MemoryUpdateInput, MemoryForgetInput, MemorySource, MemoryRecord } from "../types/MemoryProtocol.js";
import type { MemoryKnowledgeAccess } from "../types/MemoryAccess.js";
import type { MemoryChange } from "../types/MemoryTransaction.js";
import { MemoryVersionConflictError } from "../types/MemoryTransaction.js";
import { memory_remember_schema, memory_update_schema, memory_forget_schema, validate_memory_content } from "../runtime/MemorySchema.js";
import { bind_memory_sources } from "./MemorySourceBinding.js";
import { resolve_readable_memory_addresses, resolve_writable_memory_address } from "../runtime/MemoryAddress.js";

import { canonical_memory_json, memory_hash } from "../storage/MemoryRecordStore.js";

/** 唯一确定性写入服务，不调用模型。 */
export class MemoryRecords {
  constructor(private readonly provider: MemoryProvider, private readonly host?: PowerLifecycleContext) {}
  /** 当前记录重新授权，绝不信任调用方提供的归属。 */
  async read_current(access: MemoryKnowledgeAccess, memory_id: string, expected_version: string): Promise<MemoryRecord> {
    const { memory } = await this.provider.read({ access, memory_id });
    if (!memory) throw new Error("MEMORY_NOT_FOUND");
    if (memory.version !== expected_version) throw new MemoryVersionConflictError("Memory version changed", memory.version);
    const scope = resolve_writable_memory_address(access, memory.scope.type).scope;
    if (scope.id !== memory.scope.id) throw new Error("MEMORY_ACCESS_DENIED");
    return memory;
  }
  /** 创建仅接受判别联合，无标题覆盖或分类推断。 */
  async remember(context: PowerContext, access: MemoryKnowledgeAccess, payload: MemoryRememberInput) {
    const input = memory_remember_schema.parse(payload);
    const request_id = this.request_key(context, input.request_id);
    const replay = await this.replay(access, input, "create", request_id);
    return replay ?? await this.create_bound(access, input, await bind_memory_sources(context, input, input.source_refs, true, this.host), request_id);
  }
  /** 管理端也先经过相同的 schema 和事务；来源只能由认证路由绑定。 */
  async create_bound(access: MemoryKnowledgeAccess, payload: MemoryRememberInput, sources: MemorySource[], request_id = payload.request_id ?? randomUUID()) {
    const input = memory_remember_schema.parse(payload);
    const replay = await this.replay(access, input, "create", request_id);
    if (replay) return replay;
    const change: MemoryChange = input.kind === "knowledge" ? { operation: "create", kind: input.kind, title: input.title, content: input.content, sources }
      : { operation: "create", kind: input.kind, content: input.content, sources };
    return await this.commit(access, input.scope, change, request_id, this.business_hash(input, "create"));
  }
  /** 完整替换与显式版本校验。 */
  async update(context: PowerContext, access: MemoryKnowledgeAccess, payload: MemoryUpdateInput) {
    const input = memory_update_schema.parse(payload);
    const request_id = this.request_key(context, input.request_id);
    const replay = await this.replay(access, input, "update", request_id);
    return replay ?? await this.update_bound(access, input, await bind_memory_sources(context, input, input.source_refs, true, this.host), request_id);
  }
  /** 管理端不另建文本编辑或 Profile 编辑协议。 */
  async update_bound(access: MemoryKnowledgeAccess, payload: MemoryUpdateInput, sources: MemorySource[], request_id = payload.request_id ?? randomUUID()) {
    const input = memory_update_schema.parse(payload);
    const replay = await this.replay(access, input, "update", request_id);
    if (replay) return replay;
    const current = await this.read_current(access, input.memory_id, input.expected_version);
    validate_memory_content(current.kind, input.content, input.title);
    return await this.commit(access, current.scope.type, { operation: "update", memory_id: input.memory_id,
      expected_version: input.expected_version, content: input.content, ...(input.title !== undefined ? { title: input.title } : {}), sources }, request_id, this.business_hash(input, "update"));
  }
  /** 退出不回显已删除正文。 */
  async forget(context: PowerContext, access: MemoryKnowledgeAccess, payload: MemoryForgetInput) {
    const input = memory_forget_schema.parse(payload);
    const request_id = this.request_key(context, input.request_id);
    const replay = await this.replay(access, input, "forget", request_id);
    return replay ?? await this.forget_bound(access, input, await bind_memory_sources(context, input, input.source_refs, false, this.host), request_id);
  }
  /** 管理入口和普通入口共用墓碑语义。 */
  async forget_bound(access: MemoryKnowledgeAccess, payload: MemoryForgetInput, sources: MemorySource[], request_id = payload.request_id ?? randomUUID()) {
    const input = memory_forget_schema.parse(payload);
    const replay = await this.replay(access, input, "forget", request_id);
    if (replay) return replay;
    const current = await this.read_current(access, input.memory_id, input.expected_version);
    return await this.commit(access, current.scope.type, { operation: input.state === "invalidated" ? "invalidate" : "delete",
      memory_id: input.memory_id, expected_version: input.expected_version, sources }, request_id, this.business_hash(input, "forget"));
  }
  /** 固定公开业务参数，捕获时钟和调用身份不影响同请求重试。 */
  private business_hash(payload: object, operation: string): string {
    const { request_id, ...body } = payload as Record<string, unknown>;
    return memory_hash(canonical_memory_json({ operation, payload: body }));
  }
  /** 先读持久回执再校验当前版本，已删除对象也可重放原删除结果。 */
  private async replay(access: MemoryKnowledgeAccess, payload: object, operation: string, request_id: string) {
    const transactions = this.provider.transactions;
    if (!transactions) throw new Error("MEMORY_TRANSACTIONS_UNAVAILABLE");
    for (const address of resolve_readable_memory_addresses(access)) {
      let receipt;
      try { receipt = await transactions.read_commit_receipt({ access, scope: address.scope.type, commit_id: `request:${request_id}` }); }
      catch (error) { if (String(error).includes("MEMORY_MIGRATION_REQUIRED")) continue; throw error; }
      if (!receipt) continue;
      if (receipt.business_hash !== this.business_hash(payload, operation)) throw new Error("IDEMPOTENCY_CONFLICT");
      return receipt.changes[0]!;
    }
    return undefined;
  }
  /** 来源捕获不改变幂等身份，跨调用重试由调用方复用 request_id。 */
  private request_key(context: PowerContext, request_id?: string): string {
    return request_id ?? `${context.agent.id}:${context.session?.id ?? "host"}:${context.call?.tool_call_id ?? randomUUID()}`;
  }
  /** 后端缺少事务时显式拒绝。 */
  private async commit(access: MemoryKnowledgeAccess, scope: MemoryRememberInput["scope"], change: MemoryChange, request_id: string, business_hash: string) {
    if (!this.provider.capabilities.transactions || !this.provider.transactions) throw new Error("MEMORY_TRANSACTIONS_UNAVAILABLE");
    const receipt = await this.provider.transactions.commit({ access, scope, request_id, commit_id: `request:${request_id}`, business_hash, changes: [change] });
    return receipt.changes[0]!;
  }
}
