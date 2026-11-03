/**
 * Memory 内部 Process：低频重放可信事实，按开关、压力、预算规划后台 Job，并核对提交终态。
 * 不创建 Agent 或业务 Task，不订阅普通 Turn，也不伪造聊天接收方。停止后不开始新工作。
 */
import { createHash } from "node:crypto";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryDreamOptions, MemoryDreamScope, MemoryDreamView, MemorySignalInput, MemoryDreamAccessResolver } from "../types/MemoryDream.js";
import type { MemoryJob } from "../types/MemoryJob.js";
import { memory_job_view } from "../types/MemoryJob.js";
import { MemorySignalStore } from "../storage/MemorySignalStore.js";
import { MemoryJobStore } from "../storage/MemoryJobStore.js";
import { MemoryCoordinator } from "./MemoryCoordinator.js";
import { MemorySignalIntake } from "./MemorySignalIntake.js";
import { MemoryDreamPlanner, MEMORY_DREAM_COOLDOWN_MS, MEMORY_DREAM_DAILY_BATCH_LIMIT } from "./MemoryDreamPlanner.js";

/** 维护检查每五分钟运行一次，空队列只做本地读取，不调用模型。 */
export const MEMORY_DREAM_WAKE_MS = 5 * 60_000;

export class MemoryDreaming {
  /** City 私有 Job 根的稳定身份；同平台共享账本但不共享 Job 读取权限。 */
  readonly owner_id: string;
  /** 可信摄取入口，不向普通模型暴露 producer 或权限字段。 */
  private readonly intake: MemorySignalIntake;
  /** 固定选材和预算预留。 */
  private readonly planner: MemoryDreamPlanner;
  /** 生命周期拥有的低频 timer。 */
  private timer?: ReturnType<typeof setInterval>;
  /** 合并同实例唤醒，关闭时等待本次检查结束。 */
  private checking?: Promise<void>;
  /** 关闭后拒绝摄取和启动新批次。 */
  private stopped = false;
  /** 事实源整体不可读时的可见错误，独立于某个 Job。 */
  private source_error?: string;

  constructor(private readonly host: PowerLifecycleContext, private readonly store: MemorySignalStore,
    private readonly jobs: MemoryJobStore, private readonly coordinator: MemoryCoordinator,
    private readonly resolve_access: MemoryDreamAccessResolver, private readonly options: MemoryDreamOptions = {}) {
    this.owner_id = createHash("sha256").update(host.storage.path).digest("hex");
    this.intake = new MemorySignalIntake(store);
    this.planner = new MemoryDreamPlanner(store, this.owner_id);
  }

  /** 启动只恢复账本和既有回执；默认关闭的范围不会创建模型工作。 */
  async initialize(): Promise<void> {
    await this.store.initialize();
    this.timer = setInterval(() => { void this.tick().catch((error) => this.host.logger.warn("Memory dream check failed", { error: String(error) })); }, MEMORY_DREAM_WAKE_MS);
    this.timer.unref?.();
    await this.tick();
  }

  /** 校验宿主真实 Agent/Workspace，不允许存储正文扩大执行身份。 */
  async assert_scope(scope: MemoryDreamScope): Promise<void> {
    if (scope.target !== "agent" && scope.target !== "current_workspace") throw new Error("Automatic memory requires Agent or Workspace knowledge scope");
    if (!(await this.host.system.list_agents()).some((agent) => agent.agent_id === scope.agent_id)) throw new Error("Unknown dream Agent");
    if (scope.workspace_id && !(await this.host.system.list_workspaces()).some((workspace) => workspace.workspace_id === scope.workspace_id)) throw new Error("Unknown dream Workspace");
    if (scope.target === "current_workspace" && !scope.workspace_id) throw new Error("Workspace dream requires an explicit Workspace");
  }

  /** 普通显式记忆动作不受此自动开关影响；后台每次实际取 Job 都重新核对。 */
  async can_run(job: MemoryJob): Promise<boolean> {
    if (this.stopped || job.kind !== "dream" || job.mode !== "knowledge" || job.target === "user") return false;
    const scope: MemoryDreamScope = { agent_id: job.access.agent_id, workspace_id: job.access.workspace_id, target: job.target };
    const ledger = await this.store.read(scope);
    const batch = ledger.batches.find((item) => item.job_id === job.job_id && item.owner_id === this.owner_id);
    return ledger.enabled && Boolean(batch) && !this.coordinator.has_explicit_work;
  }

  /** 明确纠错由宿主管理输入调用，接收不意味着已经提炼或提交。 */
  async receive(input: MemorySignalInput): Promise<void> {
    if (this.stopped) throw new Error("Memory dreaming is stopping");
    await this.assert_scope(input);
    await this.intake.receive(input);
  }

  /** 开关持久化后即生效；关闭不会把未完成输入标为 processed。 */
  async configure(scope: MemoryDreamScope, enabled: boolean): Promise<MemoryDreamView> {
    if (this.stopped) throw new Error("Memory dreaming is stopping");
    await this.assert_scope(scope);
    await this.store.mutate(scope, (ledger) => { ledger.enabled = enabled; ledger.defer_reason = enabled ? "waiting_for_maintenance" : "disabled"; });
    return await this.view(scope);
  }

