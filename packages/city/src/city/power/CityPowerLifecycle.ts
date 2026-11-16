/**
 * City 独占的 Power 生命周期与清理责任。
 *
 * 同 ID 修改按完整结算串行；取消通过队列外的 Controller 同步送达。
 * Registry 可见性与资源所有权分开：清理失败的记录继续占有 ID 和存储上下文，
 * 只有成功的释放步骤才标记完成。此处不抢占执行中的 Hook，也不提前放弃初始化。
 */
import { get_logger } from "@downcity/agent";
import type { CityPowerBatch } from "../types/CityPowerBatch.js";
import type { CityPowerInput } from "@/city/types/CityPower.js";
import type { CityPowerRecord, CityPowerRuntimeOptions } from "@/city/types/CityPowerRuntime.js";
import type { CityPowerRegistration, PowerLifecycleContext, PowerSnapshot } from "@/power/index.js";
import type { PowerRegistry } from "@/power/core/PowerRegistry.js";

/** 生命周期所需的同一 City 端口，不创建第二份 Registry 或实例事实源。 */
interface CityPowerLifecycleOptions {
  /** City 唯一的存储和宿主配置。 */
  readonly runtime: CityPowerRuntimeOptions;
  /** City 唯一的执行 Registry，移除时先撤销能力再清理资源。 */
  readonly registry: PowerRegistry;
  /** 为新记录创建稳定上下文，包含该次初始化的取消信号。 */
  readonly create_context: (record: Pick<CityPowerRecord, "power_id" | "logger" | "host_actions" | "config_actions" | "initialization_abort">, storage: PowerLifecycleContext["storage"]) => PowerLifecycleContext;
  /** Registry 改变后原子发布能力。 */
  readonly changed: () => void;
  /** Power 资源清理成功后释放可信执行配置。 */
  readonly release_profiles: (power_id: string) => void;
}

/** 持有全部实例、失败投影、串行链和在途初始化取消句柄。 */
export class CityPowerLifecycle {
  /** 尚未完成清理的唯一实例，包括不可执行的失败记录。 */
  readonly records = new Map<string, CityPowerRecord>();
  /** 清理已完成的初始化失败仅保留诊断，不再持有实例资源。 */
  readonly failed_snapshots = new Map<string, PowerSnapshot>();
  /** 同 ID 完整修改的串行链。 */
  private readonly chains = new Map<string, Promise<void>>();
  /** 从提交时开始登记，覆盖尚未进入串行链的初始化。 */
  private readonly pending = new Map<string, Set<AbortController>>();
  /** 关闭等待全部已提交生命周期结算，单项失败不污染屏障。 */
  settlement: Promise<void> = Promise.resolve();
  /** 关闭后拒绝新登记和执行，失败释放仍允许重试。 */
  private status: "active" | "disposing" | "disposed" = "active";
  /** 并发关闭共享当前尝试，失败后清除以允许重试。 */
  private dispose_promise?: Promise<void>;

  constructor(private readonly options: CityPowerLifecycleOptions) {}

  /** 不等待同 ID 队列，立即取消指定或全部已提交的初始化。 */
  cancel_initialization(power_id?: string): void {
    const entries = power_id === undefined ? this.pending.values() : [this.pending.get(power_id.trim())];
    for (const controllers of entries) {
      for (const controller of controllers ?? []) controller.abort(new Error("City Power initialization cancelled"));
    }
  }

  /** 封闭新工作并同步取消初始化，已开始工作仍须结算。 */
  begin_shutdown(): void {
    if (this.status === "active") this.status = "disposing";
    this.cancel_initialization();
  }

  /** 拒绝关闭后新增生命周期或宿主执行。 */
  assert_active(): void {
    if (this.status !== "active") throw new Error(`City Power Runtime is ${this.status}`);
  }

  /** 提交初始化；Controller 在串行操作开始前就登记。 */
  add(input: CityPowerInput): Promise<void> {
    return this.submit(input, false);
  }

