/**
 * City Plugin 的 Agent 执行 Registry。
 *
 * 关键点（中文）
 * - Registry 只持有 City Plugin 唯一实例的 Agent 执行投影，不拥有实例。
 * - Registry 不启动或停止 Plugin，只管理执行索引与 execution lease。
 * - action、system、hook、resolve 都统一以“已注册且 ready”为生效边界。
 */

import { to_plugin_view } from "@/plugin/core/PluginCatalog.js";
import { HookRegistry } from "@/plugin/core/HookRegistry.js";
import type {
  PluginActionReadView,
  PluginActionResult,
  PluginAvailability,
  PluginDefinition,
  PluginReadView,
  PluginView,
} from "@/plugin/index.js";
import type {
  AgentPluginRuntime,
  AgentPluginExecutionLease,
  AgentPluginExecutionRuntime,
} from "@/plugin/types/PluginExecutionRuntime.js";
import type { AgentSessionSystemBlock } from "@downcity/agent";
import type { PluginContext } from "@/plugin/index.js";
import type { JsonValue } from "@downcity/agent";
import type { PluginSnapshot } from "@/plugin/index.js";
import type { PluginRuntimeRecord } from "@/plugin/types/PluginRuntimeRecord.js";
import type { PluginExecutionContext } from "@/plugin/index.js";
import type { SessionInteractionPort } from "@downcity/agent";
import { execute_plugin_action } from "@/plugin/core/PluginActionExecution.js";
import type { RuntimeTool as Tool } from "@downcity/type";
import { create_plugin_tools } from "@/plugin/tool/PluginTools.js";
import type {
  PluginRegistryChange,
  PluginRegistrySubscriber,
  PluginRegistryUnsubscribe,
} from "@/plugin/types/PluginRegistry.js";

function now_ms(): number {
  return Date.now();
}

function normalize_plugin_name(plugin_name: string): string {
  return String(plugin_name || "").trim();
}

/** 为当前 Workspace 的指定 Plugin 创建专属运行时 Context。 */
type PluginContextFactory = (
  plugin_name: string,
) => PluginContext;

function create_record(plugin: PluginDefinition): PluginRuntimeRecord {
  const current_time = now_ms();
  return {
    plugin,
    registered_at: current_time,
    active_execution_leases: 0,
    retired: false,
  };
}

function to_plugin_snapshot(record: PluginRuntimeRecord): PluginSnapshot {
  const plugin = record.plugin;
  return {
    name: plugin.name,
    title: String(plugin.title || plugin.name || "").trim(),
    description: String(plugin.description || "").trim(),
    status: "ready",
    registered_at: record.registered_at,
    updated_at: record.registered_at,
  };
}

/**
 * PluginRegistry：Agent plugin 注册、卸载与调用实现。
 */
export class PluginRegistry {
  private readonly hookRegistry: HookRegistry;

  private readonly records = new Map<string, PluginRuntimeRecord>();

  /** Agent 当前已进入 Workspace 的 Plugin Context 工厂。 */
  private readonly workspace_context_factories = new Map<string, PluginContextFactory>();

  private readonly retired_records = new Set<PluginRuntimeRecord>();

  /** Plugin 配置变化订阅器。 */
  private readonly change_subscribers = new Set<PluginRegistrySubscriber>();

