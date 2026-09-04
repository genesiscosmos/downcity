/**
 * City Plugin 共享生命周期运行时。
 *
 * City 以 `(plugin_id, profile_id)` 持有唯一实例。每个 Agent 只有一个不含生命周期
 * 的执行 Registry；解绑先等待该 Agent 的 execution lease，再按引用计数停止共享实例。
 */

import type { Hono } from "hono";
import type { WorkspaceBase } from "@downcity/workspace";
import type {
  AgentPluginRuntime,
} from "@downcity/agent/host";
import type {
  Plugin,
  PluginConfigMainAction,
  PluginContext,
  PluginJsonObject,
  PluginJsonValue,
  PluginLifecycleContext,
  PluginMainAction,
  PluginMainContext,
  PluginProfile,
  PluginSnapshot,
} from "@downcity/plugin";
import type { Agent } from "@downcity/agent";
import { Logger } from "@downcity/agent/host";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type {
  AgentCityExtensionBinding,
  CityAgentPluginBinding,
  CityAgentPluginRuntimeRecord,
  CityPluginMainRecord,
  CityPluginRuntimeOptions,
  CityPlugins,
  CitySharedPluginRecord,
} from "@/city/types/CityPlugin.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";
import {
  agent_embassy,
  get_agent_storage,
  get_workspace_entry,
  plugin_storage_scope,
} from "@downcity/agent/host";

/** 一个 Agent/Workspace 的稳定 Plugin Context 集合。 */
interface CityPluginWorkspaceContext {
  /** Registry 默认使用的 Workspace Context。 */
  readonly context: PluginContext;
  /** 各 Plugin 独立 Profile 与 storage scope 对应的 Context。 */
  readonly contexts_by_plugin: Map<string, PluginContext>;
  /** 各 Plugin 作用域唯一的 bind 流程。 */
  readonly binding_promises: Map<string, Promise<void>>;
  /** Context 创建时实际绑定的共享实例，供替换或解绑时精确释放。 */
  readonly shared_by_plugin: Map<string, CitySharedPluginRecord>;
  /** 仅在当前工厂仍生效时解除 Registry 的 Workspace Context。 */
  readonly release_registry_context: () => void;
}

/** City 唯一的 Plugin Runtime 实现。 */
export class CityPluginRuntime {
  /** 按 Agent ID 索引的执行绑定。 */
  private readonly records_by_agent = new Map<string, CityAgentPluginRuntimeRecord>();
  /** 按 `(plugin_id, profile_id)` 索引的 City 共享实例。 */
  private readonly shared_records = new Map<string, CitySharedPluginRecord>();
  /** 并发绑定同一 Plugin/Profile 时复用的创建流程。 */
  private readonly shared_creation_promises = new Map<string, Promise<CitySharedPluginRecord>>();
  /** 正在停止的共享实例；同 key 新创建必须等待旧实例完全停止。 */
  private readonly shared_stop_promises = new Map<string, Promise<void>>();
  /** City Plugin catalog；main 与 execution factory 共享同一注册。 */
  private readonly registrations = new Map<string, import("@downcity/plugin").CityPluginRegistration>();
  /** 已激活的 Plugin main。 */
  private readonly main_records = new Map<string, CityPluginMainRecord>();
  /** 并发 main 调用复用的激活流程。 */
  private readonly main_activation_promises = new Map<string, Promise<CityPluginMainRecord>>();
  /** 按 Agent/Workspace 索引的动态执行 Context。 */
  private readonly workspace_contexts = new Map<string, CityPluginWorkspaceContext>();
  /** 正在停止的 Agent Plugin Runtime。 */
  private readonly detach_promises = new Map<string, Promise<void>>();
  /** City 向 SDK 用户提供的 Plugin 入口。 */
  readonly public_api: CityPlugins;