  /** 无长期资源的定义可原地更新；不可执行的旧实例必须先清理。 */
  refresh(input: CityPowerInput): Promise<void> {
    return this.submit(input, true);
  }

  /** 共用提交边界，使取消同时覆盖 add 与不存在 ID 的 refresh。 */
  private submit(input: CityPowerInput, refresh: boolean): Promise<void> {
    this.assert_active();
    const registration = normalize_registration(input);
    const power_id = normalize_id(registration.power.name);
    const controller = new AbortController();
    const controllers = this.pending.get(power_id) ?? new Set<AbortController>();
    controllers.add(controller);
    this.pending.set(power_id, controllers);
    const operation = this.enqueue(power_id, async () => {
      this.assert_active();
      controller.signal.throwIfAborted();
      const existing = this.records.get(power_id);
      if (refresh && existing) {
        this.assert_ready(existing);
        existing.registration = registration;
        existing.power = registration.power;
        existing.updated_at = Date.now();
        await this.options.registry.register(existing.power);
        this.options.changed();
        return;
      }
      await this.add_power(power_id, registration, controller);
    }).finally(() => {
      controllers.delete(controller);
      if (controllers.size === 0 && this.pending.get(power_id) === controllers) this.pending.delete(power_id);
    });
    this.track(operation);
    return operation;
  }

  /** 接管全部实例与清理上下文，初始化和目录发布由独立检查点控制。 */
  prepare(inputs: readonly CityPowerInput[]): CityPowerBatch {
    this.assert_active();
    const registrations = inputs.map(normalize_registration);
    const ids = new Set<string>();
    for (const registration of registrations) {
      const id = normalize_id(registration.power.name);
      if (ids.has(id) || this.records.has(id)) throw new Error(`Power already exists in City: ${id}`);
      ids.add(id);
    }
    const records = registrations.map((registration) => this.create_record(registration, new AbortController()));
    for (const record of records) { record.staged = true; this.records.set(record.power_id, record); }
    let initialization: Promise<void> | undefined;
    let published = false;
    return {
      initialize: () => {
        initialization ??= (async () => {
          for (const record of records) { record.ready = this.initialize(record); await record.ready; }
        })();
        this.track(initialization);
        return initialization;
      },
      publish: () => {
        this.assert_active();
        if (published) return;
        for (const record of records) {
          if (record.state !== "ready" || this.records.get(record.power_id) !== record) throw new Error("Power batch has not initialized");
          record.initialization_abort.signal.throwIfAborted();
        }
        for (const record of records) record.staged = false;
        this.options.registry.register_batch(records.map((record) => record.power));
        published = true;
        this.options.changed();
      },
      dispose: async () => {
        for (const record of [...records].reverse()) {
          if (this.records.get(record.power_id) !== record) continue;
          await this.revoke(record); await this.cleanup(record);
        }
      },
    };
  }

  /** 同步分配唯一生命周期上下文，尚未运行 initialize。 */
  private create_record(registration: CityPowerRegistration, initialization_abort: AbortController): CityPowerRecord {
    const power_id = normalize_id(registration.power.name);
    const scope = this.options.runtime.storage.open_scope(["powers", power_id]);
    const logger = get_logger();
    logger.bind_storage(scope.files, scope.root_path);
    const host_actions: CityPowerRecord["host_actions"] = new Map();
    const config_actions: CityPowerRecord["config_actions"] = new Map();
    const lifecycle_context = this.options.create_context({ power_id, logger, host_actions, config_actions, initialization_abort }, Object.freeze({ path: scope.root_path, files: scope.files }));
    const current_time = Date.now();
    return { power_id, registration, power: registration.power, logger, lifecycle_context, host_actions, config_actions, initialization_abort, ready: Promise.resolve(), active_host_calls: 0, lifecycle_active: true, state: "initializing", registered_at: current_time, updated_at: current_time };
  }