  constructor(plugins: PluginDefinition[] = []) {
    this.hookRegistry = new HookRegistry({
      is_plugin_ready: (plugin_name) => this.is_ready(plugin_name),
    });
    for (const plugin of plugins) {
      this.register_sync(plugin);
    }
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

  /** 绑定当前 Workspace 的 Plugin Context 工厂。 */
  bind_workspace_context(
    context: PluginContext,
    factory: PluginContextFactory,
  ): () => void {
    this.workspace_context_factories.set(context.workspace.id, factory);
    return () => {
      if (this.workspace_context_factories.get(context.workspace.id) === factory) {
        this.workspace_context_factories.delete(context.workspace.id);
      }
    };
  }

  /** 返回指定 Plugin 的运行时 Context；未绑定工厂时回退到传入 Context。 */
  plugin_context(context: PluginContext, plugin_name: string): PluginContext {
    const key = normalize_plugin_name(plugin_name);
    return this.workspace_context_factories.get(context.workspace.id)?.(key) || context;
  }

  /**
   * 返回当前 Registry 向 Agent 提供的 Plugin Tools。
   *
   * 关键点（中文）
   * - 没有任何 Action 时不暴露空壳 Tool。
   * - Tool 闭包绑定当前 Registry，动态 Plugin 变化无需重建 bridge。
   */
  tools(context: PluginContext): Record<string, Tool> {
    if (!this.list().some((plugin) => plugin.actions.length > 0)) return {};
    return { ...create_plugin_tools({ plugins: this.contextual(context) }) };
  }

  /**
   * 创建绑定当前 Session Workspace 上下文的 Plugin 调用面。
   *
   * Registry 只保存 Agent 注册的 Plugin；Action、Hook、System 与 availability 在
   * 调用时显式使用这里捕获的 Workspace Context。
   */
  contextual(context: PluginContext): AgentPluginRuntime {
    return {
      has: (plugin_name) => this.has(plugin_name),
      get: (plugin_name) => this.get(plugin_name),
      status: (plugin_name) => this.status(plugin_name),
      snapshots: () => this.snapshots(),
      list: () => this.list(),
      read: (params) => this.read(params),
      availability: async (plugin_name) =>
        await this.availability(context, plugin_name),
      run_action: async (params) =>
        await this.run_action({ context, ...params }),
      system_blocks: async (execution_context) =>
        await this.system_blocks(context, execution_context),
      pipeline: async (point_name, value) =>
        await this.pipeline(context, point_name, value),
      guard: async (point_name, value) =>
        await this.guard(context, point_name, value),
      effect: async (point_name, value) =>
        await this.effect(context, point_name, value),
      resolve: async (point_name, value) =>
        await this.resolve(context, point_name, value),
    };
  }

  /**
   * 注册单个 plugin。
   *
   * 说明（中文）
   * - 同名注册表示替换：旧执行视图立即退休，新执行视图立即生效。
   * - Plugin 生命周期已经由 City 完成，Registry 不执行任何生命周期回调。
   */
  async register(plugin: PluginDefinition): Promise<PluginSnapshot> {
    const key = normalize_plugin_name(plugin.name);
    if (!key) {
      throw new Error("Plugin name is required");
    }
    if (this.records.has(key)) {
      await this.unregister(key);
    }

    return this.register_sync(plugin);
  }

  /** 同步注册一个已经由 City 启动的 Plugin 执行实例。 */
  private register_sync(plugin: PluginDefinition): PluginSnapshot {
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
    this.publish_change({ type: "register", plugin_name: key });
    return to_plugin_snapshot(record);
  }

  /**
   * 从 configured registry 卸载指定 plugin。
   *
   * 关键点（中文）
   * - configured registry、hooks 与直接调用入口立即移除。
   * - 当前活跃 Session step 继续使用已捕获的执行记录。
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

  /**
   * 从 configured registry 卸载指定 Plugin，并等待全部 execution lease 释放。
   *
   * City 在停止 Plugin 实例前必须使用该入口，避免实例早于运行中的
   * Session Step 被释放。
   */
  async unregister_and_wait(plugin_name: string): Promise<boolean> {
    const key = normalize_plugin_name(plugin_name);
    const record = this.records.get(key);
    if (!record) return false;
    const removed = await this.unregister(key);
    await record.retirement_promise;
    return removed;
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
    return this.records.has(normalize_plugin_name(plugin_name));
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

  private register_hooks(plugin: PluginDefinition): void {
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

  /**
   * 运行 pipeline 点。
   */
  async pipeline<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<T> {
    return this.hookRegistry.pipelineValue(
      context,
      point_name,
      value,
      (plugin_name) => this.plugin_context(context, plugin_name),
    );
  }

  /**
   * 运行 guard 点。
   */
  async guard<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    return this.hookRegistry.guardValue(
      context,
      point_name,
      value,
      (plugin_name) => this.plugin_context(context, plugin_name),
    );
  }

  /**
   * 运行 effect 点。
   */
  async effect<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    return this.hookRegistry.effectValue(
      context,
      point_name,
      value,
      (plugin_name) => this.plugin_context(context, plugin_name),
    );
  }

  /**
   * 运行 resolve 点。
   */
  async resolve<TInput = JsonValue, TOutput = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    return this.hookRegistry.resolveValue<TInput, TOutput>(
      context,
      point_name,
      value,
      (plugin_name) => this.plugin_context(context, plugin_name),
    );
  }

