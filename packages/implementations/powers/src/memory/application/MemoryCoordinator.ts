/** Memory 处理编排：持久化请求、受限 Session 计算、幂等提交；模型最终文字不代表记忆已保存。 */
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider } from "../types/Memory.js";
import type { MemoryJob, MemoryJobInput } from "../types/MemoryJob.js";
import { MEMORY_SESSION_KIND } from "../types/MemorySession.js";
import { MemoryJobStore, memory_job_identity } from "../storage/MemoryJobStore.js";
import { require_memory_model } from "./MemoryModelBinding.js";
import type { MemoryModelResolver } from "../types/MemoryModelBinding.js";
import type { MemoryProfile } from "../runtime/MemoryProfile.js";
import { require_memory_transactions } from "./MemoryKnowledge.js";
import type { ProfileScope } from "../types/Profile.js";
import { register_memory_session_profile, MEMORY_SESSION_PROFILE_VERSION } from "../runtime/MemorySession.js";

/** 处理生命周期的受限依赖。 */
export interface MemoryCoordinatorOptions {
  /** City 可信生命周期端口。 */
  host: PowerLifecycleContext;
  /** 确定性记忆提交与查询。 */
  provider: MemoryProvider;
  /** 核心记忆文件管理。 */
  profile: Pick<MemoryProfile, "read" | "edit" | "read_mutation_receipt">;
  /** 本 Power 的内部处理账本。 */
  jobs: MemoryJobStore;
  /** 可选的专用模型选择，创建后由 Session 固定实际身份。 */
  model_id?: string;
  /** 配置明确确认的授权来源；只用于新 Job，不能更新已保存的 Job。 */
  binding_id?: string;
  /** 提交时读取所属 Agent 默认模型或专用模型；缺省且配置不完整时保持需要配置。 */
  resolve_model_binding?: MemoryModelResolver;
  /** 自动 Job 每次开始前核对持久开关；普通显式请求不受影响。 */
  can_run_background?: (job: MemoryJob) => Promise<boolean>;
}

/** 将已绑定的 Job 目标转换为核心记忆范围。 */
export function memory_job_profile_scope(job: MemoryJob): ProfileScope {
  if (job.target === "current_workspace") throw new Error("Workspace does not support Profile mode");
  return job.target === "user" ? { target: "user" } : { target: "agent", agent_id: job.access.agent_id };
}

/** 每个 Power 实例单路计算，提交仍由 Provider 检查跨实例并发。 */
export class MemoryCoordinator {
  /** 当前单路消费者的生命周期，关闭时等待有界工作收口。 */
  private chain: Promise<void> = Promise.resolve();
  /** 持久 Job 的待运行集合，值表示是否为低优先级后台工作。 */
  private readonly pending = new Map<string, boolean>();
  /** 是否已经安排消费者，防止同一实例并行启动多个模型。 */
  private draining = false;
  /** 正在运行的 Job 是否属于显式请求。 */
  private active_explicit = false;

  /** 后台规划前检查显式请求压力，不从聊天或 CPU 猜测用户是否空闲。 */
  get has_explicit_work(): boolean { return this.active_explicit || [...this.pending.values()].some((background) => !background); }

