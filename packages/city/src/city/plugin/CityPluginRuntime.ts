/**
 * City Plugin 单实例运行时。
 *
 * 一个 City 中每个 Plugin ID 只持有一个实例。City 负责实例生命周期，并把全部
 * Plugin 自动投影给每个 Agent；Agent 与 Session 只消费 Tool 和 SessionHooks。
 */

import type { Hono } from "hono";
import type { Agent } from "@downcity/agent";
import { get_logger, SessionHooks } from "@downcity/agent";
import type { Logger } from "@downcity/agent";
import {
  get_agent_storage,
  get_workspace_entry,
  plugin_storage_scope,
} from "@downcity/agent/internal";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { AgentPluginRuntime } from "@/types/plugin/PluginRuntime.js";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type {
  CityPluginRegistration,
  PluginDefinition,
  PluginConfigMainAction,
  PluginContext,
  PluginJsonValue,
  PluginMainAction,
  PluginMainContext,
  PluginSnapshot,
} from "@/plugin/index.js";
import type {
  CityAgentPluginRuntimeRecord,
  CityAgentPlugins,
  CityPluginInput,
  CityPluginMainRecord,
  CityPluginRecord,
  CityPluginRuntimeOptions,
  CityPlugins,
  CityPluginWorkspaceContext,
} from "@/city/types/CityPlugin.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";

/** City 唯一的 Plugin Runtime。 */
export class CityPluginRuntime {
  /** City 当前持有的唯一 Plugin 实例。 */
  private readonly plugins_by_id = new Map<string, CityPluginRecord>();

  /** 按 Agent ID 索引的执行视图。 */
  private readonly agents_by_id = new Map<string, CityAgentPluginRuntimeRecord>();

  /** 按 Agent/Workspace 索引的动态 Context。 */
  private readonly workspace_contexts = new Map<string, CityPluginWorkspaceContext>();

  /** 已激活的 Plugin main。 */
  private readonly main_records = new Map<string, CityPluginMainRecord>();

  /** 并发 main 调用共享的激活流程。 */
  private readonly main_activation_promises = new Map<string, Promise<CityPluginMainRecord>>();

  /** 正在解除的 Agent Plugin 视图。 */
  private readonly detach_promises = new Map<string, Promise<void>>();

  /** City 向应用提供的 Plugin 集合入口。 */
  readonly public_api: CityPlugins;

  constructor(private readonly options: CityPluginRuntimeOptions) {
    this.public_api = Object.freeze({
      add: (input) => this.add(input),
      remove: async (plugin_id) => await this.remove(plugin_id),
      snapshots: () => this.snapshots(),
      get: (plugin_id) => this.get(plugin_id),
      scope: (input) => this.scope(input.agent_id, input.workspace_id),
      register_http_routes: (app, input) => {
        this.register_http_routes(app, input.agent_id, input.workspace_id);
      },
      invoke: async (plugin_id, action_id, input) =>
        await this.invoke_main(plugin_id, action_id, input),
      invoke_config: async (plugin_id, profile_id, action_id, input) =>
        await this.invoke_config(plugin_id, profile_id, action_id, input),
    });
  }

  /** 向 City 添加一个唯一 Plugin 实例。 */
  private add(input: CityPluginInput): void {
    const registration = normalize_registration(input);
    const plugin_id = normalize_id(registration.id, "plugin.id");
    if (normalize_id(registration.plugin.name, "plugin.name") !== plugin_id) {
      throw new Error(`Plugin instance ID does not match registration: ${plugin_id}`);
    }
    const existing = this.plugins_by_id.get(plugin_id);
    if (existing) {
      if (existing.plugin === registration.plugin) return;
      throw new Error(`Plugin already exists in City: ${plugin_id}`);
    }

    const scope = this.options.city.storage.open_scope(["plugins", plugin_id]);
    const logger = get_logger();
    logger.bind_storage(scope.files, scope.root_path);
    const lifecycle_context = Object.freeze({
      plugin_id,
      storage: Object.freeze({ path: scope.root_path, files: scope.files }),
      logger,
    });
    const current_time = Date.now();
    const record = {
      plugin_id,
      registration,
      plugin: registration.plugin,
      execution_plugin: create_execution_plugin(registration.plugin),
      logger,
      lifecycle_context,
      ready: Promise.resolve(),
      lifecycle_started: false,
      state: "initializing",
      registered_at: current_time,
      updated_at: current_time,
    } as CityPluginRecord;
    this.plugins_by_id.set(plugin_id, record);
    record.ready = this.start_plugin(record);

    for (const agent_record of this.agents_by_id.values()) {
      agent_record.ready = this.enqueue_agent_mutation(agent_record, async () => {
        await this.attach_plugin(agent_record, record);
      });
    }
  }