  /**
   * 获取单个 plugin 定义。
   */
  get(plugin_name: string): PluginDefinition | null {
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
    action: NonNullable<PluginDefinition["actions"]>[string],
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
  async availability(
    context: PluginContext,
    plugin_name: string,
  ): Promise<PluginAvailability> {
    return await this.availability_from_records(this.records, context, plugin_name);
  }

  /** 从指定执行记录视图检查 Plugin 可用性。 */
  private async availability_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    plugin_name: string,
  ): Promise<PluginAvailability> {
    const key = normalize_plugin_name(plugin_name);
    const record = records.get(key);
    if (!record) {
      return {
        enabled: false,
        available: false,
        reasons: [`Unknown plugin: ${plugin_name}`],
      };
    }

    if (record.plugin.availability) {
      return await record.plugin.availability(this.plugin_context(context, key));
    }

    return {
      enabled: true,
      available: true,
      reasons: [],
    };
  }

  /**
   * 运行 plugin action。
   */
  async run_action(params: {
    context: PluginContext;
    plugin: string;
    action: string;
    payload?: JsonValue;
    execution_context?: PluginExecutionContext;
    interactions?: SessionInteractionPort;
  }): Promise<PluginActionResult<JsonValue>> {
    return await this.run_action_from_records(this.records, params.context, params);
  }

