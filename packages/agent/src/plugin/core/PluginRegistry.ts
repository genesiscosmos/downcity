/**
 * Agent plugin runtime。
 *
 * 关键点（中文）
 * - Plugin 只属于 Agent：注册即生效，卸载即不可见。
 * - 注册时自动启动 plugin lifecycle；卸载时自动停止 plugin lifecycle。
 * - action、system、hook、resolve 都统一以“已注册且 ready”为生效边界。
 */

import { to_plugin_view } from "@/plugin/core/PluginCatalog.js";
import { HookRegistry } from "@/plugin/core/HookRegistry.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginActionResult } from "@/types/plugin/PluginAction.js";
import type {
  AgentPlugins,
  AgentPluginExecutionLease,
  AgentPluginExecutionRuntime,
  PluginAvailability,
  PluginActionReadView,
  PluginReadView,
  PluginView,
} from "@/types/plugin/PluginRuntime.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { JsonValue } from "@/types/common/Json.js";
import type {
  PluginRuntimeRecord,
  PluginSnapshot,
} from "@/types/plugin/PluginState.js";
import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";
import type { Tool } from "ai";
import { create_plugin_tools } from "@executor/tools/plugin/PluginToolDefinition.js";
import type {
  PluginRegistryChange,
  PluginRegistrySubscriber,
  PluginRegistryUnsubscribe,
} from "@/types/plugin/PluginRegistry.js";

function now_ms(): number {
  return Date.now();
}

function normalize_plugin_name(plugin_name: string): string {
  return String(plugin_name || "").trim();
}

function create_record(plugin: Plugin): PluginRuntimeRecord {
  const current_time = now_ms();
  return {
    plugin,
    state: "ready",
    registered_at: current_time,
    updated_at: current_time,
    chain: Promise.resolve(),
    lifecycle_started: false,
    active_execution_leases: 0,
    retired: false,
    retirement_started: false,
  };
}

function to_plugin_snapshot(record: PluginRuntimeRecord): PluginSnapshot {
  const plugin = record.plugin;
  const last_error = String(record.last_error || "").trim();
  return {
    name: plugin.name,
    title: String(plugin.title || plugin.name || "").trim(),
    description: String(plugin.description || "").trim(),
    status: record.state,
    registered_at: record.registered_at,
    updated_at: record.updated_at,
    ...(last_error ? { last_error } : {}),
  };
}

function update_record_state(
  record: PluginRuntimeRecord,
  state: PluginRuntimeRecord["state"],
  error?: string,
): void {
  record.state = state;
  record.updated_at = now_ms();
  const normalized_error = String(error || "").trim();
  if (normalized_error) {
    record.last_error = normalized_error;
  } else {
    delete record.last_error;
  }
}