  /** 从 City 移除 Plugin，并等待全部正在执行的 Scope 收口。 */
  private async remove(plugin_id_input: string): Promise<boolean> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const record = this.plugins_by_id.get(plugin_id);
    if (!record) return false;
    this.plugins_by_id.delete(plugin_id);

    const results = await Promise.allSettled(
      [...this.agents_by_id.values()].map(async (agent_record) => {
        await this.enqueue_agent_mutation(agent_record, async () => {
          await agent_record.registry.unregister_and_wait(plugin_id);
          await this.drop_workspace_plugin_contexts(
            agent_record.agent.id,
            plugin_id,
            record,
          );
        });
      }),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    try {
      await this.stop_plugin(record);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.deactivate_main(plugin_id);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `City Plugin removal failed: ${plugin_id}`);
    }
    return true;
  }

  /** 返回 City 当前全部 Plugin 快照。 */
  private snapshots(): PluginSnapshot[] {
    return [...this.plugins_by_id.values()]
      .map((record) => ({
        name: record.plugin_id,
        title: record.registration.title,
        description: record.registration.description,
        status: record.state,
        registered_at: record.registered_at,
        updated_at: record.updated_at,
        ...(record.last_error ? { last_error: record.last_error } : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 返回 City 当前持有的唯一 Plugin 实例。 */
  private get(plugin_id_input: string): PluginDefinition | null {
    return this.plugins_by_id.get(String(plugin_id_input || "").trim())?.plugin ?? null;
  }

  /** 为新加入 City 的 Agent 创建包含全部 Plugin 的执行视图。 */
  attach_agent(agent: Agent): CityAgentPlugins {
    if (this.agents_by_id.has(agent.id)) {
      throw new Error(`City Plugin Runtime already contains Agent: ${agent.id}`);
    }
    const agent_context: AgentPluginContext = Object.freeze({
      agent_id: agent.id,
      logger: agent.get_logger(),
      get embassy() {
        return undefined;
      },
      get instructions() {
        return agent.get_instructions();
      },
    });
    const registry = new PluginRegistry(agent_context);
    const record: CityAgentPluginRuntimeRecord = {
      agent,
      registry,
      ready: Promise.resolve(),
      mutation_chain: Promise.resolve(),
    };
    let initial = true;
    record.ready = this.attach_all_plugins(record).finally(() => {
      initial = false;
    });
    this.agents_by_id.set(agent.id, record);

    return Object.freeze({
      ensure_ready: async () => await record.ready,
      connect_workspace: async (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        await this.ensure_workspace_connections(record, context);
      },
      disconnect_workspace: async (workspace_id) => {
        await this.drop_workspace_contexts(agent.id, workspace_id);
      },
      tools: (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        return registry.tools(context);
      },
      hooks: (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        return this.session_hooks(record, context);
      },
      subscribe: (subscriber) => registry.subscribe_change((change) => {
        subscriber({
          type: change.type === "register" ? "add" : "remove",
          plugin_id: change.plugin_name,
          initial,
        });
      }),
    });
  }

  /** 释放指定 Agent 的 Plugin 执行视图，但不停止 City Plugin 实例。 */
  async detach_agent(agent_id_input: string): Promise<void> {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const current = this.detach_promises.get(agent_id);
    if (current) return await current;
    const record = this.agents_by_id.get(agent_id);
    if (!record) return;
    this.agents_by_id.delete(agent_id);
    const operation = (async () => {
      await record.ready.catch(() => undefined);
      await this.drop_workspace_contexts(agent_id);
      await record.registry.unregister_all();
    })();
    this.detach_promises.set(agent_id, operation);
    try {
      await operation;
    } finally {
      this.detach_promises.delete(agent_id);
    }
  }

  /** 关闭全部 Agent 视图与 City Plugin 实例。 */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.agents_by_id.keys()].map(async (agent_id) => await this.detach_agent(agent_id)),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    for (const record of [...this.plugins_by_id.values()].reverse()) {
      try {
        await this.stop_plugin(record);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const plugin_id of [...this.main_records.keys()].reverse()) {
      try {
        await this.deactivate_main(plugin_id);
      } catch (error) {
        errors.push(error);
      }
    }
    this.plugins_by_id.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "City Plugin Runtime shutdown failed");
    }
  }

  /** 启动一个 City Plugin 实例。 */
  private async start_plugin(record: CityPluginRecord): Promise<void> {
    try {
      await record.plugin.lifecycle?.start?.(record.lifecycle_context);
      record.lifecycle_started = true;
      record.state = "ready";
      record.updated_at = Date.now();
    } catch (error) {
      record.state = "error";
      record.last_error = error instanceof Error ? error.message : String(error);
      record.updated_at = Date.now();
      await Promise.resolve(record.plugin.lifecycle?.stop?.(record.lifecycle_context)).catch(() => undefined);
      throw error;
    }
  }

  /** 停止一个 City Plugin 实例。 */
  private async stop_plugin(record: CityPluginRecord): Promise<void> {
    await record.ready.catch(() => undefined);
    if (!record.lifecycle_started) return;
    try {
      await record.plugin.lifecycle?.stop?.(record.lifecycle_context);
    } finally {
      record.lifecycle_started = false;
      record.updated_at = Date.now();
    }
  }

  /** 把 City 当前全部 Plugin 投影到一个 Agent。 */
  private async attach_all_plugins(record: CityAgentPluginRuntimeRecord): Promise<void> {
    for (const plugin_record of this.plugins_by_id.values()) {
      try {
        await this.attach_plugin(record, plugin_record);
      } catch (error) {
        record.agent.get_logger().error("City Plugin startup failed", {
          plugin_id: plugin_record.plugin_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** 把单个 City Plugin 投影到一个 Agent。 */
  private async attach_plugin(
    agent_record: CityAgentPluginRuntimeRecord,
    plugin_record: CityPluginRecord,
  ): Promise<void> {
    await plugin_record.ready;
    await agent_record.registry.register(plugin_record.execution_plugin);
    await this.ensure_plugin_workspace_connections(agent_record, plugin_record.plugin_id);
  }

  /** 串行执行一个 Agent 的 Plugin 集合修改。 */
  private enqueue_agent_mutation<TResult>(
    record: CityAgentPluginRuntimeRecord,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = record.mutation_chain.then(operation, operation);
    record.mutation_chain = result.then(() => undefined, () => undefined);
    return result;
  }

  /** 返回一个 Agent/Workspace 的 Plugin Context。 */
  private workspace_context(
    record: CityAgentPluginRuntimeRecord,
    workspace: WorkspaceRuntime,
    logger: Logger,
  ): PluginContext {
    const key = workspace_key(record.agent.id, workspace.id);
    const existing = this.workspace_contexts.get(key);
    if (existing) return existing.context;

    const storage = get_agent_storage(record.agent);
    let contextual_plugins: AgentPluginRuntime | undefined;
    const context_input = {
      agent_id: record.agent.id,
      agent_name: record.agent.name,
      agent_description: record.agent.description,
      workspace_id: workspace.id,
      workspace_path: workspace.path,
      data_path: storage.root_path,
      files: workspace.files,
      data_files: storage.files,
      get_config: () => ({}),
      ...(workspace.shell ? { shell: workspace.shell } : {}),
      logger,
      embassy: this.options.city.embassy,
      get_workspace_env: () => workspace.get_env(),
      get_instructions: () => record.agent.get_instructions(),
      get_plugins: () => {
        if (!contextual_plugins) throw new Error("City Plugin Context is not initialized");
        return contextual_plugins;
      },
      get_sessions: () => get_workspace_entry(record.agent, workspace.id)?.sessions
        ?? record.agent.sessions,
    } satisfies Parameters<typeof create_plugin_context>[0];
    const context = create_plugin_context(context_input);
    const contexts_by_plugin = new Map<string, PluginContext>();
    const records_by_plugin = new Map<string, CityPluginRecord>();
    const connection_promises = new Map<string, Promise<void>>();
    let release_registry_context = () => {};
    const workspace_record: CityPluginWorkspaceContext = {
      context,
      contexts_by_plugin,
      records_by_plugin,
      connection_promises,
      release_registry_context: () => release_registry_context(),
    };
    this.workspace_contexts.set(key, workspace_record);

    release_registry_context = record.registry.bind_workspace_context(context, (plugin_name) => {
      const plugin_id = normalize_id(plugin_name, "plugin_id");
      const cached = contexts_by_plugin.get(plugin_id);
      if (cached) return cached;
      const plugin_record = this.plugins_by_id.get(plugin_id);
      if (!plugin_record) throw new Error(`Plugin is not available in City: ${plugin_id}`);
      const plugin_storage = plugin_storage_scope(record.agent, plugin_id);
      const plugin_context = create_plugin_context({
        ...context_input,
        data_path: plugin_storage.root_path,
        data_files: plugin_storage.files,
        get_config: () => this.options.host?.runtime_config?.(plugin_id, record.agent.id) ?? {},
        ...(this.options.host
          ? { notifications: this.options.host.notifications(plugin_id, record.agent.id) }
          : {}),
      });
      contexts_by_plugin.set(plugin_id, plugin_context);
      records_by_plugin.set(plugin_id, plugin_record);
      const connection = plugin_record.ready.then(async () => {
        await plugin_record.plugin.lifecycle?.connect?.(plugin_context);
      });
      connection_promises.set(plugin_id, connection);
      return plugin_context;
    });
    contextual_plugins = this.ready_contextual(record, context);
    return context;
  }

  /** 确保 Workspace 已连接当前 Agent 可见的全部 Plugin。 */
  private async ensure_workspace_connections(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): Promise<void> {
    await record.ready;
    const workspace_record = this.workspace_contexts.get(
      workspace_key(record.agent.id, context.workspace.id),
    );
    if (!workspace_record) return;
    for (const snapshot of record.registry.snapshots()) {
      record.registry.plugin_context(context, snapshot.name);
    }
    await Promise.all(workspace_record.connection_promises.values());
  }

  /** 确保动态添加的 Plugin 连接一个 Agent 当前全部 Workspace。 */
  private async ensure_plugin_workspace_connections(
    record: CityAgentPluginRuntimeRecord,
    plugin_id: string,
  ): Promise<void> {
    const prefix = `${record.agent.id}\u0000`;
    const connections: Promise<void>[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix)) continue;
      record.registry.plugin_context(workspace_record.context, plugin_id);
      const connection = workspace_record.connection_promises.get(plugin_id);
      if (connection) connections.push(connection);
    }
    await Promise.all(connections);
  }

  /** 释放一个 Agent 的全部或指定 Workspace Context。 */
  private async drop_workspace_contexts(agent_id: string, workspace_id?: string): Promise<void> {
    const prefix = `${agent_id}\u0000`;
    const errors: unknown[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix)) continue;
      if (workspace_id && key !== workspace_key(agent_id, workspace_id)) continue;
      this.workspace_contexts.delete(key);
      workspace_record.release_registry_context();
      for (const [plugin_id, context] of workspace_record.contexts_by_plugin) {
        try {
          await workspace_record.connection_promises.get(plugin_id);
          // Context 释放可能发生在 Plugin 已从 City 移除之后；此处必须使用
          // Context 创建时捕获的 Plugin 记录，不能再次从当前注册表查找。
          const plugin_record = workspace_record.records_by_plugin.get(plugin_id);
          await plugin_record?.plugin.lifecycle?.disconnect?.(context);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `City Plugin workspace cleanup failed: ${agent_id}`);
    }
  }

  /** 释放指定 Plugin 在一个 Agent 全部 Workspace 下的 Context。 */
  private async drop_workspace_plugin_contexts(
    agent_id: string,
    plugin_id: string,
    plugin_record: CityPluginRecord,
  ): Promise<void> {
    const prefix = `${agent_id}\u0000`;
    const errors: unknown[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix)) continue;
      const context = workspace_record.contexts_by_plugin.get(plugin_id);
      if (!context) continue;
      workspace_record.contexts_by_plugin.delete(plugin_id);
      workspace_record.records_by_plugin.delete(plugin_id);
      const connection = workspace_record.connection_promises.get(plugin_id);
      workspace_record.connection_promises.delete(plugin_id);
      try {
        await connection;
        await plugin_record.plugin.lifecycle?.disconnect?.(context);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `City Plugin cleanup failed: ${agent_id}/${plugin_id}`);
    }
  }

  /** 创建等待 Agent 与 Workspace ready 的直接 Plugin 调用面。 */
  private ready_contextual(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): AgentPluginRuntime {
    const runtime = record.registry.contextual(context);
    const wait_ready = async () => {
      await record.ready;
      await this.ensure_workspace_connections(record, context);
    };
    return Object.freeze({
      has: (plugin_name) => runtime.has(plugin_name),
      get: (plugin_name) => runtime.get(plugin_name),
      status: (plugin_name) => runtime.status(plugin_name),
      snapshots: () => runtime.snapshots(),
      list: () => runtime.list(),
      read: (params) => runtime.read(params),
      availability: async (plugin_name) => {
        await wait_ready();
        return await runtime.availability(plugin_name);
      },
      run_action: async (params) => {
        await wait_ready();
        const lease = record.registry.execution_view(context).acquire();
        try {
          return await lease.run_action(params);
        } finally {
          await lease.release();
        }
      },
      system_blocks: async (hook_context) => {
        await wait_ready();
        return await runtime.system_blocks(hook_context);
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await runtime.pipeline(point_name, value);
      },
      guard: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await runtime.guard(point_name, value);
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await runtime.effect(point_name, value);
      },
      resolve: async <TInput, TOutput>(point_name: string, value: TInput) => {
        await wait_ready();
        return await runtime.resolve<TInput, TOutput>(point_name, value);
      },
    });
  }

  /** 创建 Agent/Workspace 对应的具体 SessionHooks。 */
  private session_hooks(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): SessionHooks {
    const wait_ready = async () => {
      await record.ready;
      await this.ensure_workspace_connections(record, context);
    };
    return new SessionHooks({
      system_blocks: async (hook_context) => {
        await wait_ready();
        return await record.registry.execution_view(context).system_blocks(hook_context);
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await record.registry.execution_view(context).pipeline(point_name, value);
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await record.registry.execution_view(context).effect(point_name, value);
      },
      open: async () => {
        await wait_ready();
        const lease = record.registry.execution_view(context).acquire();
        return {
          system_blocks: async (hook_context) => await lease.system_blocks(hook_context),
          pipeline: async <TValue>(point_name: string, value: TValue) =>
            await lease.pipeline(point_name, value),
          effect: async <TValue>(point_name: string, value: TValue) =>
            await lease.effect(point_name, value),
          close: async () => await lease.release(),
        };
      },
    });
  }

  /** 返回一个 Agent/Workspace 的直接 Plugin 执行面。 */
  private scope(agent_id_input: string, workspace_id_input: string): AgentPluginRuntime {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const record = this.agents_by_id.get(agent_id);
    if (!record) throw new Error(`Agent is not registered in City: ${agent_id}`);
    const entry = this.options.city.require_workspace(agent_id, workspace_id_input);
    const context = this.workspace_context(record, entry.workspace, entry.get_logger());
    return this.ready_contextual(record, context);
  }

  /** 注册当前 Agent/Workspace 下全部 Plugin HTTP 路由。 */
  private register_http_routes(
    app: Hono,
    agent_id_input: string,
    workspace_id_input: string,
  ): void {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const record = this.agents_by_id.get(agent_id);
    if (!record) throw new Error(`Agent is not registered in City: ${agent_id}`);
    const entry = this.options.city.require_workspace(agent_id, workspace_id_input);
    const context = this.workspace_context(record, entry.workspace, entry.get_logger());
    register_plugin_http_routes({
      app,
      get_context: (plugin_name) => record.registry.plugin_context(context, plugin_name),
      plugins: record.registry.snapshots()
        .map((snapshot) => record.registry.get(snapshot.name))
        .filter((plugin): plugin is PluginDefinition => plugin !== null),
    });
  }

  /** 首次使用时激活 Plugin 的可选 main。 */
  private async ensure_main_active(plugin_id_input: string): Promise<CityPluginMainRecord> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const current = this.main_records.get(plugin_id);
    if (current) return current;
    const activating = this.main_activation_promises.get(plugin_id);
    if (activating) return await activating;
    const registration = this.require_registration(plugin_id);
    const operation = (async () => {
      const plugin_actions = new Map<string, PluginMainAction>();
      const config_actions = new Map<string, PluginConfigMainAction>();
      const context = this.create_main_context(registration, plugin_actions, config_actions);
      const record = { registration, context, plugin_actions, config_actions };
      await registration.main?.activate(context);
      this.main_records.set(plugin_id, record);
      return record;
    })();
    this.main_activation_promises.set(plugin_id, operation);
    try {
      return await operation;
    } finally {
      this.main_activation_promises.delete(plugin_id);
    }
  }

  /** 释放一个已激活的 Plugin main。 */
  private async deactivate_main(plugin_id: string): Promise<void> {
    const record = this.main_records.get(plugin_id);
    if (!record) return;
    this.main_records.delete(plugin_id);
    await record.registration.main?.deactivate?.(record.context);
  }

  /** 返回指定 Plugin 注册项。 */
  private require_registration(plugin_id_input: string): CityPluginRegistration {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const registration = this.plugins_by_id.get(plugin_id)?.registration;
    if (!registration) throw new Error(`Plugin is not registered in City: ${plugin_id}`);
    return registration;
  }

  /** 调用 Plugin mainview action。 */
  private async invoke_main(
    plugin_id_input: string,
    action_id_input: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const action_id = normalize_id(action_id_input, "action_id");
    const record = await this.ensure_main_active(plugin_id);
    const action = record.plugin_actions.get(action_id);
    if (!action) throw new Error(`Plugin mainview action not found: ${plugin_id}/${action_id}`);
    return normalize_json_value(await action.run(input), `${plugin_id}/${action_id} result`);
  }

  /** 调用 Plugin Profile config action。 */
  private async invoke_config(
    plugin_id_input: string,
    profile_id_input: string,
    action_id_input: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const profile_id = normalize_id(profile_id_input, "profile_id");
    const action_id = normalize_id(action_id_input, "action_id");
    const record = await this.ensure_main_active(plugin_id);
    const action = record.config_actions.get(action_id);
    if (!action) throw new Error(`Plugin config action not found: ${plugin_id}/${action_id}`);
    const config = this.options.host?.profile_config(plugin_id, profile_id);
    if (!config) throw new Error("City Plugin config actions require a profile host");
    return normalize_json_value(
      await action.run(input, { config }),
      `${plugin_id}/${action_id} result`,
    );
  }

  /** 创建 Plugin main 使用的 City 受限上下文。 */
  private create_main_context(
    registration: CityPluginRegistration,
    plugin_actions: Map<string, PluginMainAction>,
    config_actions: Map<string, PluginConfigMainAction>,
  ): PluginMainContext {
    const plugin_id = registration.id;
    const logger = get_logger();
    const notifications = this.options.host?.notifications(plugin_id) ?? {
      publish: async () => {},
      dismiss: async () => {},
    };
    return Object.freeze({
      plugin: Object.freeze({
        id: plugin_id,
        action: (action: PluginMainAction) =>
          register_main_action(plugin_id, plugin_actions, config_actions, action, "mainview"),
        config_action: (action: PluginConfigMainAction) =>
          register_main_action(plugin_id, config_actions, plugin_actions, action, "config"),
      }),
      logger,
      notifications,
      system: Object.freeze({
        list_agents: async () => this.options.city.agents.list().map((agent) => ({
          agent_id: agent.id,
          name: agent.name,
          plugin_ids: this.snapshots().map((snapshot) => snapshot.name),
        })),
        list_workspaces: async () => this.options.city.workspaces.list().map((workspace) => ({
          workspace_id: workspace.id,
          name: workspace.name ?? workspace.id,
          workspace_path: workspace.path,
        })),
        invoke_agent_plugin: async (input) => {
          await this.options.city.enter_workspace(input.agent_id, input.workspace_id);
          return await this.scope(input.agent_id, input.workspace_id).run_action({
            plugin: input.plugin_id,
            action: input.action_id,
            ...(input.input !== undefined ? { payload: input.input } : {}),
          }) as unknown as PluginJsonValue;
        },
        open_external: async ({ url }) => {
          if (!this.options.host?.open_external) throw new Error("City does not provide open_external");
          await this.options.host.open_external(url);
        },
        show_item_in_folder: async ({ path }) => {
          if (!this.options.host?.show_item_in_folder) {
            throw new Error("City does not provide show_item_in_folder");
          }
          await this.options.host.show_item_in_folder(path);
        },
        write_clipboard_text: async ({ text }) => {
          if (!this.options.host?.write_clipboard_text) {
            throw new Error("City does not provide write_clipboard_text");
          }
          await this.options.host.write_clipboard_text(text);
        },
      }),
    });
  }
}