  /**
   * 从指定记录视图运行 plugin action。
   */
  private async run_action_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    params: {
      plugin: string;
      action: string;
      payload?: JsonValue;
      execution_context?: PluginExecutionContext;
      interactions?: SessionInteractionPort;
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

    const action = record.plugin.actions?.[action_name];
    if (!action) {
      return {
        success: false,
        error: `Plugin "${record.plugin.name}" does not implement action "${action_name}"`,
        message: `Plugin "${record.plugin.name}" does not implement action "${action_name}"`,
      };
    }

    return await execute_plugin_action({
      context: this.plugin_context(context, record.plugin.name),
      plugin_name: record.plugin.name,
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
   * 读取当前生效的 plugin system blocks。
   */
  async system_blocks(
    context: PluginContext,
    execution_context?: PluginExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    return await this.system_blocks_from_records(
      this.records,
      context,
      execution_context,
    );
  }

  /**
   * 从指定记录视图解析 plugin system blocks。
   */
  private async system_blocks_from_records(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    execution_context?: PluginExecutionContext,
  ): Promise<AgentSessionSystemBlock[]> {
    const out: AgentSessionSystemBlock[] = [];
    for (const record of records.values()) {
      const plugin = record.plugin;
      if (typeof plugin.system !== "function") continue;
      try {
        if (typeof plugin.availability === "function") {
          const plugin_context = this.plugin_context(context, plugin.name);
          const availability = await plugin.availability(plugin_context);
          if (!availability.available) continue;
        }
        const text = String(
          await plugin.system(
            this.plugin_context(context, plugin.name),
            execution_context,
          ),
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

  /** 在指定 Plugin execution snapshot 中运行既有 pipeline handlers。 */
  private async pipeline_from_records<T>(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<T> {
    const key = String(point_name || "").trim();
    if (!key) return value;
    let current = value as JsonValue;
    for (const record of records.values()) {
      const handlers = record.plugin.hooks?.pipeline?.[key] || [];
      for (const handler of handlers) {
        current = await handler({
          context: this.plugin_context(context, record.plugin.name),
          value: current,
          plugin: record.plugin.name,
        });
      }
    }
    return current as T;
  }

  /** 在指定 Plugin execution snapshot 中运行既有 effect handlers。 */
  private async effect_from_records<T>(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of records.values()) {
      const handlers = record.plugin.hooks?.effect?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: this.plugin_context(context, record.plugin.name),
          value: value as JsonValue,
          plugin: record.plugin.name,
        });
      }
    }
  }

  /** 在指定 Plugin execution snapshot 中运行既有 guard handlers。 */
  private async guard_from_records<T>(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    for (const record of records.values()) {
      const handlers = record.plugin.hooks?.guard?.[key] || [];
      for (const handler of handlers) {
        await handler({
          context: this.plugin_context(context, record.plugin.name),
          value: value as JsonValue,
          plugin: record.plugin.name,
        });
      }
    }
  }

  /** 在指定 Plugin execution snapshot 中运行唯一的 resolve handler。 */
  private async resolve_from_records<TInput, TOutput>(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    const key = String(point_name || "").trim();
    if (!key) throw new Error("Resolve point name is required");
    for (const record of records.values()) {
      const handler = record.plugin.resolves?.[key];
      if (!handler) continue;
      return await handler({
        context: this.plugin_context(context, record.plugin.name),
        value: value as JsonValue,
        plugin: record.plugin.name,
      }) as TOutput;
    }
    throw new Error(`No plugin resolver registered for point: ${key}`);
  }

  /**
   * 创建当前 configured registry 的 Session step 执行视图。
   */
  execution_view(context: PluginContext): AgentPluginExecutionRuntime {
    const records = new Map(this.records);
    return {
      read: (params) => this.read_from_records(records, params),
      availability: async (plugin_name) =>
        await this.availability_from_records(records, context, plugin_name),
      run_action: async (params) =>
        await this.run_action_from_records(records, context, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(records, context, execution_context),
      pipeline: async (point_name, value) =>
        await this.pipeline_from_records(records, context, point_name, value),
      guard: async (point_name, value) =>
        await this.guard_from_records(records, context, point_name, value),
      effect: async (point_name, value) =>
        await this.effect_from_records(records, context, point_name, value),
      resolve: async (point_name, value) =>
        await this.resolve_from_records(records, context, point_name, value),
      acquire: () => this.acquire_execution_view(records, context),
    };
  }

  /**
   * 为单次 Session step 获取 Plugin execution lease。
   */
  private acquire_execution_view(
    records: ReadonlyMap<string, PluginRuntimeRecord>,
    context: PluginContext,
  ): AgentPluginExecutionLease {
    const leased_records = new Map<string, PluginRuntimeRecord>();
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
      availability: async (plugin_name) =>
        await this.availability_from_records(leased_records, context, plugin_name),
      run_action: async (params) =>
        await this.run_action_from_records(leased_records, context, params),
      system_blocks: async (execution_context) =>
        await this.system_blocks_from_records(
          leased_records,
          context,
          execution_context,
        ),
      pipeline: async (point_name, value) =>
        await this.pipeline_from_records(
          leased_records,
          context,
          point_name,
          value,
        ),
      guard: async (point_name, value) =>
        await this.guard_from_records(
          leased_records,
          context,
          point_name,
          value,
        ),
      effect: async (point_name, value) =>
        await this.effect_from_records(
          leased_records,
          context,
          point_name,
          value,
        ),
      resolve: async (point_name, value) =>
        await this.resolve_from_records(
          leased_records,
          context,
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

  /** 在最后一个 execution lease 释放后完成退休等待。 */
  private try_finalize_retired_record(record: PluginRuntimeRecord): void {
    if (!record.retired || record.active_execution_leases > 0) return;
    this.retired_records.delete(record);
    record.resolve_retirement?.();
    delete record.resolve_retirement;
  }
}
