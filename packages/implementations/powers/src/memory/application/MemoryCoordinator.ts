/** Memory 处理编排：持久化请求、受限 Session 计算、幂等提交；模型最终文字不代表记忆已保存。 */
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider } from "../types/Memory.js";
import type { MemoryJob, MemoryJobInput } from "../types/MemoryJob.js";
import { MEMORY_SESSION_KIND } from "../types/MemorySession.js";
import { MemoryJobStore } from "../storage/MemoryJobStore.js";
import { MemoryProfile } from "../runtime/MemoryProfile.js";
import type { ProfileScope } from "../types/Profile.js";
import { register_memory_session_profile } from "../runtime/MemorySession.js";

/** 处理生命周期的受限依赖。 */
export interface MemoryCoordinatorOptions {
  /** City 可信生命周期端口。 */
  host: PowerLifecycleContext;
  /** 确定性记忆提交与查询。 */
  provider: MemoryProvider;
  /** 核心记忆文件管理。 */
  profile: MemoryProfile;
  /** 本 Power 的内部处理账本。 */
  jobs: MemoryJobStore;
  /** 可选的专用模型选择，创建后由 Session 固定实际身份。 */
  model_id?: string;
}

/** 将已绑定的 Job 目标转换为核心记忆范围。 */
export function memory_job_profile_scope(job: MemoryJob): ProfileScope {
  if (job.target === "current_workspace") throw new Error("Workspace does not support Profile mode");
  return job.target === "user" ? { target: "user" } : { target: "agent", agent_id: job.access.agent_id };
}

/** 每个 Power 实例单路计算，提交仍由 Provider 检查跨实例并发。 */
export class MemoryCoordinator {
  /** 正在执行的队列；失败不会阻塞后续 Job。 */
  private chain: Promise<void> = Promise.resolve();
  /** 已入队标识，防止重复唤醒。 */
  private readonly scheduled = new Set<string>();
  /** 关闭后禁止开始新计算。 */
  private stopped = false;
  /** 撤销可信执行配置注册。 */
  private unregister?: () => void;

  constructor(private readonly options: MemoryCoordinatorOptions) {}

  /** 注册专用 Session 配置，恢复未完成的持久化请求。 */
  async initialize(): Promise<void> {
    await this.options.jobs.initialize();
    this.unregister = register_memory_session_profile(this.options.host, {
      jobs: this.options.jobs, provider: this.options.provider,
      read_profile: async (job) => await this.options.profile.read(memory_job_profile_scope(job)),
    });
    for (const job of await this.options.jobs.list()) {
      if (["queued", "running", "committing", "retry_wait"].includes(job.status)) this.schedule(job.job_id);
    }
  }

  /** 先保存请求再调度；调用方得到的是 accepted，而非 saved。 */
  async submit(input: MemoryJobInput): Promise<MemoryJob> {
    if (this.stopped) throw new Error("Memory Coordinator is stopping");
    const job = await this.options.jobs.create(input);
    if (["queued", "retry_wait"].includes(job.status)) this.schedule(job.job_id);
    return job;
  }

  /** 人工重试失败请求，保留原身份与证据。 */
  async retry(job: MemoryJob): Promise<MemoryJob> {
    if (job.status !== "failed") throw new Error("Only failed Memory Jobs can be retried");
    const committed = job.mode === "profile"
      ? await this.options.profile.read_mutation_receipt(memory_job_profile_scope(job), `job:${job.job_id}`)
      : await this.options.provider.read_commit_receipt({ access: job.access, target: job.target, commit_id: `job:${job.job_id}` });
    const updated = await this.options.jobs.update(job.job_id, {
      status: committed ? "committing" : "queued",
      ...(committed ? {} : { session_id: undefined, turn_id: undefined, changes: undefined, scope_version: undefined, profile_edits: undefined, profile_version: undefined }),
      skip_reason: undefined, error: undefined,
    });
    this.schedule(job.job_id);
    return updated;
  }