  /** 单路模型消费者是否繁忙，避免后台预先积攒多批计算。 */
  get has_work(): boolean { return this.draining || this.pending.size > 0; }
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
      if (job.kind !== "dream" && ["queued", "running", "committing", "retry_wait"].includes(job.status)) this.schedule(job.job_id, false);
    }
  }

  /** 先保存请求再调度；调用方得到的是 accepted，而非 saved。 */
  async submit(input: MemoryJobInput): Promise<MemoryJob> {
    if (this.stopped) throw new Error("Memory Coordinator is stopping");
    if (input.kind === "dream" && (input.mode !== "knowledge" || input.target === "user")) throw new Error("Automatic memory only supports Agent/Workspace knowledge");
    if (input.mode === "knowledge") require_memory_transactions(this.options.provider);
    // 幂等重送不重新选择账号；同 request key 的既有 Job 永远保留提交时基线。
    const existing = await this.options.jobs.read(memory_job_identity(input));
    const configured = input.model_id !== undefined || input.binding_id !== undefined
      ? input : this.options.model_id && this.options.binding_id
        ? { model_id: this.options.model_id, binding_id: this.options.binding_id }
        : !existing ? await this.options.resolve_model_binding?.(input.access, this.options.model_id) : undefined;
    if (!existing && this.options.model_id !== undefined && input.model_id === undefined
      && configured?.model_id !== undefined && configured.model_id !== this.options.model_id) {
      throw new Error("memory_model_configuration_required: host resolved a different configured model");
    }
    const baseline = existing ? { model_id: existing.model_id, binding_id: existing.binding_id } : configured;
    const job = await this.options.jobs.create({ ...input, model_id: baseline?.model_id, binding_id: baseline?.binding_id });
    if (["queued", "retry_wait", "running", "committing"].includes(job.status)) this.schedule(job.job_id, job.kind === "dream");
    return job;
  }

  /** 即使自动开关关闭，也可根据已有提交回执补齐终态；此路径绝不发起新提交。 */
  async reconcile_committed(job: MemoryJob): Promise<MemoryJob> {
    if (job.mode !== "knowledge" || job.status === "skipped") return job;
    const receipt = await require_memory_transactions(this.options.provider).read_commit_receipt({ access: job.access, target: job.target, commit_id: `job:${job.job_id}` });
    if (!receipt && job.status === "succeeded") throw new Error("Memory succeeded Job has no matching commit receipt");
    if (!receipt || job.status === "succeeded") return job;
    await this.commit(job);
    return (await this.options.jobs.read(job.job_id))!;
  }

  /** 人工重试失败请求，保留原身份与证据。 */
  async retry(job: MemoryJob): Promise<MemoryJob> {
    if (job.status !== "failed") throw new Error("Only failed Memory Jobs can be retried");
    const committed = job.mode === "profile"
      ? await this.options.profile.read_mutation_receipt(memory_job_profile_scope(job), `job:${job.job_id}`)
      : await require_memory_transactions(this.options.provider).read_commit_receipt({ access: job.access, target: job.target, commit_id: `job:${job.job_id}` });
    if (!committed) require_memory_model(job);
    const updated = await this.options.jobs.update(job.job_id, {
      status: committed ? "committing" : "queued",
      ...(committed ? {} : { session_id: undefined, turn_id: undefined, changes: undefined, change_details: undefined, scope_version: undefined, profile_edits: undefined, profile_version: undefined }),
      skip_reason: undefined, error: undefined,
    });
    this.schedule(job.job_id, job.kind === "dream");
    return updated;
  }

  /** 每个 Job 边界优先取显式请求；已经进入的计算或原子提交保持有界完成。 */
  private schedule(job_id: string, background: boolean): void {
    if (this.stopped || this.scheduled.has(job_id)) return;
    this.scheduled.add(job_id);
    this.pending.set(job_id, background);
    this.start_queue();
  }

  /** 合并唤醒，并封闭消费者退出与新请求到达之间的微任务窗口。 */
  private start_queue(): void {
    if (this.draining || this.stopped || !this.pending.size) return;
    this.draining = true;
    this.chain = Promise.resolve().then(async () => {
      while (!this.stopped && this.pending.size) {
        const [next_id, is_background] = [...this.pending.entries()].find(([, value]) => !value) ?? this.pending.entries().next().value!;
        this.pending.delete(next_id);
        this.active_explicit = !is_background;
        try {
          await this.options.jobs.with_execution(next_id, async () => {
            const job = await this.options.jobs.read(next_id);
            if (!job || (is_background && !await this.options.can_run_background?.(job))) return;
            try { await this.execute(next_id); }
            catch (error) {
              await this.options.jobs.update(next_id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
              this.options.host.logger.warn("Memory Job failed", { job_id: next_id, error: String(error) });
            }
          });
        } catch (error) {
          this.options.host.logger.warn("Memory Job execution or persistence unavailable", { job_id: next_id, error: String(error) });
        } finally { this.scheduled.delete(next_id); this.active_explicit = false; }
      }
    }).finally(() => {
      this.draining = false;
      if (!this.stopped && this.pending.size) this.start_queue();
    });
  }

  /** 从持久化身份恢复尝试，只有终态和有效暂存结果都齐全才进入提交。 */
  private async execute(job_id: string): Promise<void> {
    let job = await this.options.jobs.read(job_id);
    if (!job || ["succeeded", "skipped"].includes(job.status)) return;
    // 自动批次可能从已固定输入补回丢失的 Job 文件；先核对原提交，避免再次计算。
    if (job.kind === "dream") {
      job = await this.reconcile_committed(job);
      if (job.status === "succeeded") return;
    }
    if (job.status === "committing") { await this.commit(job); return; }
    if (job.attempt >= 3 && !job.session_id) throw new Error("Memory Job attempt budget exhausted");
    const { host } = this.options;
    // 每次执行和跨 attempt 都只校验 Job 自有基线；提交回执修复可在上方无模型完成。
    const baseline = require_memory_model(job);
    const model = this.options.host.town?.models.client(baseline.model_id, { binding_id: baseline.binding_id });
    if (!model || model.id !== baseline.model_id || model.binding_id !== baseline.binding_id) {
      throw Object.assign(new Error("Memory Job model authorization is unavailable or changed"), { code: "memory_model_binding_changed" });
    }
    if (!job.session_id) {
      const attempt = job.attempt + 1;
      const session = await host.system.create_agent_session({
        agent_id: job.access.agent_id, workspace_id: job.access.workspace_id, inherit_workspace: false,
        execution_profile_id: "memory", execution_profile_version: MEMORY_SESSION_PROFILE_VERSION, model_id: baseline.model_id, binding_id: baseline.binding_id,
        creation_key: `memory:${job.job_id}:${attempt}`,
        type: "work", kind: MEMORY_SESSION_KIND,
      });
      job = await this.options.jobs.update(job.job_id, { status: "running", attempt, session_id: session.session_id });
    }
    if (job.mode === "knowledge" && job.scope_version === undefined) {
      const version = await require_memory_transactions(this.options.provider).read_version({ access: job.access, target: job.target });
      job = await this.options.jobs.update(job.job_id, { scope_version: version.scope_version });
    }
    const session_id = job.session_id!;
    const request_id = `memory:${job.job_id}:${job.attempt}`;
    let state = await host.system.read_agent_session({
      agent_id: job.access.agent_id, type: "work", session_id, request_id,
    });
    if (state.execution_profile?.model_id !== baseline.model_id || state.execution_profile.binding_id !== baseline.binding_id) {
      throw Object.assign(new Error("Memory Session identity does not match the persisted Job baseline"), { code: "memory_model_binding_changed" });
    }
    if (state.status === "running") {
      const deadline = Date.now() + 120_000;
      while (state.status === "running" && Date.now() < deadline && !this.stopped) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        state = await host.system.read_agent_session({ agent_id: job.access.agent_id, type: "work", session_id, request_id });
      }
      if (state.status === "running") {
        await host.system.stop_agent_session({ agent_id: job.access.agent_id, type: "work", session_id });
        throw new Error("Memory Session exceeded the recovery processing budget");
      }
    }
    if (state.status === "interrupted") throw new Error("Memory Session was interrupted; retry starts a new bounded attempt");
    if (state.status === "completed") {
      if (!state.result?.success) throw new Error(state.result?.error ?? "Memory Session failed");
    } else {
      const turn = await host.system.prompt_agent_session({
        agent_id: job.access.agent_id, session_id, type: "work", request_id,
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
        await host.system.stop_agent_session({ agent_id: job.access.agent_id, type: "work", session_id, turn_id: turn.turn_id });
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
    if (job.kind === "dream" && (job.mode !== "knowledge" || job.target === "user")) throw new Error("Invalid automatic memory target");
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
    const existing = await require_memory_transactions(this.options.provider).read_commit_receipt({ ...scope, commit_id });
    const receipt = existing ?? await require_memory_transactions(this.options.provider).commit({
      ...scope, commit_id, expected_scope_version: job.scope_version,
      changes: (job.changes ?? []).map((change, index) => ({
        operation: change.operation, memory_id: change.memory_id, expected_version: change.expected_version,
        content: change.content, topic: change.topic, memory_type: change.memory_type,
        source_refs: change.source_ids.map((source_id) => {
          const source = job.sources.find((item) => item.source_id === source_id);
          if (!source) throw new Error("Staged source is not permitted by this Job");
          const evidence = job.change_details?.[index]?.sources.find((item) => item.source_id === source_id);
          return { ...source, source_type: source.category === "task" ? "task" : source.role === "request" || source.category === "manual" ? "manual" : "session",
            excerpt: evidence?.excerpt, locator: evidence ? `text-offset:${evidence.excerpt_start}` : undefined };
        }).map(({ text: _text, ...source }) => source),
      })),
    });
    await this.options.jobs.update(job.job_id, {
      status: "succeeded", memory_ids: receipt.changes.map((change) => change.memory_id), error: undefined,
      change_details: job.change_details?.map((detail, index) => ({ ...detail,
        memory_id: receipt.changes[index]?.memory_id ?? detail.memory_id,
        after: { ...detail.after, version: receipt.changes[index]?.version ?? detail.after.version },
      })),
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
