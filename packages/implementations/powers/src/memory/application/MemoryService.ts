/** Memory 领域应用服务：普通动作直接提交，语义处理提交 Job，统一检查处理状态的访问范围。 */
import type { PowerContext, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider, MemoryRememberInput, MemoryReviseInput } from "../types/Memory.js";
import type { MemoryAccessContext, MemoryWriteTarget } from "../types/MemoryAccess.js";
import type { MemoryJob, MemoryJobView, MemoryJobDetail, MemoryJobInput } from "../types/MemoryJob.js";
import { memory_job_view } from "../types/MemoryJob.js";
import { MemoryJobStore, memory_job_identity } from "../storage/MemoryJobStore.js";
import { MemoryCoordinator } from "./MemoryCoordinator.js";
import { explicit_memory_source, memory_request_hash, read_memory_sources } from "./MemorySources.js";
import { MemoryDelivery, memory_result_recipient } from "./MemoryDelivery.js";
import { resolve_readable_memory_address } from "../runtime/MemoryAddress.js";

/** Power 唯一持有的记忆业务服务。 */
export class MemoryService {
  constructor(
    /** 确定性存储和查询。 */
    private readonly provider: MemoryProvider,
    /** 持久化内部处理请求。 */
    private readonly jobs: MemoryJobStore,
    /** 执行请求并恢复。 */
    private readonly coordinator: MemoryCoordinator,
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

  /** 显式新增保留原意，不让模型把指令改写成用户原话。 */
  async remember(context: PowerContext, access: MemoryAccessContext, input: Omit<MemoryRememberInput, "access">) {
    const source = explicit_memory_source(context, input.content);
    const receipt = await this.provider.commit({
      access, target: input.target, commit_id: `explicit:${source.source_id}:${input.target}`,
      changes: [{ operation: "create", content: input.content, topic: input.topic, memory_type: input.memory_type,
        allow_recreation: true,
        source_refs: [{ source_id: source.source_id, source_type: "manual", agent_id: source.agent_id,
          category: source.category, session_id: source.session_id, role: "request", label: input.source }],
      }],
    });
    return { target: input.target, mode: "knowledge", status: "created", memory_id: receipt.changes[0]!.memory_id,
      version: receipt.changes[0]!.version, activation: "on_recall", location: "wiki" };
  }

  /** 原始会话按分类和消息边界指定；不把末尾文本直接归档成长期知识。 */
  async digest(context: PowerContext, access: MemoryAccessContext, input: {
    /** 指定来源会话。 */ session_id: string;
    /** 来源物理分类。 */ category: string;
    /** 本次来源消息预算。 */ max_messages: number;
    /** 唯一写入目标。 */ target: MemoryWriteTarget;
  }): Promise<MemoryJobView> {
    const sources = await read_memory_sources(context, this.host, input.session_id, input.category, input.max_messages);
    return await this.submit(context, {
      kind: "digest", access, target: input.target, mode: "knowledge", sources,
      instruction: "Extract supported durable decisions, reasons, constraints and reusable knowledge. Do not store transient task status or assistant proposals as accepted decisions.",
      request_key: memory_request_hash(["digest-v1", input.session_id, input.category, sources]),
    });
  }

  /** 自然语言更正必须经专用 Session，既有内容不会被追加一段修改指令。 */
  async revise(context: PowerContext, access: MemoryAccessContext, input: Omit<MemoryReviseInput, "access">): Promise<MemoryJobView> {
    const address = resolve_readable_memory_address(access, input.memory_id);
    const target: MemoryWriteTarget = address.subject.kind === "workspace" ? "current_workspace" : address.subject.kind === "user" ? "user" : "agent";
    if (address.subject.kind === "city") throw new Error("City legacy memories must be imported before revision");
    const current = await this.provider.read({ access, memory_id: input.memory_id });
    if (!current.memory) throw new Error("Memory not found");
    const source = explicit_memory_source(context, JSON.stringify({ instruction: input.instruction, evidence: input.evidence }));
    return await this.submit(context, {
      kind: "revise", access, target, mode: "knowledge", memory_id: input.memory_id, sources: [source],
      instruction: input.instruction,
      request_key: memory_request_hash([source.source_id, input.memory_id, current.memory.version]),
    });
  }

  /** 显式请求整理当前核心记忆，来源固定为本次读取的 Profile 版本。 */
  async optimize_profile(context: PowerContext, access: MemoryAccessContext, target: "user" | "agent", profile: { content: string; version: string }): Promise<MemoryJobView> {
    if (!profile.content.trim()) throw new Error("Profile is empty");
    const source = { source_id: `profile:${memory_request_hash([target, target === "agent" ? access.agent_id : "user", profile.version])}`,
      agent_id: access.agent_id, category: "work", role: "request" as const, text: profile.content };
    return await this.submit(context, {
      kind: "profile_optimize", access, target, mode: "profile", sources: [source],
      instruction: "Consolidate duplicates and apply explicit corrections already present. Preserve all still-applicable agreements, conditions, negations, uncertainty, and source markers. Do not infer new preferences. Use exact nonoverlapping edits; skip if no safe improvement exists.",
      request_key: memory_request_hash(["profile-optimize-v1", target, profile.version]),
    });
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