  /** 管理页区分批次状态与真实 Job 提交结果，不显示虚构的 delivery 成功。 */
  async view(scope: MemoryDreamScope): Promise<MemoryDreamView> {
    await this.assert_scope(scope);
    const ledger = await this.store.read(scope);
    if (this.source_error) ledger.last_error = this.source_error;
    const jobs = [] as MemoryDreamView["jobs"];
    for (const batch of ledger.batches) {
      if (batch.owner_id !== this.owner_id) continue;
      const job = await this.jobs.read(batch.job_id);
      if (job) jobs.push(memory_job_view(job));
    }
    return { ledger, backlog: ledger.signals.filter((signal) => signal.state !== "processed").length, jobs, owner_id: this.owner_id };
  }

  /** 失败只在用户显式重试后重新计算，仍受同一自动范围的预算、冷却与三次尝试上限约束。 */
  async retry(scope: MemoryDreamScope, batch_id: string): Promise<MemoryDreamView> {
    await this.assert_scope(scope);
    const batch = (await this.store.read(scope)).batches.find((item) => item.batch_id === batch_id && item.owner_id === this.owner_id);
    if (!batch) throw new Error("Dream batch belongs to another City or does not exist");
    let job = await this.jobs.read(batch.job_id);
    if (!job) throw new Error("Dream Job is not yet published; wait for maintenance replay");
    job = await this.coordinator.reconcile_committed(job);
    if (job.status !== "failed") throw new Error("Only failed dream Jobs can be retried");
    if (job.attempt >= 3) throw new Error("Dream Job attempt budget exhausted");
    await this.store.mutate(scope, (ledger) => {
      if (!ledger.enabled) throw new Error("Enable this exact dream scope before retrying");
      const day = new Date().toISOString().slice(0, 10);
      if (ledger.budget_day !== day) { ledger.budget_day = day; ledger.budget_used = 0; }
      if (ledger.next_run_at && Date.parse(ledger.next_run_at) > Date.now()) throw new Error("Dream batch is deferred by cooldown or daily budget");
      if (ledger.budget_used >= MEMORY_DREAM_DAILY_BATCH_LIMIT) throw new Error("Daily dream computation budget exhausted");
      ledger.budget_used += 1;
      ledger.next_run_at = new Date(Date.now() + MEMORY_DREAM_COOLDOWN_MS).toISOString();
    });
    await this.coordinator.retry(job);
    await this.reconcile(scope);
    return await this.view(scope);
  }

  /** 可合并的维护唤醒；供生命周期与隔离验证调用，不作为普通模型 action。 */
  async tick(): Promise<void> {
    if (this.stopped) return;
    this.checking ??= this.check().finally(() => { this.checking = undefined; });
    await this.checking;
  }

  /** 重放源事实后才规划，同一次检查最多安排一个后台 Job，显式请求优先。 */
  private async check(): Promise<void> {
    if (this.options.read_signals) {
      try {
        const signals = await this.options.read_signals();
        this.source_error = undefined;
        for (const signal of signals) {
          if (this.stopped) return;
          try { await this.receive(signal); }
          catch (error) {
            try {
              await this.assert_scope(signal);
              await this.store.mutate(signal, (ledger) => { ledger.last_error = String(error); });
            } catch { this.source_error = String(error); }
          }
        }
      } catch (error) { this.source_error = String(error); }
    }
    for (const scope of await this.store.scopes()) {
      if (this.stopped) return;
      try {
        await this.assert_scope(scope);
        await this.reconcile(scope);
        const ledger = await this.store.read(scope);
        if (!ledger.enabled) continue;
        if (this.coordinator.has_work) {
          await this.store.mutate(scope, (state) => { state.defer_reason = this.coordinator.has_explicit_work ? "explicit_request_priority" : "memory_busy"; });
          continue;
        }
        const existing = ledger.batches.find((batch) => batch.owner_id === this.owner_id && ["planned", "queued"].includes(batch.status));
        const batch = existing ?? await this.planner.plan(scope, await this.resolve_access(scope));
        if (!batch || this.stopped) continue;
        await this.coordinator.submit(batch.input);
        await this.store.mutate(scope, (state) => {
          const current = state.batches.find((item) => item.batch_id === batch.batch_id)!;
          if (current.status === "planned") current.status = "queued";
        });
      } catch (error) { await this.store.mutate(scope, (ledger) => { ledger.last_error = String(error); }); }
    }
  }

  /** succeeded 必须能对账提交回执，skipped 是正常处理终态；其余状态保留积压。 */
  private async reconcile(scope: MemoryDreamScope): Promise<void> {
    const ledger = await this.store.read(scope);
    for (const batch of ledger.batches.filter((item) => item.owner_id === this.owner_id)) {
      let job = await this.jobs.read(batch.job_id);
      if (!job) continue;
      job = await this.coordinator.reconcile_committed(job);
      const final_job = job;
      await this.store.mutate(scope, (state) => {
        const current = state.batches.find((item) => item.batch_id === batch.batch_id)!;
        if (final_job.status === "succeeded" || final_job.status === "skipped") {
          current.status = final_job.status;
          current.error = undefined;
          for (const signal of state.signals.filter((item) => current.signal_ids.includes(item.signal_id))) signal.state = "processed";
          this.store.advance_watermark(state);
        } else if (final_job.status === "failed") {
          current.status = "failed";
          current.error = final_job.error;
          state.last_error = final_job.error;
        } else { current.status = "queued"; current.error = undefined; }
      });
    }
  }

  /** 停止 timer 与新工作，等待本次检查；Coordinator 由组合根随后关闭。 */
  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.checking;
    await this.store.dispose();
  }
}
