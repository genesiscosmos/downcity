/** Memory 处理编排：持久化请求、受限 Session 计算、幂等提交；模型最终文字不代表记忆已保存。 */
import { same_model } from "@downcity/type";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider } from "../types/MemoryProtocol.js";
import type { MemoryJob, MemoryJobInput } from "../types/MemoryJob.js";
import { MEMORY_SESSION_KIND } from "../types/MemorySession.js";
import { MemoryJobStore, memory_job_identity } from "../storage/MemoryJobStore.js";
import { require_memory_model } from "./MemoryModelBinding.js";
import type { MemoryModelResolver } from "../types/MemoryModelBinding.js";
import { require_memory_transactions } from "./MemoryKnowledge.js";
import { memory_job_changes } from "./MemoryJobCommit.js";
import { register_memory_session_profile, MEMORY_SESSION_PROFILE_VERSION } from "../runtime/MemorySession.js";

/** 处理生命周期的受限依赖。 */
export interface MemoryCoordinatorOptions {
  /** City 可信生命周期端口。 */
  host: PowerLifecycleContext;
  /** 确定性记忆提交与查询。 */
  provider: MemoryProvider;
  /** 本 Power 的内部处理账本。 */
  jobs: MemoryJobStore;
  /** 已登记的专用执行 Agent；不提供模型覆盖。 */
  execution_agent_id?: string;
  /** 提交与执行时校验同一执行 Agent 的模型来源和授权。 */
  resolve_model_binding?: MemoryModelResolver;
  /** 自动 Job 每次开始前核对持久开关；普通显式请求不受影响。 */
  can_run_background?: (job: MemoryJob) => Promise<boolean>;
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
    });
    for (const job of await this.options.jobs.list()) {
      if (job.kind !== "dream" && ["queued", "running", "committing", "retry_wait"].includes(job.status)) this.schedule(job.job_id, false);
    }
  }

  /** 先保存请求再调度；调用方得到的是 accepted，而非 saved。 */
  async submit(input: MemoryJobInput): Promise<MemoryJob> {
    if (this.stopped) throw new Error("Memory Coordinator is stopping");
    if (input.kind === "dream" && (input.memory_kind !== "knowledge" || input.scope === "user")) throw new Error("Automatic memory only supports Agent/Workspace knowledge");
    require_memory_transactions(this.options.provider);
    if (input.scope === "workspace" && input.memory_kind === "agreement") throw new Error("Workspace supports Knowledge only");
    // 幂等重送不重新选择账号；同 request key 的既有 Job 永远保留提交时基线。
    const existing = await this.options.jobs.read(memory_job_identity(input));
    const execution_agent_id = existing ? existing.execution_agent_id ?? existing.access.agent_id : input.execution_agent_id ?? this.options.execution_agent_id ?? input.access.agent_id;
    const configured = existing ? undefined : await this.options.resolve_model_binding?.(execution_agent_id);
    if (!existing && input.model && (!same_model(input.model, configured?.model) || input.binding_id !== configured?.binding_id)) throw new Error("memory_model_configuration_required: execution Agent does not match the requested baseline");
    const baseline = existing ? { model: existing.model, binding_id: existing.binding_id } : configured;
    const job = await this.options.jobs.create({ ...input, execution_agent_id, model: baseline?.model, binding_id: baseline?.binding_id });
    if (["queued", "retry_wait", "running", "committing"].includes(job.status)) this.schedule(job.job_id, job.kind === "dream");
    return job;
  }

  /** 即使自动开关关闭，也可根据已有提交回执补齐终态；此路径绝不发起新提交。 */
  async reconcile_committed(job: MemoryJob): Promise<MemoryJob> {
    if (job.status === "skipped") return job;
    const receipt = await require_memory_transactions(this.options.provider).read_commit_receipt({ access: job.access, scope: job.scope, commit_id: `job:${job.job_id}` });
    if (!receipt && job.status === "succeeded") throw new Error("Memory succeeded Job has no matching commit receipt");
    if (!receipt || job.status === "succeeded") return job;
    await this.commit(job);
    return (await this.options.jobs.read(job.job_id))!;
  }

  /** 人工重试失败请求，保留原身份与证据。 */
  async retry(job: MemoryJob): Promise<MemoryJob> {
    if (job.status !== "failed") throw new Error("Only failed Memory Jobs can be retried");
    const committed = await require_memory_transactions(this.options.provider).read_commit_receipt({ access: job.access, scope: job.scope, commit_id: `job:${job.job_id}` });
    if (!committed) require_memory_model(job);
    const updated = await this.options.jobs.update(job.job_id, {
      status: committed ? "committing" : "queued",
      ...(committed ? {} : { session_id: undefined, turn_id: undefined, changes: undefined, change_details: undefined, scope_version: undefined }),
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
    const execution_agent_id = job.execution_agent_id ?? job.access.agent_id;
    const current = await this.options.resolve_model_binding?.(execution_agent_id);
    if (!current || !same_model(current.model, baseline.model) || current.binding_id !== baseline.binding_id) throw new Error("memory_model_binding_changed: execution Agent changed; retry preserves the confirmed baseline");
    const model = this.options.host.town?.models.client(baseline.model, { binding_id: baseline.binding_id });
    if (!model || !same_model(model.model_reference, baseline.model) || model.binding_id !== baseline.binding_id) {
      throw Object.assign(new Error("Memory Job model authorization is unavailable or changed"), { code: "memory_model_binding_changed" });
    }
    if (!job.session_id) {
      const attempt = job.attempt + 1;
      const session = await host.system.create_agent_session({
        agent_id: execution_agent_id, workspace_id: job.access.workspace_id, inherit_workspace: false,
        execution_profile_id: "memory", execution_profile_version: MEMORY_SESSION_PROFILE_VERSION,
        creation_key: `memory:${job.job_id}:${attempt}`,
        type: "work", kind: MEMORY_SESSION_KIND,
      });
      job = await this.options.jobs.update(job.job_id, { status: "running", attempt, session_id: session.session_id });
    }
    if (job.scope_version === undefined) {
      const version = await require_memory_transactions(this.options.provider).read_version({ access: job.access, scope: job.scope });
      job = await this.options.jobs.update(job.job_id, { scope_version: job.input_scope_version ?? version.scope_version });
    }
    const session_id = job.session_id!;
    const request_id = `memory:${job.job_id}:${job.attempt}`;
    let state = await host.system.read_agent_session({
      agent_id: execution_agent_id, type: "work", session_id, request_id,
    });
    if (state.execution_profile?.id !== "memory" || state.execution_profile.version !== MEMORY_SESSION_PROFILE_VERSION
      || state.execution_profile.creation_key !== `memory:${job.job_id}:${job.attempt}`) throw new Error("Memory Session execution identity differs from the Job");
    if (state.status === "running") {
      const deadline = Date.now() + 120_000;
      while (state.status === "running" && Date.now() < deadline && !this.stopped) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        state = await host.system.read_agent_session({ agent_id: execution_agent_id, type: "work", session_id, request_id });
      }
      if (state.status === "running") {
        await host.system.stop_agent_session({ agent_id: execution_agent_id, type: "work", session_id });
        throw new Error("Memory Session exceeded the recovery processing budget");
      }
    }
    if (state.status === "interrupted") throw new Error("Memory Session was interrupted; retry starts a new bounded attempt");
    if (state.status === "completed") {
      if (!state.result?.success) throw new Error(state.result?.error ?? "Memory Session failed");
    } else {
      const turn = await host.system.prompt_agent_session({
        agent_id: execution_agent_id, session_id, type: "work", request_id,
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
        await host.system.stop_agent_session({ agent_id: execution_agent_id, type: "work", session_id, turn_id: turn.turn_id });
        throw error;
      } finally { if (timer) clearTimeout(timer); }
    }
    job = await this.options.jobs.read(job.job_id);
    if (!job) throw new Error("Memory Job disappeared");
    if (job.skip_reason) { await this.options.jobs.update(job.job_id, { status: "skipped" }); return; }
    if (!job.changes?.length) throw new Error("Memory Session completed without a staged outcome");
    job = await this.options.jobs.update(job.job_id, { status: "committing" });
    await this.commit(job);
  }

  /** 回执与记忆原子发布；Job 状态丢失时可以用相同键重读。 */
  private async commit(job: MemoryJob): Promise<void> {
    if (job.kind === "dream" && (job.memory_kind !== "knowledge" || job.scope === "user")) throw new Error("Invalid automatic memory scope");
    const commit_id = `job:${job.job_id}`;
    const scope = { access: job.access, scope: job.scope };
    const existing = await require_memory_transactions(this.options.provider).read_commit_receipt({ ...scope, commit_id });
    const receipt = existing ?? await require_memory_transactions(this.options.provider).commit({
      ...scope, commit_id, expected_scope_version: job.scope_version,
      changes: memory_job_changes(job),
    });
    await this.options.jobs.update(job.job_id, {
      status: "succeeded", memory_ids: receipt.changes.map((change) => change.record.memory_id), error: undefined,
      change_details: job.change_details?.map((detail, index) => ({ ...detail,
        memory_id: receipt.changes[index]?.record.memory_id ?? detail.memory_id,
        after: { ...detail.after, version: receipt.changes[index]?.record.version ?? detail.after.version },
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