  constructor(private readonly options: CityPluginRuntimeOptions) {
    this.public_api = Object.freeze({
      provide: (registration) => this.provide(registration),
      register: async (agent_id, binding) => await this.register(agent_id, binding),
      unregister: async (agent_id, plugin_id) => await this.unregister(agent_id, plugin_id),
      snapshots: (agent_id) => this.snapshots(agent_id),
      get: (agent_id, plugin_id) => this.get(agent_id, plugin_id),
      invoke: async (plugin_id, action_id, input) =>
        await this.invoke_main(plugin_id, action_id, input),
      invoke_config: async (plugin_id, profile_id, action_id, input) =>
        await this.invoke_config(plugin_id, profile_id, action_id, input),
    });
  }

  /** 为新加入 City 的 Agent 创建执行 Registry，并异步完成共享实例绑定。 */
  attach_agent(
    agent: Agent,
    bindings: readonly CityAgentPluginBinding[],
  ): AgentCityExtensionBinding {
    if (this.records_by_agent.has(agent.id)) {
      throw new Error(`City Plugin Runtime already contains Agent: ${agent.id}`);
    }
    assert_unique_bindings(bindings);
    const lifecycle_context: AgentPluginContext = Object.freeze({
      agent_id: agent.id,
      logger: agent.get_logger(),
      get embassy() {
        return agent_embassy(agent);
      },
      get instructions() {
        return agent.get_instructions();
      },
    });
    const registry = new PluginRegistry(lifecycle_context);
    const shared_by_plugin = new Map<string, CitySharedPluginRecord>();
    const failed_snapshots = new Map<string, PluginSnapshot>();
    const record = {
      agent,
      registry,
      shared_by_plugin,
      failed_snapshots,
      ready: Promise.resolve(),
      mutation_chain: Promise.resolve(),
    } as CityAgentPluginRuntimeRecord;
    let initial_binding = true;
    record.ready = this.bind_initial(record, bindings).finally(() => {
      initial_binding = false;
    });
    this.records_by_agent.set(agent.id, record);
    return Object.freeze({
      ensure_ready: async () => { await record.ready; },
      ensure_workspace_ready: async (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        await this.ensure_workspace_bindings(record, context);
      },
      release_workspace: async (workspace_id) => {
        await this.drop_workspace_contexts(agent.id, workspace_id);
      },
      plugins: (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        return this.ready_contextual(record, context);
      },
      tools: (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        return registry.tools(context);
      },
      execution_runtime: (workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        return this.ready_execution_runtime(record, context);
      },
      subscribe: (subscriber) => registry.subscribe_change((change) => {
        subscriber({ ...change, initial: initial_binding });
      }),
      snapshots: () => this.snapshots(agent.id),
      register_http_routes: (app, workspace, logger) => {
        const context = this.workspace_context(record, workspace, logger);
        register_plugin_http_routes({
          app,
          get_context: (plugin_name) => registry.plugin_context(context, plugin_name),
          plugins: registry.snapshots()
            .map((snapshot) => registry.get(snapshot.name))
            .filter((plugin): plugin is Plugin => plugin !== null),
        });
      },
    });
  }

  /** 停止并释放指定 Agent 的全部 Plugin 绑定。 */
  async detach_agent(agent_id_input: string): Promise<void> {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const current = this.detach_promises.get(agent_id);
    if (current) return await current;
    const record = this.records_by_agent.get(agent_id);
    if (!record) return;
    this.records_by_agent.delete(agent_id);
    await this.drop_workspace_contexts(agent_id);
    const operation = (async () => {
      await record.ready.catch(() => undefined);
      await record.registry.unregister_all();
      const releases = [...record.shared_by_plugin.values()]
        .map(async (shared) => await this.release_shared(agent_id, shared));
      record.shared_by_plugin.clear();
      const results = await Promise.allSettled(releases);
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (errors.length > 0) throw new AggregateError(errors, `City Plugin detach failed: ${agent_id}`);
    })();
    this.detach_promises.set(agent_id, operation);
    try {
      await operation;
    } finally {
      this.detach_promises.delete(agent_id);
    }
  }

