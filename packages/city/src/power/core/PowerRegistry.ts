/**
 * City Power 的 Agent 执行 Registry。
 *
 * 关键点（中文）
 * - Registry 只持有 City Power 唯一实例的 Agent 执行投影，不拥有实例。
 * - Registry 不启动或停止 Power，只管理执行索引与 execution lease。
 * - action、system、hook、resolve 都统一以“已注册且 ready”为生效边界。
 */

import { to_power_view } from "@/power/core/PowerCatalog.js";
import type {
  PowerActionReadView,
  PowerActionResult,
  PowerAvailability,
  PowerDefinition,
  PowerReadView,
  PowerView,
} from "@/power/index.js";
import type {
  AgentPowerRuntime,
  AgentPowerExecutionLease,
  AgentPowerExecutionRuntime,
} from "@/power/types/PowerExecutionRuntime.js";
import type { AgentSessionSystemBlock } from "@downcity/agent";
import type { PowerContextFactory } from "@/power/types/PowerContextFactory.js";
import type { JsonValue } from "@downcity/agent";
import type { PowerSnapshot } from "@/power/index.js";
import type { PowerRuntimeRecord } from "@/power/types/PowerRuntimeRecord.js";
import type { PowerExecutionContext } from "@/power/index.js";
import type { SessionInteractionPort } from "@downcity/agent";
import { execute_power_action } from "@/power/core/PowerActionExecution.js";
import type { RuntimeTool as Tool } from "@downcity/type";
import { create_power_tools } from "@/power/tool/PowerTools.js";
import type {
  PowerRegistryChange,
  PowerRegistrySubscriber,
  PowerRegistryUnsubscribe,
} from "@/power/types/PowerRegistry.js";

function now_ms(): number {
  return Date.now();
}

function normalize_power_name(power_name: string): string {
  return String(power_name || "").trim();
}

function create_record(power: PowerDefinition): PowerRuntimeRecord {
  const current_time = now_ms();
  return {
    power,
    registered_at: current_time,
    active_execution_leases: 0,
    retired: false,
  };
}

function to_power_snapshot(record: PowerRuntimeRecord): PowerSnapshot {
  const power = record.power;
  return {
    name: power.name,
    title: String(power.title || power.name || "").trim(),
    description: String(power.description || "").trim(),
    status: "ready",
    registered_at: record.registered_at,
    updated_at: record.registered_at,
  };
}

/**
 * PowerRegistry：City 唯一 Power 注册、卸载与调用实现。
 */
export class PowerRegistry {
  private readonly records = new Map<string, PowerRuntimeRecord>();

  private readonly retired_records = new Set<PowerRuntimeRecord>();

  /** Power 配置变化订阅器。 */
  private readonly change_subscribers = new Set<PowerRegistrySubscriber>();

  constructor(powers: PowerDefinition[] = []) {
    for (const power of powers) {
      this.register_sync(power);
    }
  }

  /** 订阅 Power 配置的后续变化。 */
  subscribe_change(
    subscriber: PowerRegistrySubscriber,
  ): PowerRegistryUnsubscribe {
    this.change_subscribers.add(subscriber);
    return () => {
      this.change_subscribers.delete(subscriber);
    };
  }

  /**
   * 返回当前 Registry 向 Agent 提供的 Power Tools。
   *
   * 关键点（中文）
   * - 没有任何 Action 时不暴露空壳 Tool。
   * - Tool 闭包绑定当前 Registry，动态 Power 变化无需重建 bridge。
   */
  tools(
    context_factory: PowerContextFactory,
    runtime: AgentPowerRuntime = this.contextual(context_factory),
  ): Record<string, Tool> {
    return create_power_tools({
      definitions: this.active_definitions(),
      powers: runtime,
    });
  }