/** 把 Plugin 或完整注册项归一化为 City 注册项。 */
function normalize_registration(input: CityPluginInput): CityPluginRegistration {
  if ("plugin" in input) return input;
  return {
    id: input.name,
    title: input.title || input.name,
    description: input.description || "",
    readme: "",
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    plugin: input,
  };
}

/** 创建保留 class 原型行为、但隐藏 lifecycle 的只读执行投影。 */
function create_execution_plugin(plugin: PluginDefinition): PluginDefinition {
  return new Proxy(plugin, {
    get(target, property, receiver) {
      if (property === "lifecycle") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, property) {
      return property === "lifecycle" ? false : Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((property) => property !== "lifecycle");
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "lifecycle") return undefined;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
}

/** 创建 Agent/Workspace Context 的稳定键。 */
function workspace_key(agent_id: string, workspace_id: string): string {
  return `${agent_id}\u0000${workspace_id}`;
}

/** 注册 main action，并保证两个 surface 之间 ID 唯一。 */
function register_main_action<TAction extends PluginMainAction | PluginConfigMainAction>(
  plugin_id: string,
  target: Map<string, TAction>,
  other: Map<string, PluginMainAction | PluginConfigMainAction>,
  action: TAction,
  surface: "mainview" | "config",
): void {
  const action_id = normalize_id(action.id, "action.id");
  if (target.has(action_id) || other.has(action_id)) {
    throw new Error(`Plugin ${surface} action is already registered: ${plugin_id}/${action_id}`);
  }
  target.set(action_id, { ...action, id: action_id });
}

/** 拒绝 main action 边界中的非 JSON 返回值。 */
function normalize_json_value(value: PluginJsonValue, label: string): PluginJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`${label} is not JSON-serializable`);
    return JSON.parse(serialized) as PluginJsonValue;
  } catch (error) {
    throw new Error(`${label} is not JSON-serializable`, { cause: error });
  }
}

/** 规范化稳定 ID。 */
function normalize_id(value: string | undefined, label: string): string {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required`);
  return id;
}