  /** 等待真实初始化后发布；失败清理结算前始终保留实例所有权。 */
  private async add_power(power_id: string, registration: CityPowerRegistration, initialization_abort: AbortController): Promise<void> {
    const existing = this.records.get(power_id);
    if (existing) {
      this.assert_ready(existing);
      if (existing.power === registration.power) return;
      throw new Error(`Power already exists in City: ${power_id}`);
    }
    this.failed_snapshots.delete(power_id);
    const record = this.create_record(registration, initialization_abort);
    this.records.set(power_id, record);
    record.ready = this.initialize(record);
    void record.ready.catch(() => undefined);
    try {
      await record.ready;
      initialization_abort.signal.throwIfAborted();
      this.assert_active();
      await this.options.registry.register(record.power);
      // register 可等待旧 Hook 的既有结算；等待期间收到取消也不能迟到发布。
      initialization_abort.signal.throwIfAborted();
      this.assert_active();
      this.options.changed();
    } catch (error) {
      record.initialization_error = error;
      record.last_error = error_message(error);
      let failure = error;
      try {
        await this.revoke(record);
        await this.cleanup(record);
      } catch (cleanup_error) {
        failure = new AggregateError([error, cleanup_error], `City Power initialization cleanup failed: ${power_id}`);
      }
      if (this.records.get(power_id) !== record) {
        this.failed_snapshots.set(power_id, { ...to_power_snapshot(record), status: "error", last_error: error_message(failure) });
      }
      this.options.changed();
      throw failure;
    }
  }

  /** 取消立即送达，撤销及清理仍在同 ID 链内结算；失败可再次 remove。 */
  remove(power_id_input: string): Promise<boolean> {
    this.assert_active();
    const power_id = normalize_id(power_id_input);
    this.cancel_initialization(power_id);
    const operation = this.enqueue(power_id, async () => {
      const record = this.records.get(power_id);
      if (!record) return this.failed_snapshots.delete(power_id);
      await this.revoke(record);
      await this.cleanup(record);
      this.failed_snapshots.delete(power_id);
      return true;
    });
    this.track(operation);
    return operation;
  }

