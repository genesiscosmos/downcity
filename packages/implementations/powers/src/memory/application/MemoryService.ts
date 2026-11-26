/** Memory 领域应用服务：普通动作直接提交，语义处理提交 Job，统一检查处理状态的访问范围。 */
import type { PowerContext, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider, MemoryDigestInput, MemoryKind, MemoryScopeType, MemoryReviseInput } from "../types/MemoryProtocol.js";
import type { MemoryAccessContext } from "../types/MemoryAccess.js";
import type { MemoryJob, MemoryJobView, MemoryJobDetail, MemoryJobInput } from "../types/MemoryJob.js";
import { memory_job_view } from "../types/MemoryJob.js";
import { MemoryJobStore, memory_job_identity } from "../storage/MemoryJobStore.js";
import { MemoryCoordinator } from "./MemoryCoordinator.js";
import { memory_request_hash, read_memory_sources } from "./MemorySources.js";
import { MemoryDelivery, memory_result_recipient } from "./MemoryDelivery.js";
import { require_memory_transactions } from "./MemoryKnowledge.js";

import { MemoryRecords } from "./MemoryRecords.js";
import { bind_memory_sources } from "./MemorySourceBinding.js";

/** Power 唯一持有的记忆业务服务。 */
export class MemoryService {
  constructor(
    /** 确定性存储和查询。 */
    private readonly provider: MemoryProvider,
    /** 持久化内部处理请求。 */
    private readonly jobs: MemoryJobStore,
    /** 执行请求并恢复。 */
    private readonly coordinator: Pick<MemoryCoordinator, "submit" | "retry">,
    /** 有界来源读取由宿主校验真实 Session 身份。 */
    private readonly host: PowerLifecycleContext,
    /** 接收身份由调用方绑定，处理完成后可靠回传。 */
    private readonly delivery: MemoryDelivery,
  ) {}

  /** 在启动计算前保存调用方订阅；崩溃后不依赖内存恢复接收身份。 */
  private async submit(context: PowerContext, input: MemoryJobInput): Promise<MemoryJobView> {
    await this.delivery.subscribe(memory_job_identity(input), memory_result_recipient(context));
    return memory_job_view(await this.coordinator.submit(input));
  }

  /** 从明确 canonical 窗口提炼一种内容。 */
  async digest(context: PowerContext, access: MemoryAccessContext, input: MemoryDigestInput): Promise<MemoryJobView> {
    if (input.scope === "workspace" && input.kind === "agreement") throw new Error("Workspace supports Knowledge only");
    const sources = await read_memory_sources(context, this.host, input.session_id, input.type, input.max_messages ?? 30);
    return await this.submit(context, { kind: "digest", access, scope: input.scope, memory_kind: input.kind, sources,
      instruction: "Extract only supported durable information of the bound kind. Preserve observations, conditions, evidence and limitations. An explicit user agreement requires original user evidence.",
      request_key: memory_request_hash(["digest-records-v2", input, sources.map(source => source.source_id)]) });
  }
  /** revise 固定原对象、版本、来源、范围和种类。 */
  async revise(context: PowerContext, access: MemoryAccessContext, input: Omit<MemoryReviseInput, "access">): Promise<MemoryJobView> {
    const current = await new MemoryRecords(this.provider).read_current(access, input.memory_id, input.expected_version);
    const sources = await bind_memory_sources(context, input, input.source_refs, true, this.host);
    return await this.submit(context, { kind: "revise", access, scope: current.scope.type, memory_kind: current.kind,
      memory_id: current.memory_id, expected_version: current.version, sources: sources.map(source => ({ source_id: source.source_id,
        agent_id: access.agent_id, category: context.session?.type ?? "request", session_id: context.session?.id,
        role: source.role, text: source.excerpt ?? JSON.stringify(input), bound_source: source })),
      instruction: input.instruction, request_key: memory_request_hash(["revise-records-v2", input, current.version]) });
  }
  /** 明确整理同 scope 的一种内容，旧对象只用于去重及保留来源，不能成为新独立证据。 */
  async optimize(context: PowerContext, access: MemoryAccessContext, input: { scope: MemoryScopeType; kind: MemoryKind }): Promise<MemoryJobView> {
    if (input.scope === "workspace" && input.kind === "agreement") throw new Error("Workspace supports Knowledge only");
    const transactions = require_memory_transactions(this.provider);
    const before = await transactions.read_version({ access, scope: input.scope });
    const sources: import("../types/MemoryJob.js").MemoryJobSource[] = [];
    const inventory: { memory_id: string; version: string }[] = [];
    for (let offset = 0;;) {
      const page = await this.provider.list({ access, scope: input.scope, kind: input.kind, limit: 500, offset });
      for (const record of page.items) inventory.push({ memory_id: record.memory_id, version: record.version });
      if (inventory.length > 500) throw new Error("OPTIMIZE_BUDGET_EXCEEDED: select an explicitly bounded consolidation workflow");
      for (const record of page.items) for (const source of record.sources) {
        if (!source.excerpt || sources.some(item => item.source_id === source.source_id)) continue;
        sources.push({ source_id: source.source_id, agent_id: access.agent_id, category: "existing_source", role: source.role, text: source.excerpt, bound_source: source });
      }
      offset += page.items.length;
      if (offset >= page.total) break;
      if (!page.items.length) throw new Error("Incomplete scope read");
    }
    if (!sources.length) throw new Error("No retained original sources available for safe consolidation");
    const after = await transactions.read_version({ access, scope: input.scope });
    if (before.scope_version !== after.scope_version) throw new Error("VERSION_CONFLICT");
    return await this.submit(context, { kind: "optimize", access, scope: input.scope, memory_kind: input.kind, sources, inventory, input_scope_version: before.scope_version,
      instruction: "Preserve every still-applicable condition, negation and authorization limit. Read all objects before merging; invalidate merged originals in the same transaction. Existing records are not independent new evidence. Do not infer new preferences or move scope/kind.",
      request_key: memory_request_hash(["optimize-records-v2", input, before.scope_version]) });
  }