  /** 停止 City 中全部 Plugin Runtime。 */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.records_by_agent.keys()].map(async (agent_id) => await this.detach_agent(agent_id)),
    );
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    for (const [plugin_id, record] of [...this.main_records].reverse()) {
      try {
        await record.registration.module.deactivate?.(record.context);
      } catch (error) {
        errors.push(error);
      }
      this.main_records.delete(plugin_id);
    }
    if (errors.length > 0) throw new AggregateError(errors, "City Plugin Runtime shutdown failed");
  }

  /** 完成一个 Agent 的初始绑定；单个 Plugin 启动失败不阻断其他绑定。 */
  private async bind_initial(
    record: CityAgentPluginRuntimeRecord,
    bindings: readonly CityAgentPluginBinding[],
  ): Promise<void> {
    for (const binding of bindings) {
      try {
        await this.register_binding(record, binding);
      } catch (error) {
        const plugin_id = String(binding.plugin_id || "").trim();
        const registration = this.registrations.get(plugin_id);
        const current_time = Date.now();
        record.failed_snapshots.set(plugin_id, {
          name: plugin_id,
          title: registration?.title ?? plugin_id,
          description: registration?.description ?? "",
          status: "error",
          registered_at: current_time,
          updated_at: current_time,
          last_error: error instanceof Error ? error.message : String(error),
        });
        record.agent.get_logger().error("City Plugin initial binding failed", {
          plugin_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** 读取一个 Agent 的 Plugin 快照。 */
  private snapshots(agent_id_input: string): PluginSnapshot[] {
    const agent_id = String(agent_id_input || "").trim();
    const record = this.records_by_agent.get(agent_id);
    return record
      ? [...record.registry.snapshots(), ...record.failed_snapshots.values()]
      : [];
  }

  /** 向一个已加入 City 的 Agent 绑定 Plugin/Profile。 */
  private async register(
    agent_id_input: string,
    binding: CityAgentPluginBinding,
  ): Promise<PluginSnapshot> {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const record = this.records_by_agent.get(agent_id);
    if (!record) throw new Error(`Agent is not registered in City Plugin Runtime: ${agent_id}`);
    await record.ready;
    return await this.enqueue_agent_mutation(record, async () =>
      await this.register_binding(record, binding));
  }

  /** 为单个 Agent 建立到共享实例的执行绑定。 */
  private async register_binding(
    record: CityAgentPluginRuntimeRecord,
    binding: CityAgentPluginBinding,
  ): Promise<PluginSnapshot> {
    const plugin_id = normalize_id(binding.plugin_id, "binding.plugin_id");
    if (record.shared_by_plugin.has(plugin_id)) {
      await this.unregister_binding(record, plugin_id);
    }
    const shared = await this.acquire_shared(record.agent, binding);
    try {
      await shared.ready;
      // Registry 发布 register 变化时，Workspace 订阅器会立即读取新的 Context；
      // 因此共享绑定必须先成为 Agent 的事实源。
      record.shared_by_plugin.set(plugin_id, shared);
      const snapshot = await record.registry.register(shared.execution_plugin);
      record.failed_snapshots.delete(plugin_id);
      await this.ensure_plugin_workspace_bindings(record, plugin_id);
      return snapshot;
    } catch (error) {
      await record.registry.unregister_and_wait(plugin_id).catch(() => undefined);
      await this.drop_workspace_plugin_contexts(record.agent.id, plugin_id).catch(() => undefined);
      if (record.shared_by_plugin.get(plugin_id) === shared) {
        record.shared_by_plugin.delete(plugin_id);
      }
      await this.release_shared(record.agent.id, shared).catch(() => undefined);
      throw error;
    }
  }

  /** 从一个 Agent 解绑 Plugin。 */
  private async unregister(agent_id_input: string, plugin_id_input: string): Promise<boolean> {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const record = this.records_by_agent.get(agent_id);
    if (!record) return false;
    await record.ready;
    return await this.enqueue_agent_mutation(record, async () => {
      const failed = record.failed_snapshots.delete(plugin_id);
      return await this.unregister_binding(record, plugin_id) || failed;
    });
  }

  /** 解除一个 Agent 的执行绑定，并在最后一个引用释放时停止共享生命周期。 */
  private async unregister_binding(
    record: CityAgentPluginRuntimeRecord,
    plugin_id: string,
  ): Promise<boolean> {
    const shared = record.shared_by_plugin.get(plugin_id);
    if (!shared) return false;
    const removed = await record.registry.unregister_and_wait(plugin_id);
    await this.drop_workspace_plugin_contexts(record.agent.id, plugin_id);
    record.shared_by_plugin.delete(plugin_id);
    await this.release_shared(record.agent.id, shared);
    return removed;
  }

  /** 读取一个 Agent 当前绑定的共享 Plugin。 */
  private get(agent_id_input: string, plugin_id_input: string): Plugin | null {
    const agent_id = String(agent_id_input || "").trim();
    const plugin_id = String(plugin_id_input || "").trim();
    return this.records_by_agent.get(agent_id)?.shared_by_plugin.get(plugin_id)?.execution_plugin ?? null;
  }

  /** 获取或创建 City 内唯一的 Plugin/Profile 实例记录。 */
  private async acquire_shared(
    agent: Agent,
    binding: CityAgentPluginBinding,
  ): Promise<CitySharedPluginRecord> {
    const plugin_id = normalize_id(binding.plugin_id, "binding.plugin_id");
    const registration = this.require_registration(plugin_id);
    await this.ensure_main_active(plugin_id);
    const profile = normalize_profile(binding.profile);
    const key = shared_key(plugin_id, profile.id);
    await this.shared_stop_promises.get(key);
    const existing = this.shared_records.get(key);
    if (existing) {
      assert_shared_registration(existing, registration, profile);
      if (!existing.agent_ids.has(agent.id)) {
        existing.agent_ids.add(agent.id);
      }
      return existing;
    }
    const creating = this.shared_creation_promises.get(key);
    if (creating) {
      const shared = await creating;
      assert_shared_registration(shared, registration, profile);
      shared.agent_ids.add(agent.id);
      return shared;
    }
    const creation = (async () => {
      const scope = this.options.city.storage.open_scope(["plugins", plugin_id, "profiles", profile.id]);
      const logger = new Logger();
      logger.bind_storage(scope.files, scope.root_path);
      const lifecycle_context: PluginLifecycleContext = Object.freeze({
        plugin_id,
        profile,
        storage: Object.freeze({ path: scope.root_path, files: scope.files }),
        logger,
      });
      const plugin = await registration.module.create(lifecycle_context);
      if (normalize_id(plugin.name, "plugin.name") !== plugin_id) {
        throw new Error(`Plugin instance ID does not match registration: ${plugin_id}`);
      }
      const execution_plugin = create_execution_plugin(plugin);
      const record = {
        key,
        plugin_id,
        module: registration.module,
        profile,
        plugin,
        logger,
        execution_plugin,
        ready: Promise.resolve(),
        lifecycle_started: false,
        agent_ids: new Set([agent.id]),
      } as CitySharedPluginRecord;
      record.ready = (async () => {
        try {
          await plugin.lifecycle?.start?.(lifecycle_context);
          record.lifecycle_started = true;
        } catch (error) {
          await Promise.resolve(plugin.lifecycle?.stop?.(lifecycle_context)).catch(() => undefined);
          throw error;
        }
      })();
      this.shared_records.set(key, record);
      try {
        await record.ready;
        return record;
      } catch (error) {
        if (this.shared_records.get(key) === record) this.shared_records.delete(key);
        throw error;
      }
    })();
    this.shared_creation_promises.set(key, creation);
    try {
      return await creation;
    } finally {
      if (this.shared_creation_promises.get(key) === creation) {
        this.shared_creation_promises.delete(key);
      }
    }
  }

  /** 释放共享实例引用；最后一个 Agent 负责停止生命周期。 */
  private async release_shared(agent_id: string, record: CitySharedPluginRecord): Promise<void> {
    record.agent_ids.delete(agent_id);
    if (record.agent_ids.size > 0) return;
    if (this.shared_records.get(record.key) === record) this.shared_records.delete(record.key);
    const stopping = (async () => {
      await record.ready.catch(() => undefined);
      if (!record.lifecycle_started) return;
      const scope = this.options.city.storage.open_scope([
        "plugins",
        record.plugin_id,
        "profiles",
        record.profile.id,
      ]);
      try {
        await record.plugin.lifecycle?.stop?.(Object.freeze({
          plugin_id: record.plugin_id,
          profile: record.profile,
          storage: Object.freeze({ path: scope.root_path, files: scope.files }),
          logger: record.logger,
        }));
      } finally {
        record.lifecycle_started = false;
      }
    })();
    this.shared_stop_promises.set(record.key, stopping);
    try {
      await stopping;
    } finally {
      if (this.shared_stop_promises.get(record.key) === stopping) {
        this.shared_stop_promises.delete(record.key);
      }
    }
  }

  /** 串行执行一个 Agent 的绑定修改，避免并发替换破坏引用计数。 */
  private async enqueue_agent_mutation<TResult>(
    record: CityAgentPluginRuntimeRecord,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = record.mutation_chain.then(operation, operation);
    record.mutation_chain = result.then(() => undefined, () => undefined);
    return await result;
  }

  /** 返回一个 Agent/Workspace 唯一的执行 Context。 */
  private workspace_context(
    record: CityAgentPluginRuntimeRecord,
    workspace: WorkspaceBase,
    logger: Logger,
  ): PluginContext {
    const key = `${record.agent.id}\u0000${workspace.id}`;
    const existing = this.workspace_contexts.get(key);
    if (existing) return existing.context;
    const storage = get_agent_storage(record.agent);
    let contextual_plugins: ReturnType<PluginRegistry["contextual"]> | undefined;
    const context_input = {
      agent_id: record.agent.id,
      agent_name: record.agent.name,
      agent_description: record.agent.description,
      workspace_id: workspace.id,
      workspace_path: workspace.path,
      data_path: storage.root_path,
      files: workspace.files,
      data_files: storage.files,
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
    const binding_promises = new Map<string, Promise<void>>();
    const workspace_shared_by_plugin = new Map<string, CitySharedPluginRecord>();
    let release_registry_context = () => {};
    const workspace_record = {
      context,
      contexts_by_plugin,
      binding_promises,
      shared_by_plugin: workspace_shared_by_plugin,
      release_registry_context: () => release_registry_context(),
    };
    this.workspace_contexts.set(key, workspace_record);
    release_registry_context = record.registry.bind_workspace_context(context, (plugin_name) => {
      const plugin_id = normalize_id(plugin_name, "plugin_id");
      const cached = contexts_by_plugin.get(plugin_id);
      if (cached) return cached;
      const shared = record.shared_by_plugin.get(plugin_id);
      if (!shared) throw new Error(`Plugin is not bound to Agent: ${record.agent.id}/${plugin_id}`);
      const scope = plugin_storage_scope(record.agent, plugin_id);
      const plugin_context = create_plugin_context({
        ...context_input,
        data_path: scope.root_path,
        data_files: scope.files,
        profile_id: shared.profile.id,
        profile_config: shared.profile.config,
        ...(this.options.host
          ? { notifications: this.options.host.notifications(plugin_id, record.agent.id) }
          : {}),
      });
      contexts_by_plugin.set(plugin_id, plugin_context);
      workspace_shared_by_plugin.set(plugin_id, shared);
      const binding_promise = shared.ready.then(async () => {
        await shared.plugin.lifecycle?.bind?.(plugin_context);
      });
      binding_promises.set(plugin_id, binding_promise);
      return plugin_context;
    });
    contextual_plugins = this.ready_contextual(record, context);
    // WorkspaceEntry 创建即触发作用域生命周期；异步调用仍会显式等待同一 Promise。
    void this.ensure_workspace_bindings(record, context).catch((error) => {
      logger.error("City Plugin workspace binding failed", {
        agent_id: record.agent.id,
        workspace_id: workspace.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return context;
  }

  /** 确保当前 Agent/Workspace 已绑定全部 configured Plugin 作用域。 */
  private async ensure_workspace_bindings(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): Promise<void> {
    await record.ready;
    const workspace_record = this.workspace_contexts.get(
      `${record.agent.id}\u0000${context.workspace.id}`,
    );
    if (!workspace_record) return;
    for (const plugin_id of record.shared_by_plugin.keys()) {
      record.registry.plugin_context(context, plugin_id);
    }
    await Promise.all(workspace_record.binding_promises.values());
  }

  /** 确保动态注册的 Plugin 已绑定当前 Agent 的全部活跃 Workspace。 */
  private async ensure_plugin_workspace_bindings(
    record: CityAgentPluginRuntimeRecord,
    plugin_id: string,
  ): Promise<void> {
    const prefix = `${record.agent.id}\u0000`;
    const bindings: Promise<void>[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix)) continue;
      record.registry.plugin_context(workspace_record.context, plugin_id);
      const binding = workspace_record.binding_promises.get(plugin_id);
      if (binding) bindings.push(binding);
    }
    await Promise.all(bindings);
  }

  /** 创建等待 Agent 初始绑定完成后再执行异步调用的只读 Plugin 面。 */
  private ready_contextual(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): AgentPluginRuntime {
    const runtime = record.registry.contextual(context);
    return Object.freeze({
      has: (plugin_name) => runtime.has(plugin_name),
      get: (plugin_name) => runtime.get(plugin_name),
      status: (plugin_name) => runtime.status(plugin_name),
      snapshots: () => runtime.snapshots(),
      list: () => runtime.list(),
      read: (params) => runtime.read(params),
      availability: async (plugin_name) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.availability(plugin_name);
      },
      run_action: async (params) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.run_action(params);
      },
      system_blocks: async (execution_context) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.system_blocks(execution_context);
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.pipeline(point_name, value);
      },
      guard: async <TValue>(point_name: string, value: TValue) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.guard(point_name, value);
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.effect(point_name, value);
      },
      resolve: async <TInput, TOutput>(point_name: string, value: TInput) => {
        await record.ready;
        await this.ensure_workspace_bindings(record, context);
        return await runtime.resolve<TInput, TOutput>(point_name, value);
      },
    });
  }

  /** 创建会等待 Workspace bind 完成的 Session 扩展执行视图。 */
  private ready_execution_runtime(
    record: CityAgentPluginRuntimeRecord,
    context: PluginContext,
  ): import("@downcity/agent/host").SessionExtensionRuntime {
    const wait_ready = async () => {
      await record.ready;
      await this.ensure_workspace_bindings(record, context);
    };
    return Object.freeze({
      read: (params) => record.registry.execution_view(context).read(params),
      run_action: async (params) => {
        await wait_ready();
        return await record.registry.execution_view(context).run_action(params);
      },
      system_blocks: async (execution_context) => {
        await wait_ready();
        return await record.registry.execution_view(context).system_blocks(execution_context);
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await record.registry.execution_view(context).pipeline(point_name, value);
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await record.registry.execution_view(context).effect(point_name, value);
      },
      acquire: async () => {
        await wait_ready();
        const lease = record.registry.execution_view(context).acquire();
        return {
          read: (params) => lease.read(params),
          run_action: async (params) => await lease.run_action(params),
          system_blocks: async (execution_context) => {
            return await lease.system_blocks(execution_context);
          },
          pipeline: async <TValue>(point_name: string, value: TValue) => {
            return await lease.pipeline(point_name, value);
          },
          effect: async <TValue>(point_name: string, value: TValue) => {
            return await lease.effect(point_name, value);
          },
          release: async () => await lease.release(),
        };
      },
    });
  }

  /** 删除一个 Agent 的全部 Workspace Context 缓存。 */
  private async drop_workspace_contexts(agent_id: string, workspace_id?: string): Promise<void> {
    const prefix = `${agent_id}\u0000`;
    const errors: unknown[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix) || (workspace_id && key !== `${prefix}${workspace_id}`)) continue;
      this.workspace_contexts.delete(key);
      workspace_record.release_registry_context();
      for (const [plugin_id, context] of workspace_record.contexts_by_plugin) {
        try {
          await workspace_record.binding_promises.get(plugin_id);
          const shared = workspace_record.shared_by_plugin.get(plugin_id);
          await shared?.plugin.lifecycle?.unbind?.(context);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `City Plugin workspace cleanup failed: ${agent_id}`);
    }
  }

  /** 只释放一个 Plugin 在现有 Workspace 中的作用域，不重启无关 Plugin。 */
  private async drop_workspace_plugin_contexts(agent_id: string, plugin_id: string): Promise<void> {
    const prefix = `${agent_id}\u0000`;
    const errors: unknown[] = [];
    for (const [key, workspace_record] of this.workspace_contexts) {
      if (!key.startsWith(prefix)) continue;
      const context = workspace_record.contexts_by_plugin.get(plugin_id);
      if (!context) continue;
      const binding = workspace_record.binding_promises.get(plugin_id);
      const shared = workspace_record.shared_by_plugin.get(plugin_id);
      workspace_record.contexts_by_plugin.delete(plugin_id);
      workspace_record.binding_promises.delete(plugin_id);
      workspace_record.shared_by_plugin.delete(plugin_id);
      try {
        await binding;
        await shared?.plugin.lifecycle?.unbind?.(context);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `City Plugin workspace cleanup failed: ${agent_id}/${plugin_id}`,
      );
    }
  }

  /** 向 City 登记 Plugin 的统一 main 与 execution factory。 */
  private provide(registration: import("@downcity/plugin").CityPluginRegistration): void {
    const plugin_id = normalize_id(registration?.id, "registration.id");
    const existing = this.registrations.get(plugin_id);
    if (existing && existing.module !== registration.module) {
      throw new Error(`Plugin module conflicts in City catalog: ${plugin_id}`);
    }
    if (!existing) this.registrations.set(plugin_id, registration);
  }

  /** 返回 City 已登记的 Plugin。 */
  private require_registration(
    plugin_id_input: string,
  ): import("@downcity/plugin").CityPluginRegistration {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const registration = this.registrations.get(plugin_id);
    if (!registration) throw new Error(`Plugin is not provided by City: ${plugin_id}`);
    return registration;
  }

  /** 首次使用时激活 City 唯一的 Plugin main。 */
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
      const context = this.create_main_context(
        registration,
        plugin_actions,
        config_actions,
      );
      const record = { registration, context, plugin_actions, config_actions };
      await registration.module.activate(context);
      this.main_records.set(plugin_id, record);
      return record;
    })();
    this.main_activation_promises.set(plugin_id, operation);
    try {
      return await operation;
    } finally {
      if (this.main_activation_promises.get(plugin_id) === operation) {
        this.main_activation_promises.delete(plugin_id);
      }
    }
  }

  /** 调用 Plugin mainview 业务 action。 */
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

  /** 创建统一 main 模块使用的 City 受限上下文。 */
  private create_main_context(
    registration: import("@downcity/plugin").CityPluginRegistration,
    plugin_actions: Map<string, PluginMainAction>,
    config_actions: Map<string, PluginConfigMainAction>,
  ): PluginMainContext {
    const plugin_id = registration.id;
    const logger = new Logger();
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
          plugin_ids: this.snapshots(agent.id).map((snapshot) => snapshot.name).sort(),
        })),
        list_workspaces: async () => this.options.city.workspaces.list().map((workspace) => ({
          workspace_id: workspace.id,
          name: workspace.id,
          workspace_path: workspace.path,
        })),
        invoke_agent_plugin: async (input) => {
          const entry = await this.options.city.enter_workspace(input.agent_id, input.workspace_id);
          return await entry.plugins.run_action({
            plugin: input.plugin_id,
            action: input.action_id,
            ...(input.input !== undefined ? { payload: input.input } : {}),
          }) as unknown as PluginJsonValue;
        },
        open_external: async ({ url }) => {
          if (!this.options.host?.open_external) {
            throw new Error("City host does not provide open_external");
          }
          await this.options.host.open_external(url);
        },
        show_item_in_folder: async ({ path }) => {
          if (!this.options.host?.show_item_in_folder) {
            throw new Error("City host does not provide show_item_in_folder");
          }
          await this.options.host.show_item_in_folder(path);
        },
        write_clipboard_text: async ({ text }) => {
          if (!this.options.host?.write_clipboard_text) {
            throw new Error("City host does not provide write_clipboard_text");
          }
          await this.options.host.write_clipboard_text(text);
        },
      }),
    });
  }
}