  /** 不轮询运行目录；每个请求由串行任务完成或留下明确失败。 */
  private schedule(job_id: string): void {
    if (this.stopped || this.scheduled.has(job_id)) return;
    this.scheduled.add(job_id);
    this.chain = this.chain.catch((error) => {
      this.options.host.logger.error("Memory queue recovered after persistence failure", { error: String(error) });
    }).then(async () => {
      if (this.stopped) return;
      try {
        await this.options.jobs.with_execution(job_id, async () => {
          try { await this.execute(job_id); }
          catch (error) {
            await this.options.jobs.update(job_id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
            this.options.host.logger.warn("Memory Job failed", { job_id, error: String(error) });
          }
        });
      } catch (error) {
        this.options.host.logger.warn("Memory Job is owned by another local worker or storage is unavailable", { job_id, error: String(error) });
      }
    }).finally(() => { this.scheduled.delete(job_id); });
  }

  /** 从持久化身份恢复尝试，只有终态和有效暂存结果都齐全才进入提交。 */
  private async execute(job_id: string): Promise<void> {
    let job = await this.options.jobs.read(job_id);
    if (!job || ["succeeded", "skipped"].includes(job.status)) return;
    if (job.status === "committing") { await this.commit(job); return; }
    if (job.attempt >= 3 && !job.session_id) throw new Error("Memory Job attempt budget exhausted");
    const { host } = this.options;
    if (!job.session_id) {
      const attempt = job.attempt + 1;
      const session = await host.system.create_agent_session({
        agent_id: job.access.agent_id, workspace_id: job.access.workspace_id, inherit_workspace: false,
        execution_profile_id: "memory", execution_profile_version: 1, model_id: this.options.model_id,
        creation_key: `memory:${job.job_id}:${attempt}`,
        origin: { category: "work", type: MEMORY_SESSION_KIND, memory_job_id: job.job_id, memory_attempt: attempt },
      });
      job = await this.options.jobs.update(job.job_id, { status: "running", attempt, session_id: session.session_id });
    }
    if (job.mode === "knowledge" && job.scope_version === undefined) {
      const version = await this.options.provider.read_version({ access: job.access, target: job.target });
      job = await this.options.jobs.update(job.job_id, { scope_version: version.scope_version });
    }
    const session_id = job.session_id!;
    const request_id = `memory:${job.job_id}:${job.attempt}`;
    let state = await host.system.read_agent_session({
      agent_id: job.access.agent_id, category: "work", session_id, request_id,
    });
    if (state.status === "running") {
      const deadline = Date.now() + 120_000;
      while (state.status === "running" && Date.now() < deadline && !this.stopped) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        state = await host.system.read_agent_session({ agent_id: job.access.agent_id, category: "work", session_id, request_id });
      }
      if (state.status === "running") {
        await host.system.stop_agent_session({ agent_id: job.access.agent_id, category: "work", session_id });
        throw new Error("Memory Session exceeded the recovery processing budget");
      }
    }
    if (state.status === "interrupted") throw new Error("Memory Session was interrupted; retry starts a new bounded attempt");
    if (state.status === "completed") {
      if (!state.result?.success) throw new Error(state.result?.error ?? "Memory Session failed");
    } else {
      const turn = await host.system.prompt_agent_session({
        agent_id: job.access.agent_id, session_id, category: "work", request_id,
        actor: { kind: "runtime", namespace: "memory", object_id: job.job_id },
        query: "Process the bound Memory Job using memory_sources. Stage supported changes or explicitly skip; the host alone commits.",
      });
      await this.options.jobs.update(job.job_id, { turn_id: turn.turn_id });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          turn.finished,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Memory Session exceeded the 120 second processing budget")), 120_000); }),
        ]);
        if (!result.success) throw new Error(result.error ?? "Memory Session failed");
      } catch (error) {
        await host.system.stop_agent_session({ agent_id: job.access.agent_id, category: "work", session_id, turn_id: turn.turn_id });
        throw error;
      } finally { if (timer) clearTimeout(timer); }
    }
    job = await this.options.jobs.read(job.job_id);
    if (!job) throw new Error("Memory Job disappeared");
    if (job.skip_reason) { await this.options.jobs.update(job.job_id, { status: "skipped" }); return; }
    if (!job.changes?.length && !job.profile_edits?.edits.length) throw new Error("Memory Session completed without a staged outcome");
    job = await this.options.jobs.update(job.job_id, { status: "committing" });
    await this.commit(job);
  }

  /** 回执与记忆原子发布；Job 状态丢失时可以用相同键重读。 */
  private async commit(job: MemoryJob): Promise<void> {
    const commit_id = `job:${job.job_id}`;
    if (job.mode === "profile") {
      const scope = memory_job_profile_scope(job);
      const existing = await this.options.profile.read_mutation_receipt(scope, commit_id);
      if (!existing) {
        if (!job.profile_version || !job.profile_edits?.edits.length) throw new Error("Profile change set was not staged");
        await this.options.profile.edit(scope, job.profile_version, job.profile_edits.edits, {
          source_key: commit_id, source_refs: job.profile_edits.source_ids,
        });
      }
      await this.options.jobs.update(job.job_id, { status: "succeeded", memory_ids: [], error: undefined });
      return;
    }
    const scope = { access: job.access, target: job.target };
    const existing = await this.options.provider.read_commit_receipt({ ...scope, commit_id });
    const receipt = existing ?? await this.options.provider.commit({
      ...scope, commit_id, expected_scope_version: job.scope_version,
      changes: (job.changes ?? []).map((change) => ({
        operation: change.operation, memory_id: change.memory_id, expected_version: change.expected_version,
        content: change.content, topic: change.topic, memory_type: change.memory_type,
        source_refs: change.source_ids.map((source_id) => {
          const source = job.sources.find((item) => item.source_id === source_id);
          if (!source) throw new Error("Staged source is not permitted by this Job");
          return { ...source, source_type: source.role === "request" ? "manual" : "session", excerpt: undefined };
        }).map(({ text: _text, ...source }) => source),
      })),
    });
    await this.options.jobs.update(job.job_id, {
      status: "succeeded", memory_ids: receipt.changes.map((change) => change.memory_id), error: undefined,
    });
  }

  /** 停止新调度，等待当前有界计算后释放执行配置。 */
  async dispose(): Promise<void> {
    this.stopped = true;
    await this.chain;
    this.unregister?.();
    await this.options.jobs.dispose();
  }
}