  /** 可查询状态始终来自 City；失败实例与纯诊断投影不会重复。 */
  snapshots(): PowerSnapshot[] {
    return [...this.records.values()].filter((record) => !record.staged).map(to_power_snapshot).concat([...this.failed_snapshots.values()])
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 当前实例只允许 ready 状态执行，失败清理不恢复可见性。 */
  assert_ready(record: CityPowerRecord): void {
    if (record.staged || record.state !== "ready") throw new Error(`Power is unavailable in City: ${record.power_id}: ${record.last_error || record.state}`);
  }

  /** 失败关闭可重试；成功清理的记录已移除，不会重复调用 dispose。 */
  async dispose(): Promise<void> {
    if (this.status === "disposed") return;
    this.begin_shutdown();
    if (!this.dispose_promise) {
      const operation = this.dispose_runtime();
      this.dispose_promise = operation;
      void operation.then(() => { this.status = "disposed"; }, () => {
        if (this.dispose_promise === operation) this.dispose_promise = undefined;
      });
    }
    await this.dispose_promise;
  }

  /** 全部初始化结算后按逆序清理，失败保留记录与上下文。 */
  private async dispose_runtime(): Promise<void> {
    await this.settlement;
    const errors: unknown[] = [];
    for (const record of [...this.records.values()].reverse()) {
      try { await this.revoke(record); await this.cleanup(record); }
      catch (error) { errors.push(error); }
    }
    this.options.changed();
    if (errors.length) throw new AggregateError(errors, "City Power Runtime shutdown failed");
    this.failed_snapshots.clear();
  }

  /** 已接受的初始化完整结算，取消后不发布 ready。 */
  private async initialize(record: CityPowerRecord): Promise<void> {
    try {
      record.initialization_abort.signal.throwIfAborted();
      await record.power.initialize?.(record.lifecycle_context);
      record.initialization_abort.signal.throwIfAborted();
      record.state = "ready";
    } catch (error) {
      record.state = "error";
      record.initialization_error = error;
      record.last_error = error_message(error);
      throw error;
    } finally { record.updated_at = Date.now(); }
  }

  /** 先封闭宿主执行，再使用 Registry 原有 Hook 结算语义撤销能力。 */
  private async revoke(record: CityPowerRecord): Promise<void> {
    record.state = "disposing";
    record.updated_at = Date.now();
    this.options.changed();
    try { await this.options.registry.unregister(record.power_id); }
    catch (error) { this.cleanup_failed(record, error); throw error; }
    this.options.changed();
  }

  /** 真实工作及宿主管理调用结算后才释放；成功步骤在重试时跳过。 */
  private async cleanup(record: CityPowerRecord): Promise<void> {
    await record.ready.catch(() => undefined);
    if (record.active_host_calls > 0) {
      record.host_calls_idle ??= new Promise<void>((resolve) => { record.resolve_host_calls_idle = resolve; });
      await record.host_calls_idle;
    }
    try {
      if (record.lifecycle_active) {
        await record.power.dispose?.(record.lifecycle_context);
        record.lifecycle_active = false;
      }
      this.options.release_profiles(record.power_id);
      if (this.records.get(record.power_id) === record) this.records.delete(record.power_id);
    } catch (error) {
      this.cleanup_failed(record, error);
      throw error;
    } finally { record.updated_at = Date.now(); }
  }

  /** 保留首个清理失败原始原因，最近一次失败仍可由 last_error 查询。 */
  private cleanup_failed(record: CityPowerRecord, error: unknown): void {
    record.cleanup_error ??= error;
    record.last_error = error_message(error);
    record.state = "cleanup_failed";
    record.updated_at = Date.now();
    this.options.changed();
  }

  /** 生命周期失败只影响调用者；关闭仍等待所有已接受任务。 */
  private track(operation: Promise<unknown>): void {
    this.settlement = Promise.all([this.settlement, operation.then(() => undefined, () => undefined)]).then(() => undefined);
  }

  /** 同 ID 串行链包含初始化、能力撤销和清理的全部结算。 */
  private enqueue<TResult>(power_id: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.chains.get(power_id);
    const result = previous ? previous.then(operation, operation) : operation();
    const settled = result.then(() => undefined, () => undefined);
    this.chains.set(power_id, settled);
    void settled.then(() => { if (this.chains.get(power_id) === settled) this.chains.delete(power_id); });
    return result;
  }
}

/** 内部记录的稳定诊断投影，原始异常对象仅由 City 持有。 */
function to_power_snapshot(record: CityPowerRecord): PowerSnapshot {
  return {
    name: record.power_id, title: record.power.title, description: record.power.description,
    status: record.state, registered_at: record.registered_at, updated_at: record.updated_at,
    ...(record.last_error ? { last_error: record.last_error } : {}),
    ...(record.initialization_error !== undefined ? { initialization_error: error_message(record.initialization_error) } : {}),
    ...(record.cleanup_error !== undefined ? { cleanup_error: error_message(record.cleanup_error) } : {}),
  };
}

/** 聚合失败保留每个原因的可展示文本。 */
function error_message(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(error_message).join("; ") || error.message;
  return error instanceof Error ? error.message : String(error);
}

/** 统一直接 Power 与注册项输入。 */
function normalize_registration(input: CityPowerInput): CityPowerRegistration {
  if ("power" in input) return input;
  return { power: input, readme: "", has_config: false, has_sidebar: false, has_mainview: false };
}

/** 拒绝空的生命周期标识。 */
function normalize_id(value: string): string {
  const id = String(value || "").trim();
  if (!id) throw new Error("power_id is required");
  return id;
}