  /** 返回当前仍然有效的 power 定义，顺序稳定。 */
  private active_definitions(): PowerDefinition[] {
    return Array.from(this.records.values())
      .filter((record) => !record.retired)
      .map((record) => record.power)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * 创建绑定当前 Agent/Workspace 执行范围的 Power 调用面。
   *
   * Registry 保存 City 已发布的唯一 Power 集合；Action、Hook、System 与 availability
   * 在每次调用时使用 Context 工厂创建目标 Power 的动态上下文。
   */
  contextual(context_factory: PowerContextFactory): AgentPowerRuntime {
    return {
      has: (power_name) => this.has(power_name),
      get: (power_name) => this.get(power_name),
      status: (power_name) => this.status(power_name),
      snapshots: () => this.snapshots(),
      list: () => this.list(),
      read: (params) => this.read(params),
      availability: async (power_name) =>
        await this.availability(context_factory, power_name),
      run_action: async (params) =>
        await this.run_action({ context_factory, ...params }),
      system_blocks: async (execution_context) =>
        await this.system_blocks(context_factory, execution_context),
      pipeline: async (point_name, value) =>
        await this.pipeline(context_factory, point_name, value),
      guard: async (point_name, value) =>
        await this.guard(context_factory, point_name, value),
      effect: async (point_name, value) =>
        await this.effect(context_factory, point_name, value),
      resolve: async (point_name, value) =>
        await this.resolve(context_factory, point_name, value),
    };
  }

  /**
   * 注册单个 power。
   *
   * 说明（中文）
   * - 同名注册表示替换：旧执行视图立即退休，新执行视图立即生效。
   * - Power 生命周期已经由 City 完成，Registry 不执行任何生命周期回调。
   */
  async register(power: PowerDefinition): Promise<PowerSnapshot> {
    const key = normalize_power_name(power.name);
    if (!key) {
      throw new Error("Power name is required");
    }
    if (this.records.has(key)) {
      await this.unregister(key);
    }

    return this.register_sync(power);
  }

  /** 同步注册一个已经由 City 启动的 Power 执行实例。 */
  private register_sync(power: PowerDefinition): PowerSnapshot {
    const key = normalize_power_name(power.name);
    if (!key) {
      throw new Error("Power name is required");
    }
    if (this.records.has(key)) {
      throw new Error(`Power already registered: ${key}`);
    }
    this.assert_resolve_points_available(power);

    const record = create_record(power);
    this.records.set(key, record);
    this.publish_change({ type: "register", power_name: key });
    return to_power_snapshot(record);
  }

  /**
   * 从 configured registry 卸载指定 power。
   *
   * 关键点（中文）
   * - configured registry、hooks 与直接调用入口立即移除。
   * - 当前活跃 Session step 继续使用已捕获的执行记录。
   * - 该方法返回配置修改结果，不等待仍在运行的 step 结束。
   */
  async unregister(power_name: string): Promise<boolean> {
    const key = normalize_power_name(power_name);
    if (!key) return false;
    const record = this.records.get(key);
    if (!record) return false;

    this.records.delete(key);
    this.retire_record(record);
    this.publish_change({ type: "unregister", power_name: key });
    return true;
  }

  /**
   * 从 configured registry 卸载指定 Power，并等待全部 execution lease 释放。
   *
   * City 在停止 Power 实例前必须使用该入口，避免实例早于运行中的
   * Session Step 被释放。
   */
  async unregister_and_wait(power_name: string): Promise<boolean> {
    const key = normalize_power_name(power_name);
    const record = this.records.get(key);
    if (!record) return false;
    const removed = await this.unregister(key);
    await record.retirement_promise;
    return removed;
  }

  /** 将 Power 配置变化发布给 Agent 等持有者。 */
  private publish_change(change: PowerRegistryChange): void {
    for (const subscriber of this.change_subscribers) {
      try {
        subscriber(change);
      } catch {
        // 观察者失败不能回滚已经完成的 Power 配置修改。
      }
    }
  }

  /**
   * 卸载全部 power。
   */
  async unregister_all(): Promise<void> {
    for (const name of Array.from(this.records.keys())) {
      await this.unregister(name);
    }
    const retirements = Array.from(this.retired_records)
      .map((record) => record.retirement_promise)
      .filter((promise): promise is Promise<void> => Boolean(promise));
    await Promise.all(retirements);
  }

  /**
   * 判断 power 是否已注册且 ready。
   */
  is_ready(power_name: string): boolean {
    return this.records.has(normalize_power_name(power_name));
  }

  /**
   * 读取单个 power 快照。
   */
  status(power_name: string): PowerSnapshot | null {
    const record = this.records.get(normalize_power_name(power_name));
    return record ? to_power_snapshot(record) : null;
  }

  /**
   * 判断 power 是否已注册。
   */
  has(power_name: string): boolean {
    return this.records.has(normalize_power_name(power_name));
  }

  /** 校验 resolve 点仍满足单点单处理器约束。 */
  private assert_resolve_points_available(power: PowerDefinition): void {
    for (const point_name of Object.keys(power.resolves || {})) {
      const conflict = [...this.records.values()].some(
        (record) => Boolean(record.power.resolves?.[point_name]),
      );
      if (conflict) throw new Error(`Resolve point already registered: ${point_name}`);
    }
  }

  /**
   * 运行 pipeline 点。
   */
  async pipeline<T = JsonValue>(
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<T> {
    return await this.pipeline_from_records(this.records, context_factory, point_name, value);
  }

  /**
   * 运行 guard 点。
   */
  async guard<T = JsonValue>(
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<void> {
    await this.guard_from_records(this.records, context_factory, point_name, value);
  }

  /**
   * 运行 effect 点。
   */
  async effect<T = JsonValue>(
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<void> {
    await this.effect_from_records(this.records, context_factory, point_name, value);
  }

  /**
   * 运行 resolve 点。
   */
  async resolve<TInput = JsonValue, TOutput = JsonValue>(
    context_factory: PowerContextFactory,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    return await this.resolve_from_records<TInput, TOutput>(
      this.records,
      context_factory,
      point_name,
      value,
    );
  }

  /**
   * 获取单个 power 定义。
   */
  get(power_name: string): PowerDefinition | null {
    return this.records.get(normalize_power_name(power_name))?.power || null;
  }

  /**
   * 列出全部 power 概览视图。
   */
  list(): PowerView[] {
    return Array.from(this.records.values())
      .map((record) => to_power_view(record.power))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 列出全部 power 注册快照。
   */
  snapshots(): PowerSnapshot[] {
    return Array.from(this.records.values())
      .map((record) => to_power_snapshot(record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 读取 action metadata。
   */
  private readAction(
    action_name: string,
    action: NonNullable<PowerDefinition["actions"]>[string],
  ): PowerActionReadView {
    return {
      name: action_name,
      description: String(action.description || "").trim(),
      access: action.access === "write" ? "write" : "read",
      returns: String(action.returns || "").trim(),
      has_input_schema: Boolean(action.input_schema),
      ...(action.input_schema?.json_schema
        ? { input_schema: action.input_schema.json_schema }
        : {}),
      ...(action.examples ? { examples: action.examples } : {}),
      has_command: Boolean(action.command),
      has_api: Boolean(action.api),
    };
  }

  /**
   * 读取 power / action metadata。
   */
  read(params: {
    power?: string;
    action?: string;
  }): PowerReadView | { powers: PowerView[] } {
    return this.read_from_records(this.records, params);
  }

  /**
   * 从指定记录视图读取 power/action metadata。
   */
  private read_from_records(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    params: { power?: string; action?: string },
  ): PowerReadView | { powers: PowerView[] } {
    const power_name = normalize_power_name(params.power || "");
    if (!power_name) {
      return {
        powers: Array.from(records.values())
          .map((record) => to_power_view(record.power))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    }
    const power = records.get(power_name)?.power || null;
    if (!power) {
      throw new Error(`Unknown power: ${power_name}`);
    }
    const action_name = normalize_power_name(params.action || "");
    if (action_name && !power.actions?.[action_name]) {
      throw new Error(`Unknown action: ${power_name}.${action_name}`);
    }
    const actions = Object.entries(power.actions || {})
      .filter(([name]) => !action_name || name === action_name)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, action]) => this.readAction(name, action));
    return {
      name: power.name,
      title: String(power.title || power.name || "").trim(),
      description: String(power.description || "").trim(),
      actions,
    };
  }

  /**
   * 检查 power 可用性。
   */
  async availability(
    context_factory: PowerContextFactory,
    power_name: string,
  ): Promise<PowerAvailability> {
    return await this.availability_from_records(this.records, context_factory, power_name);
  }

  /** 从指定执行记录视图检查 Power 可用性。 */
  private async availability_from_records(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    power_name: string,
  ): Promise<PowerAvailability> {
    const key = normalize_power_name(power_name);
    const record = records.get(key);
    if (!record) {
      return {
        enabled: false,
        available: false,
        reasons: [`Unknown power: ${power_name}`],
      };
    }

    if (record.power.availability) {
      return await record.power.availability(context_factory(key));
    }

    return {
      enabled: true,
      available: true,
      reasons: [],
    };
  }

  /**
   * 运行 power action。
   */
  async run_action(params: {
    context_factory: PowerContextFactory;
    power: string;
    action: string;
    payload?: JsonValue;
    execution_context?: PowerExecutionContext;
    interactions?: SessionInteractionPort;
  }): Promise<PowerActionResult<JsonValue>> {
    return await this.run_action_from_records(this.records, params.context_factory, params);
  }

  /**
   * 从指定记录视图运行 power action。
   */
  private async run_action_from_records(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    params: {
      power: string;
      action: string;
      payload?: JsonValue;
      execution_context?: PowerExecutionContext;
      interactions?: SessionInteractionPort;
    },
  ): Promise<PowerActionResult<JsonValue>> {
    const key = normalize_power_name(params.power);
    const record = records.get(key);
    if (!record) {
      return {
        success: false,
        error: `Unknown power: ${params.power}`,
        message: `Unknown power: ${params.power}`,
      };
    }

    const action_name = normalize_power_name(params.action);
    if (!action_name) {
      return {
        success: false,
        error: "action is required",
        message: "action is required",
      };
    }

    const action = record.power.actions?.[action_name];
    if (!action) {
      return {
        success: false,
        error: `Power "${record.power.name}" does not implement action "${action_name}"`,
        message: `Power "${record.power.name}" does not implement action "${action_name}"`,
      };
    }

    return await execute_power_action({
      context: context_factory(record.power.name),
      power_name: record.power.name,
      action_name,
      action,
      payload: (params.payload ?? {}) as JsonValue,
      ...(params.execution_context
        ? { snapshot: params.execution_context }
        : {}),
      ...(params.interactions ? { interactions: params.interactions } : {}),
    });
  }

  /**
   * 读取当前生效的 power system blocks。
   */
  async system_blocks(
    context_factory: PowerContextFactory,
    execution_context?: PowerExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    return await this.system_blocks_from_records(
      this.records,
      context_factory,
      execution_context,
    );
  }

  /**
   * 从指定记录视图解析 power system blocks。
   */
  private async system_blocks_from_records(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    execution_context?: PowerExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    const out: AgentSessionSystemBlock[] = [];
    for (const record of records.values()) {
      const power = record.power;
      if (typeof power.system !== "function") continue;
      try {
        if (typeof power.availability === "function") {
          const power_context = context_factory(power.name);
          const availability = await power.availability(power_context);
          if (!availability.available) continue;
        }
        const text = String(
          await power.system(
            context_factory(power.name),
            execution_context,
          ),
        ).trim();
        if (!text) continue;
        out.push({
          source: "power",
          name: power.name,
          content: text,
        });
      } catch {
        // 单个 power system 失败不应阻断 session 主链路。
      }
    }
    return out;
  }

  /** 在指定 Power execution snapshot 中运行既有 pipeline handlers。 */
  private async pipeline_from_records<T>(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<T> {
    const key = String(point_name || "").trim();
    if (!key) return value;
    let current = value as JsonValue;
    for (const record of records.values()) {
      const handlers = record.power.hooks?.pipeline?.[key] || [];
      for (const handler of handlers) {
        current = await handler({
          context: context_factory(record.power.name),
          value: current,
          power: record.power.name,
        });
      }
    }
    return current as T;
  }

  /** 在指定 Power execution snapshot 中运行既有 effect handlers。 */
  private async effect_from_records<T>(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of records.values()) {
      const handlers = record.power.hooks?.effect?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: context_factory(record.power.name),
          value: value as JsonValue,
          power: record.power.name,
        });
      }
    }
  }

  /** 在指定 Power execution snapshot 中运行既有 guard handlers。 */
  private async guard_from_records<T>(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of records.values()) {
      const handlers = record.power.hooks?.guard?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: context_factory(record.power.name),
          value: value as JsonValue,
          power: record.power.name,
        });
      }
    }
  }

  /** 在指定 Power execution snapshot 中运行唯一的 resolve handler。 */
  private async resolve_from_records<TInput, TOutput>(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    const key = String(point_name || "").trim();
    if (!key) throw new Error("Resolve point name is required");
    for (const record of records.values()) {
      const handler = record.power.resolves?.[key];
      if (!handler) continue;
      return await handler({
        context: context_factory(record.power.name),
        value: value as JsonValue,
        power: record.power.name,
      }) as TOutput;
    }
    throw new Error(`No power resolver registered for point: ${key}`);
  }

  /**
   * 创建当前 configured registry 的 Session step 执行视图。
   */
  execution_view(context_factory: PowerContextFactory): AgentPowerExecutionRuntime {
    const records = new Map(this.records);
    return {
      read: (params) => this.read_from_records(records, params),
      availability: async (power_name) =>
        await this.availability_from_records(records, context_factory, power_name),
      run_action: async (params) =>
        await this.run_action_from_records(records, context_factory, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(records, context_factory, execution_context),
      pipeline: async (point_name, value) =>
        await this.pipeline_from_records(records, context_factory, point_name, value),
      guard: async (point_name, value) =>
        await this.guard_from_records(records, context_factory, point_name, value),
      effect: async (point_name, value) =>
        await this.effect_from_records(records, context_factory, point_name, value),
      resolve: async (point_name, value) =>
        await this.resolve_from_records(records, context_factory, point_name, value),
      acquire: () => this.acquire_execution_view(records, context_factory),
    };
  }

  /**
   * 为单次 Session step 获取 Power execution lease。
   */
  private acquire_execution_view(
    records: ReadonlyMap<string, PowerRuntimeRecord>,
    context_factory: PowerContextFactory,
  ): AgentPowerExecutionLease {
    const leased_records = new Map<string, PowerRuntimeRecord>();
    for (const [name, record] of records) {
      if (record.retired) {
        continue;
      }
      record.active_execution_leases += 1;
      leased_records.set(name, record);
    }

    let released = false;
    return {
      read: (params) => this.read_from_records(leased_records, params),
      availability: async (power_name) =>
        await this.availability_from_records(leased_records, context_factory, power_name),
      run_action: async (params) =>
        await this.run_action_from_records(leased_records, context_factory, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(
          leased_records,
          context_factory,
          execution_context,
        ),
      pipeline: async (point_name, value) =>
        await this.pipeline_from_records(
          leased_records,
          context_factory,
          point_name,
          value,
        ),
      guard: async (point_name, value) =>
        await this.guard_from_records(
          leased_records,
          context_factory,
          point_name,
          value,
        ),
      effect: async (point_name, value) =>
        await this.effect_from_records(
          leased_records,
          context_factory,
          point_name,
          value,
        ),
      resolve: async (point_name, value) =>
        await this.resolve_from_records(
          leased_records,
          context_factory,
          point_name,
          value,
        ),
      release: async () => {
        if (released) return;
        released = true;
        const retirements: Promise<void>[] = [];
        for (const record of leased_records.values()) {
          record.active_execution_leases = Math.max(
            0,
            record.active_execution_leases - 1,
          );
          this.try_finalize_retired_record(record);
          if (record.retired && record.retirement_promise) {
            retirements.push(record.retirement_promise);
          }
        }
        await Promise.all(retirements);
      },
    };
  }

  /**
   * 把已移出 configured registry 的 Power 标记为等待释放。
   */
  private retire_record(record: PowerRuntimeRecord): void {
    if (record.retired) return;
    record.retired = true;
    let resolve_retirement!: () => void;
    record.retirement_promise = new Promise<void>((resolve) => {
      resolve_retirement = resolve;
    });
    record.resolve_retirement = resolve_retirement;
    this.retired_records.add(record);
    this.try_finalize_retired_record(record);
  }

  /** 在最后一个 execution lease 释放后完成退休等待。 */
  private try_finalize_retired_record(record: PowerRuntimeRecord): void {
    if (!record.retired || record.active_execution_leases > 0) return;
    this.retired_records.delete(record);
    record.resolve_retirement?.();
    delete record.resolve_retirement;
  }
}