async function run_serial(
  record: PluginRuntimeRecord,
  step: () => Promise<void> | void,
): Promise<void> {
  const next = record.chain.then(() => Promise.resolve(step()));
  record.chain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

/**
 * PluginRegistry：Agent plugin 注册、卸载与调用实现。
 */
export class PluginRegistry implements AgentPlugins {
  private context?: PluginContext;

  private readonly hookRegistry: HookRegistry;

  private readonly records = new Map<string, PluginRuntimeRecord>();

  private readonly retired_records = new Set<PluginRuntimeRecord>();

  /** Plugin 配置变化订阅器。 */
  private readonly change_subscribers = new Set<PluginRegistrySubscriber>();

  constructor(plugins: Plugin[] = []) {
    this.hookRegistry = new HookRegistry({
      get_context: () => this.require_context(),
      is_plugin_ready: (plugin_name) => this.is_ready(plugin_name),
    });
    for (const plugin of plugins) {
      this.mount(plugin);
    }
  }

  /**
   * 绑定当前 Registry 所属的唯一 PluginContext。
   *
   * 关键点（中文）
   * - 初始 Plugin 可以在 Context 创建前同步挂载。
   * - lifecycle、action、hook 首次执行前必须完成绑定。
   */
  bind_context(context: PluginContext): void {
    if (this.context && this.context !== context) {
      throw new Error("PluginRegistry context is already bound");
    }
    this.context = context;
  }

  /** 返回已经绑定的 PluginContext。 */
  private require_context(): PluginContext {
    if (!this.context) {
      throw new Error("PluginRegistry context is not bound");
    }
    return this.context;
  }

  /** 订阅 Plugin 配置的后续变化。 */
  subscribe_change(
    subscriber: PluginRegistrySubscriber,
  ): PluginRegistryUnsubscribe {
    this.change_subscribers.add(subscriber);
    return () => {
      this.change_subscribers.delete(subscriber);
    };
  }

  /**
   * 返回当前 Registry 向 Agent 提供的 Plugin Tools。
   *
   * 关键点（中文）
   * - 没有任何 Action 时不暴露空壳 Tool。
   * - Tool 闭包绑定当前 Registry，动态 Plugin 变化无需重建 bridge。
   */
  tools(): Record<string, Tool> {
    if (!this.list().some((plugin) => plugin.actions.length > 0)) return {};
    return { ...create_plugin_tools({ plugins: this }) };
  }

  /**
   * 注册单个 plugin。
   *
   * 说明（中文）
   * - 同名注册表示替换：先卸载旧实例，再注册并启动新实例。
   * - 如果新实例启动失败，会自动回滚为未注册状态并抛错。
   */
  async register(plugin: Plugin): Promise<PluginSnapshot> {
    const key = normalize_plugin_name(plugin.name);
    if (!key) {
      throw new Error("Plugin name is required");
    }
    if (this.records.has(key)) {
      await this.unregister(key);
    }

    const record = create_record(plugin);
    this.records.set(key, record);
    this.register_hooks(plugin);

    try {
      await this.start_record(record);
      this.publish_change({ type: "register", plugin_name: key });
      return to_plugin_snapshot(record);
    } catch (error) {
      this.unregister_hooks(key);
      this.records.delete(key);
      throw error;
    }
  }

  /**
   * 同步挂载 plugin 元信息。
   *
   * 说明（中文）
   * - 仅供 Agent 构造期使用，避免构造函数里 await。
   * - 后续 `start_all()` 会统一启动这些初始 plugin。
   */
  mount(plugin: Plugin): PluginSnapshot {
    const key = normalize_plugin_name(plugin.name);
    if (!key) {
      throw new Error("Plugin name is required");
    }
    if (this.records.has(key)) {
      throw new Error(`Plugin already registered: ${key}`);
    }

    const record = create_record(plugin);
    this.records.set(key, record);
    this.register_hooks(plugin);
    return to_plugin_snapshot(record);
  }

  /**
   * 从 configured registry 卸载指定 plugin。
   *
   * 关键点（中文）
   * - configured registry、hooks 与直接调用入口立即移除。
   * - lifecycle.stop 等当前活跃 Session step 的 execution lease 全部释放后执行。
   * - 该方法返回配置修改结果，不等待仍在运行的 step 结束。
   */
  async unregister(plugin_name: string): Promise<boolean> {
    const key = normalize_plugin_name(plugin_name);
    if (!key) return false;
    const record = this.records.get(key);
    if (!record) return false;

    this.unregister_hooks(key);
    this.records.delete(key);
    this.retire_record(record);
    this.publish_change({ type: "unregister", plugin_name: key });
    return true;
  }

  /** 将 Plugin 配置变化发布给 Agent 等持有者。 */
  private publish_change(change: PluginRegistryChange): void {
    for (const subscriber of this.change_subscribers) {
      try {
        subscriber(change);
      } catch {
        // 观察者失败不能回滚已经完成的 Plugin 配置修改。
      }
    }
  }

  /**
   * 启动全部已挂载 plugin。
   */
  async start_all(): Promise<PluginSnapshot[]> {
    const snapshots: PluginSnapshot[] = [];
    for (const record of this.records.values()) {
      try {
        await this.start_record(record);
      } catch {
        // 关键点（中文）：单个 plugin 启动失败只影响自身，不能阻断其他 plugin 与 Agent ready。
      }
      snapshots.push(to_plugin_snapshot(record));
    }
    return snapshots;
  }

  /**
   * 卸载全部 plugin。
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
   * 判断 plugin 是否已注册且 ready。
   */
  is_ready(plugin_name: string): boolean {
    const record = this.records.get(normalize_plugin_name(plugin_name));
    return Boolean(record && record.state === "ready");
  }

  /**
   * 读取单个 plugin 快照。
   */
  status(plugin_name: string): PluginSnapshot | null {
    const record = this.records.get(normalize_plugin_name(plugin_name));
    return record ? to_plugin_snapshot(record) : null;
  }

  /**
   * 判断 plugin 是否已注册。
   */
  has(plugin_name: string): boolean {
    return this.records.has(normalize_plugin_name(plugin_name));
  }

  private register_hooks(plugin: Plugin): void {
    const key = normalize_plugin_name(plugin.name);
    for (const [hookName, handlers] of Object.entries(
      plugin.hooks?.pipeline || {},
    )) {
      for (const handler of handlers) {
        this.hookRegistry.pipeline(hookName, key, handler);
      }
    }

    for (const [hookName, handlers] of Object.entries(
      plugin.hooks?.guard || {},
    )) {
      for (const handler of handlers) {
        this.hookRegistry.guard(hookName, key, handler);
      }
    }

    for (const [hookName, handlers] of Object.entries(
      plugin.hooks?.effect || {},
    )) {
      for (const handler of handlers) {
        this.hookRegistry.effect(hookName, key, handler);
      }
    }

    for (const [point_name, handler] of Object.entries(plugin.resolves || {})) {
      this.hookRegistry.resolve(point_name, key, handler);
    }
  }

  private unregister_hooks(plugin_name: string): void {
    this.hookRegistry.unregister_plugin(plugin_name);
  }

  private async start_record(record: PluginRuntimeRecord): Promise<void> {
    if (record.lifecycle_started) {
      update_record_state(record, "ready");
      return;
    }
    await run_serial(record, async () => {
      if (record.lifecycle_started) {
        update_record_state(record, "ready");
        return;
      }
      try {
        await record.plugin.lifecycle?.start?.(this.require_context());
        record.lifecycle_started = true;
        update_record_state(record, "ready");
      } catch (error) {
        update_record_state(record, "error", String(error));
        throw error;
      }
    });
  }

  private async stop_record(record: PluginRuntimeRecord): Promise<void> {
    await run_serial(record, async () => {
      if (!record.lifecycle_started) return;
      try {
        await record.plugin.lifecycle?.stop?.(this.require_context());
      } finally {
        record.lifecycle_started = false;
        record.updated_at = now_ms();
      }
    });
  }

  /**
   * 运行 pipeline 点。
   */
  async pipeline<T = JsonValue>(point_name: string, value: T): Promise<T> {
    return this.hookRegistry.pipelineValue(point_name, value);
  }

  /**
   * 运行 guard 点。
   */
  async guard<T = JsonValue>(point_name: string, value: T): Promise<void> {
    return this.hookRegistry.guardValue(point_name, value);
  }

  /**
   * 运行 effect 点。
   */
  async effect<T = JsonValue>(point_name: string, value: T): Promise<void> {
    return this.hookRegistry.effectValue(point_name, value);
  }

  /**
   * 运行 resolve 点。
   */
  async resolve<TInput = JsonValue, TOutput = JsonValue>(
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    return this.hookRegistry.resolveValue<TInput, TOutput>(point_name, value);
  }

  /**
   * 获取单个 plugin 定义。
   */
  get(plugin_name: string): Plugin | null {
    return this.records.get(normalize_plugin_name(plugin_name))?.plugin || null;
  }

  /**
   * 列出全部 plugin 概览视图。
   */
  list(): PluginView[] {
    return Array.from(this.records.values())
      .map((record) => to_plugin_view(record.plugin))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 列出全部 plugin 注册快照。
   */
  snapshots(): PluginSnapshot[] {
    return Array.from(this.records.values())
      .map((record) => to_plugin_snapshot(record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 读取 action metadata。
   */
  private readAction(
    action_name: string,
    action: NonNullable<Plugin["actions"]>[string],
  ): PluginActionReadView {
    return {
      name: action_name,
      description: String(action.description || "").trim(),
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
   * 读取 plugin / action metadata。
   */
  read(params: {
    plugin?: string;
    action?: string;
  }): PluginReadView | { plugins: PluginView[] } {
    return this.read_from_records(this.records, params);
  }

  /**
   * 从指定记录视图读取 plugin/action metadata。
   */
  private read_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    params: { plugin?: string; action?: string },
  ): PluginReadView | { plugins: PluginView[] } {
    const plugin_name = normalize_plugin_name(params.plugin || "");
    if (!plugin_name) {
      return {
        plugins: Array.from(records.values())
          .map((record) => to_plugin_view(record.plugin))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    }
    const plugin = records.get(plugin_name)?.plugin || null;
    if (!plugin) {
      throw new Error(`Unknown plugin: ${plugin_name}`);
    }
    const action_name = normalize_plugin_name(params.action || "");
    if (action_name && !plugin.actions?.[action_name]) {
      throw new Error(`Unknown action: ${plugin_name}.${action_name}`);
    }
    const actions = Object.entries(plugin.actions || {})
      .filter(([name]) => !action_name || name === action_name)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, action]) => this.readAction(name, action));
    return {
      name: plugin.name,
      title: String(plugin.title || plugin.name || "").trim(),
      description: String(plugin.description || "").trim(),
      actions,
    };
  }

  /**
   * 检查 plugin 可用性。
   */
  async availability(plugin_name: string): Promise<PluginAvailability> {
    const key = normalize_plugin_name(plugin_name);
    const record = this.records.get(key);
    if (!record) {
      return {
        enabled: false,
        available: false,
        reasons: [`Unknown plugin: ${plugin_name}`],
      };
    }

    if (record.state !== "ready") {
      return {
        enabled: true,
        available: false,
        reasons: [record.last_error || `Plugin "${record.plugin.name}" is not ready`],
      };
    }

    if (record.plugin.availability) {
      return await record.plugin.availability(this.require_context());
    }

    return {
      enabled: true,
      available: true,
      reasons: [],
    };
  }

  /**
   * 按 action schema 校验 payload。
   */
  private parseActionPayload(params: {
    plugin_name: string;
    action_name: string;
    payload: JsonValue;
    action: NonNullable<Plugin["actions"]>[string];
  }): PluginActionResult<JsonValue> | { input: JsonValue } {
    const schema = params.action.input_schema?.zod;
    if (!schema) return { input: params.payload };
    const parsed = schema.safeParse(params.payload);
    if (parsed.success) {
      return { input: parsed.data as JsonValue };
    }
    return {
      success: false,
      error: `Invalid payload for ${params.plugin_name}.${params.action_name}: ${parsed.error.message}`,
      message: `Invalid payload for ${params.plugin_name}.${params.action_name}`,
    };
  }

  /**
   * 运行 plugin action。
   */
  async run_action(params: {
    plugin: string;
    action: string;
    payload?: JsonValue;
    execution_context?: PluginExecutionContext;
  }): Promise<PluginActionResult<JsonValue>> {
    return await this.run_action_from_records(this.records, params);
  }

  /**
   * 从指定记录视图运行 plugin action。
   */
  private async run_action_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    params: {
      plugin: string;
      action: string;
      payload?: JsonValue;
      execution_context?: PluginExecutionContext;
    },
  ): Promise<PluginActionResult<JsonValue>> {
    const key = normalize_plugin_name(params.plugin);
    const record = records.get(key);
    if (!record) {
      return {
        success: false,
        error: `Unknown plugin: ${params.plugin}`,
        message: `Unknown plugin: ${params.plugin}`,
      };
    }

    const action_name = normalize_plugin_name(params.action);
    if (!action_name) {
      return {
        success: false,
        error: "action is required",
        message: "action is required",
      };
    }

    if (record.state !== "ready") {
      return {
        success: false,
        error: `Plugin "${record.plugin.name}" is not ready`,
        message: `Plugin "${record.plugin.name}" is not ready`,
      };
    }

    const action = record.plugin.actions?.[action_name];
    if (!action) {
      return {
        success: false,
        error: `Plugin "${record.plugin.name}" does not implement action "${action_name}"`,
        message: `Plugin "${record.plugin.name}" does not implement action "${action_name}"`,
      };
    }

    try {
      const parsed_payload = this.parseActionPayload({
        plugin_name: record.plugin.name,
        action_name,
        payload: (params.payload ?? {}) as JsonValue,
        action,
      });
      if (!("input" in parsed_payload)) {
        return parsed_payload;
      }
      const result = await action.execute({
        context: this.require_context(),
        input: parsed_payload.input,
        plugin_name: record.plugin.name,
        action_name,
        ...(params.execution_context
          ? { execution_context: params.execution_context }
          : {}),
      });
      return result;
    } catch (error) {
      return {
        success: false,
        error: String(error),
        message: String(error),
      };
    }
  }

  /**
   * 读取当前生效的 plugin system blocks。
   */
  async system_blocks(
    execution_context?: PluginExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    return await this.system_blocks_from_records(
      this.records,
      execution_context,
    );
  }

  /**
   * 从指定记录视图解析 plugin system blocks。
   */
  private async system_blocks_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    execution_context?: PluginExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    const context = this.require_context();
    const out: AgentSessionSystemBlock[] = [];
    for (const record of records.values()) {
      const plugin = record.plugin;
      if (record.state !== "ready") continue;
      if (typeof plugin.system !== "function") continue;
      try {
        if (typeof plugin.availability === "function") {
          const availability = await plugin.availability(context);
          if (!availability.available) continue;
        }
        const text = String(
          await plugin.system(context, execution_context),
        ).trim();
        if (!text) continue;
        out.push({
          source: "plugin",
          name: plugin.name,
          content: text,
        });
      } catch {
        // 单个 plugin system 失败不应阻断 session 主链路。
      }
    }
    return out;
  }

  /**
   * 创建当前 configured registry 的 Session step 执行视图。
   */
  execution_view(): AgentPluginExecutionRuntime {
    const records = new Map(this.records);
    return {
      read: (params) => this.read_from_records(records, params),
      run_action: async (params) =>
        await this.run_action_from_records(records, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(records, execution_context),
      acquire: () => this.acquire_execution_view(records),
    };
  }

  /**
   * 为单次 Session step 获取 Plugin execution lease。
   */
  private acquire_execution_view(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
  ): AgentPluginExecutionLease {
    const leased_records = new Map<string, PluginRuntimeRecord>();
    for (const [name, record] of records) {
      if (
        record.retired ||
        record.state !== "ready" ||
        !record.lifecycle_started
      ) {
        continue;
      }
      record.active_execution_leases += 1;
      leased_records.set(name, record);
    }

    let released = false;
    return {
      read: (params) => this.read_from_records(leased_records, params),
      run_action: async (params) =>
        await this.run_action_from_records(leased_records, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(
          leased_records,
          execution_context,
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
   * 把已移出 configured registry 的 Plugin 标记为等待释放。
   */
  private retire_record(record: PluginRuntimeRecord): void {
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

  /**
   * 在最后一个 execution lease 释放后停止退休 Plugin。
   */
  private try_finalize_retired_record(record: PluginRuntimeRecord): void {
    if (
      !record.retired ||
      record.retirement_started ||
      record.active_execution_leases > 0
    ) {
      return;
    }
    record.retirement_started = true;
    void (async () => {
      try {
        await this.stop_record(record);
      } catch (error) {
        update_record_state(record, "error", String(error));
        try {
          await this.require_context().logger.log(
            "error",
            "[plugin] lifecycle.stop failed after execution release",
            {
              plugin: record.plugin.name,
              error: String(error),
            },
          );
        } catch {
          // 退休清理不能因日志失败再次中断。
        }
      } finally {
        this.retired_records.delete(record);
        record.resolve_retirement?.();
        delete record.resolve_retirement;
      }
    })();
  }
}