/** 规范化一个 Profile 快照。 */
function normalize_profile(profile?: PluginProfile): PluginProfile {
  const id = normalize_id(profile?.id || "default", "profile.id");
  return Object.freeze({
    id,
    config: Object.freeze({ ...(profile?.config ?? {}) }),
  });
}

/** 创建不会发生路径歧义的共享实例键。 */
function shared_key(plugin_id: string, profile_id: string): string {
  return `${plugin_id}\u0000${profile_id}`;
}

/** 创建保留 class 原型行为、但完全隐藏 lifecycle 的只读执行投影。 */
function create_execution_plugin(plugin: Plugin): Plugin {
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
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  });
}

/** 注册 main action，并保证 mainview/config 两个 surface 之间 ID 唯一。 */
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

/** 保证同一 City key 不会被另一份模块或冲突配置静默复用。 */
function assert_shared_registration(
  record: CitySharedPluginRecord,
  registration: import("@downcity/plugin").CityPluginRegistration,
  profile: PluginProfile,
): void {
  if (record.module !== registration.module) {
    throw new Error(`Plugin module conflicts in City: ${record.plugin_id}/${profile.id}`);
  }
  if (stable_json(record.profile.config) !== stable_json(profile.config)) {
    throw new Error(`Plugin Profile config conflicts in City: ${record.plugin_id}/${profile.id}`);
  }
}

/** 为 JSON 配置生成与对象字段插入顺序无关的稳定文本。 */
function stable_json(value: import("@downcity/plugin").PluginJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stable_json).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable_json(value[key]!)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 校验同一 Agent 不重复绑定 Plugin。 */
function assert_unique_bindings(bindings: readonly CityAgentPluginBinding[]): void {
  const plugin_ids = new Set<string>();
  for (const binding of bindings) {
    const plugin_id = normalize_id(binding.plugin_id, "binding.plugin_id");
    if (plugin_ids.has(plugin_id)) throw new Error(`Agent Plugin binding is duplicated: ${plugin_id}`);
    plugin_ids.add(plugin_id);
  }
}

/** 规范化稳定 ID。 */
function normalize_id(value: string | undefined, label: string): string {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required`);
  return id;
}