  /** 内部请求不会因同属 City 就向所有 Agent 公开。 */
  private assert_access(job: MemoryJob, access: MemoryAccessContext): void {
    if (job.access.agent_id !== access.agent_id || job.access.workspace_id !== access.workspace_id) {
      throw new Error("Memory Job is outside the current execution context");
    }
  }

  /** 读取不含来源正文的当前状态。 */
  async job_status(access: MemoryAccessContext, job_id: string): Promise<MemoryJobView> {
    const job = await this.jobs.read(job_id);
    if (!job) throw new Error("Memory Job not found");
    this.assert_access(job, access);
    return memory_job_view(job);
  }

  /** 详情按与状态相同的权限读取，只有这里返回固定差异和原文依据。 */
  async job_detail(access: MemoryAccessContext, job_id: string): Promise<MemoryJobDetail> {
    const job = await this.jobs.read(job_id);
    if (!job) throw new Error("Memory Job not found");
    this.assert_access(job, access);
    return { job: memory_job_view(job), changes: job.change_details ?? [] };
  }

  /** 按当前 Agent/Workspace 查询处理记录，分页返回。 */
  async list_jobs(access: MemoryAccessContext, limit = 30, offset = 0): Promise<{ items: MemoryJobView[]; total: number }> {
    const jobs = (await this.jobs.list()).filter((job) => job.access.agent_id === access.agent_id && job.access.workspace_id === access.workspace_id);
    const page_limit = Math.max(1, Math.min(100, Math.floor(limit)));
    const page_offset = Math.max(0, Math.floor(offset));
    return { items: jobs.slice(page_offset, page_offset + page_limit).map(memory_job_view), total: jobs.length };
  }

  /** 重试操作不会扩大原请求范围或修改原始来源。 */
  async retry(access: MemoryAccessContext, job_id: string, context?: PowerContext): Promise<MemoryJobView> {
    const job = await this.jobs.read(job_id);
    if (!job) throw new Error("Memory Job not found");
    this.assert_access(job, access);
    if (job.kind === "dream") throw new Error("Retry automatic batches from Memory background management; scope budget and cooldown apply");
    if (context) await this.delivery.subscribe(job_id, memory_result_recipient(context));
    const updated = await this.coordinator.retry(job);
    return memory_job_view(updated);
  }
}
