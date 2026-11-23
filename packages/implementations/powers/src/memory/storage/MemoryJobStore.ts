/** Memory Job 文件账本：串行读改写、稳定请求键与有界来源，正文不进入普通状态接口。 */
import { is_model_reference } from "@downcity/type";
import { createHash } from "node:crypto";
import path from "node:path";
import { with_memory_scope_lock } from "./MemoryScopeLock.js";
import { FileMemoryStorageAdapter } from "../adapters/FileMemoryStorageAdapter.js";
import type { MemoryJob, MemoryJobInput } from "../types/MemoryJob.js";

/** 在写入之前计算请求身份，允许先持久化完成反馈订阅以封闭崩溃窗口。 */
export function memory_job_identity(input: MemoryJobInput): string {
  return createHash("sha256").update(JSON.stringify([
    input.access.agent_id, input.access.workspace_id, input.target, input.mode, input.kind, input.request_key,
  ])).digest("hex");
}

/** 一个 Memory Power 生命周期持有的内部处理账本。 */
export class MemoryJobStore {
  /** 仅封装本 Power 的处理记录目录。 */
  private readonly storage: FileMemoryStorageAdapter;
  /** 防止同一实例内读改写互相覆盖。 */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly root_path: string) {
    this.storage = new FileMemoryStorageAdapter({ root_path });
  }

  /** 初始化独立账本。 */
  async initialize(): Promise<void> { await this.storage.initialize(); }

  /** 校验并解析固定格式的 Job 地址。 */
  private key(job_id: string): string {
    if (!/^[a-f0-9]{64}$/u.test(job_id)) throw new Error("Invalid Memory Job ID");
    return `jobs/${job_id}.json`;
  }

  /** 以请求范围和请求键收敛重复提交。 */
  async create(input: MemoryJobInput): Promise<MemoryJob> {
    if (!input.sources.length || input.sources.length > 100) throw new Error("Memory Job requires 1–100 sources");
    if (input.sources.reduce((count, source) => count + source.text.length, 0) > 64_000) throw new Error("Memory Job source budget exceeded");
    const job_id = memory_job_identity(input);
    return await this.serial(async () => {
      const existing = await this.read(job_id);
      if (existing) {
        const fingerprint = (value: MemoryJobInput) => JSON.stringify({ kind: value.kind, instruction: value.instruction,
          access: { agent_id: value.access.agent_id, workspace_id: value.access.workspace_id }, target: value.target, mode: value.mode, sources: value.sources, memory_id: value.memory_id });
        if (fingerprint(existing) !== fingerprint(input)) throw new Error("Memory request key reused with different input");
        return existing;
      }
      const now = new Date().toISOString();
      if (input.model !== undefined && !is_model_reference(input.model)) throw new Error("Invalid Memory Job model");
      if (input.binding_id !== undefined && (typeof input.binding_id !== "string" || !input.binding_id.trim())) throw new Error("Invalid Memory Job binding_id");
      const configured = Boolean(input.model && input.binding_id);
      const job: MemoryJob = { ...input, job_id, status: configured ? "queued" : "failed", attempt: 0, created_at: now, updated_at: now,
        ...(!configured ? { error: "memory_model_configuration_required: explicitly select a model and durable authorization binding before submitting a new Job" } : {}) };
      await this.storage.write(this.key(job_id), JSON.stringify(job));
      return job;
    });
  }

  /** 精确读取内部记录；公开入口必须另行检查访问范围。 */
  async read(job_id: string): Promise<MemoryJob | null> {
    const content = await this.storage.read(this.key(job_id));
    return content ? JSON.parse(content) as MemoryJob : null;
  }

  /** 原子替换一个已存在 Job，身份与来源不能经此路径改写。 */
  async update(job_id: string, change: Partial<Pick<MemoryJob,
    "status" | "attempt" | "session_id" | "turn_id" | "scope_version" | "changes" | "change_details" | "profile_version" | "profile_edits" | "skip_reason" | "memory_ids" | "error"
  >>): Promise<MemoryJob> {
    return await this.serial(async () => {
      const job = await this.read(job_id);
      if (!job) throw new Error("Memory Job not found");
      const updated = { ...job, ...change, updated_at: new Date().toISOString() };
      await this.storage.write(this.key(job_id), JSON.stringify(updated));
      return updated;
    });
  }

  /** 在同一账本锁内检查执行身份并暂存唯一结果，拒绝并行工具互相覆盖。 */
  async stage(job_id: string, session_id: string, outcome: Pick<MemoryJob, "changes" | "change_details" | "profile_version" | "profile_edits" | "skip_reason">): Promise<void> {
    await this.serial(async () => {
      const job = await this.read(job_id);
      if (!job || job.session_id !== session_id || job.status !== "running") throw new Error("Memory Job is no longer running in this Session");
      if (job.changes || job.profile_edits || job.skip_reason) throw new Error("Memory Job already has a staged outcome");
      await this.storage.write(this.key(job_id), JSON.stringify({ ...job, ...outcome, updated_at: new Date().toISOString() }));
    });
  }

  /** 扫描持久化状态，供恢复及经过范围过滤的管理入口使用。 */
  async list(): Promise<MemoryJob[]> {
    return (await this.storage.list("jobs")).map((entry) => JSON.parse(entry.content) as MemoryJob)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  /** 同一 Job 在多个本机 City 实例中只允许一个计算者；账本写锁使用独立目录。 */
  async with_execution<T>(job_id: string, run: () => Promise<T>): Promise<T> {
    this.key(job_id);
    return await with_memory_scope_lock(path.join(this.root_path, "executions", job_id), run);
  }

  /** 等待正在提交的内部状态写入。 */
  async dispose(): Promise<void> { await this.chain; await this.storage.dispose(); }

  /** 保证本实例的创建、修改操作顺序。 */
  private async serial<T>(run: () => Promise<T>): Promise<T> {
    const current = this.chain.catch(() => undefined).then(() => with_memory_scope_lock(this.root_path, run));
    this.chain = current.catch(() => undefined);
    return await current;
  }
}
