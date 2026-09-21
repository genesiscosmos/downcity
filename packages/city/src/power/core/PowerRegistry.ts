/**
 * City Power 的 Agent 执行 Registry。
 *
 * 关键点（中文）
 * - Registry 只持有 City Power 唯一实例，不拥有实例生命周期。
 * - 不存在 execution lease：调用是一次性的，不持有实例引用计数。
 * - 工具与 Hook 在这里编译成 Agent 可直接调用的产物；执行时只有编译产物与
 *   容器运行时端口参与，不再回到 Registry 做二次查找。
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
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { PowerCallSite, PowerCallSiteOverride, PowerRuntimeHost } from "@/power/types/PowerCallSite.js";
import type { PowerSnapshot } from "@/power/index.js";
import type { PowerRuntimeRecord } from "@/power/types/PowerRuntimeRecord.js";
import type { AgentTool as Tool, JsonValue, ToolHookSet } from "@downcity/type";
import type {
  EffectHook,
  GuardHook,
  PipelineHook,
} from "@downcity/type";
import { execute_power_action } from "@/power/core/PowerActionExecution.js";
import type {
  PowerRegistryChange,
  PowerRegistrySubscriber,
  PowerRegistryUnsubscribe,
} from "@/power/types/PowerRegistry.js";

function normalize_power_name(power_name: string): string {
  return String(power_name || "").trim();
}

/** 按检查点合并多个 Power 的处理器；顺序由输入顺序决定。 */
function merge_tool_hook_sets(sets: readonly ToolHookSet[]): ToolHookSet {
  const pipeline: Record<string, readonly PipelineHook[]> = {};
  const guard: Record<string, readonly GuardHook[]> = {};
  const effect: Record<string, readonly EffectHook[]> = {};
  const append = <THandler>(
    target: Record<string, readonly THandler[]>,
    source: Readonly<Record<string, readonly THandler[]>>,
  ): void => {
    for (const [point_name, handlers] of Object.entries(source)) {
      target[point_name] = [...(target[point_name] ?? []), ...handlers];
    }
  };
  for (const set of sets) {
    append(pipeline, set.pipeline);
    append(guard, set.guard);
    append(effect, set.effect);
  }
  return Object.freeze({
    pipeline: Object.freeze(pipeline),
    guard: Object.freeze(guard),
    effect: Object.freeze(effect),
  });
}

function create_record(power: PowerDefinition): PowerRuntimeRecord {
  return {
    power,
    registered_at: Date.now(),
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
 * PowerRegistry：City 唯一 Power 注册与调用实现。
 */
export class PowerRegistry {
  private readonly records = new Map<string, PowerRuntimeRecord>();

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
   * 把当前 Power 集合编译为 Agent 可直接调用的工具。
   *
   * 关键点（中文）：编译由各 Power 自己完成；Registry 只负责集合与查询。
   */
  tools(host: PowerRuntimeHost): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const power of this.active_definitions()) {
      const tool = power.compile_tool(host);
      if (!tool) continue;
      tools[String(power.name || "").trim()] = tool;
    }
    return tools;
  }

  /** 把当前 Power 集合编译为按检查点索引的处理器。 */
  hooks(host: PowerRuntimeHost): ToolHookSet {
    return merge_tool_hook_sets(
      this.active_definitions().map((power) => power.compile_hooks(host)),
    );
  }

  /** 返回当前仍然有效的 power 定义，顺序稳定。 */
  private active_definitions(): PowerDefinition[] {
    return Array.from(this.records.values())
      .filter((record) => !record.retired)
      .map((record) => record.power)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * 创建绑定当前调用来源的 Power 调用面。
   *
   * 关键点（中文）：只服务 Power 之间的嵌套调用，不进入 Agent；
   * 来源身份由容器闭合，调用方无法伪造或丢失。
   */
  powers_for(host: PowerRuntimeHost, site: PowerCallSite): AgentPowerRuntime {
    return {
      has: (power_name) => this.has(power_name),
      get: (power_name) => this.get(power_name),
      status: (power_name) => this.status(power_name),
      snapshots: () => this.snapshots(),
      list: () => this.list(),
      read: (params) => this.read(params),
      availability: async (power_name) =>
        await this.availability(host, site, power_name),
      run_action: async (params) => await this.run_action({
        host,
        site,
        power: params.power,
        action: params.action,
        ...(params.payload === undefined ? {} : { payload: params.payload }),
        ...(params.execution_context ? { execution_context: params.execution_context } : {}),
      }),
      pipeline: async (point_name, value) =>
        await this.pipeline(host, site, point_name, value),
      guard: async (point_name, value) =>
        await this.guard(host, site, point_name, value),
      effect: async (point_name, value) =>
        await this.effect(host, site, point_name, value),
      resolve: async (point_name, value) =>
        await this.resolve(host, site, point_name, value),
    };
  }

  /**
   * 注册单个 power。
   *
   * 说明（中文）：同名注册表示替换；Power 生命周期已经由 City 完成。
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

    const record = create_record(power);
    this.records.set(key, record);
    this.publish_change({ type: "register", power_name: key });
    return to_power_snapshot(record);
  }

  /**
   * 从 Registry 卸载指定 power。
   *
   * 关键点（中文）：配置与调用入口立即移除；已经在执行的调用按各自实现自行收口。
   */
  async unregister(power_name: string): Promise<boolean> {
    const key = normalize_power_name(power_name);
    if (!key) return false;
    const record = this.records.get(key);
    if (!record) return false;

    this.records.delete(key);
    this.publish_change({ type: "unregister", power_name: key });
    return true;
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

  /** 卸载全部 power。 */
  async unregister_all(): Promise<void> {
    for (const name of Array.from(this.records.keys())) {
      await this.unregister(name);
    }
  }

  /** 判断 power 是否已注册且 ready。 */
  is_ready(power_name: string): boolean {
    return this.records.has(normalize_power_name(power_name));
  }

  /** 读取单个 power 快照。 */
  status(power_name: string): PowerSnapshot | null {
    const record = this.records.get(normalize_power_name(power_name));
    return record ? to_power_snapshot(record) : null;
  }

  /** 判断 power 是否已注册。 */
  has(power_name: string): boolean {
    return this.records.has(normalize_power_name(power_name));
  }

  /** 运行 pipeline 点。 */
  async pipeline<T = JsonValue>(
    host: PowerRuntimeHost,
    site: PowerCallSite,
    point_name: string,
    value: T,
  ): Promise<T> {
    const key = String(point_name || "").trim();
    if (!key) return value;
    let current = value as JsonValue;
    for (const record of this.records.values()) {
      const handlers = record.power.hooks?.pipeline?.[key] || [];
      for (const handler of handlers) {
        current = await handler({
          context: host.context_for(record.power.name, site),
          value: current,
          power: record.power.name,
        });
      }
    }
    return current as T;
  }

  /** 运行 guard 点。 */
  async guard<T = JsonValue>(
    host: PowerRuntimeHost,
    site: PowerCallSite,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of this.records.values()) {
      const handlers = record.power.hooks?.guard?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: host.context_for(record.power.name, site),
          value: value as JsonValue,
          power: record.power.name,
        });
      }
    }
  }

  /** 运行 effect 点。 */
  async effect<T = JsonValue>(
    host: PowerRuntimeHost,
    site: PowerCallSite,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of this.records.values()) {
      const handlers = record.power.hooks?.effect?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: host.context_for(record.power.name, site),
          value: value as JsonValue,
          power: record.power.name,
        });
      }
    }
  }

  /** 运行 resolve 点；要求存在且仅存在一个处理器。 */
  async resolve<TInput = JsonValue, TOutput = JsonValue>(
    host: PowerRuntimeHost,
    site: PowerCallSite,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    const key = String(point_name || "").trim();
    if (!key) throw new Error("Resolve point name is required");
    for (const record of this.records.values()) {
      const handler = record.power.resolves?.[key];
      if (!handler) continue;
      return await handler({
        context: host.context_for(record.power.name, site),
        value: value as JsonValue,
        power: record.power.name,
      }) as TOutput;
    }
    throw new Error(`No power resolver registered for point: ${key}`);
  }

  /** 获取单个 power 定义。 */
  get(power_name: string): PowerDefinition | null {
    return this.records.get(normalize_power_name(power_name))?.power || null;
  }

  /** 列出全部 power 概览视图。 */
  list(): PowerView[] {
    return Array.from(this.records.values())
      .map((record) => to_power_view(record.power))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 列出全部 power 注册快照。 */
  snapshots(): PowerSnapshot[] {
    return Array.from(this.records.values())
      .map((record) => to_power_snapshot(record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 读取 action metadata。 */
  private read_action(
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

  /** 读取 power / action metadata。 */
  read(params: {
    power?: string;
    action?: string;
  }): PowerReadView | { powers: PowerView[] } {
    const power_name = normalize_power_name(params.power || "");
    if (!power_name) {
      return { powers: this.list() };
    }
    const power = this.records.get(power_name)?.power || null;
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
      .map(([name, action]) => this.read_action(name, action));
    return {
      name: power.name,
      title: String(power.title || power.name || "").trim(),
      description: String(power.description || "").trim(),
      actions,
    };
  }

  /** 检查 power 可用性。 */
  async availability(
    host: PowerRuntimeHost,
    site: PowerCallSite,
    power_name: string,
  ): Promise<PowerAvailability> {
    const key = normalize_power_name(power_name);
    const record = this.records.get(key);
    if (!record) {
      return {
        enabled: false,
        available: false,
        reasons: [`Unknown power: ${power_name}`],
      };
    }
    if (record.power.availability) {
      return await record.power.availability(
        host.context_for(key, site),
      );
    }
    return { enabled: true, available: true, reasons: [] };
  }

  /** 运行 power action。 */
  async run_action(params: {
    host: PowerRuntimeHost;
    site: PowerCallSite;
    /** 调用身份覆盖；与 site 合并后使用。 */
    execution_context?: PowerCallSiteOverride;
    power: string;
    action: string;
    payload?: JsonValue;
  }): Promise<PowerActionResult<JsonValue>> {
    const key = normalize_power_name(params.power);
    const record = this.records.get(key);
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
      host: params.host,
      power_name: record.power.name,
      action_name,
      action,
      payload: (params.payload ?? {}) as JsonValue,
      site: params.execution_context
        ? { ...params.site, ...params.execution_context }
        : params.site,
    });
  }
}
