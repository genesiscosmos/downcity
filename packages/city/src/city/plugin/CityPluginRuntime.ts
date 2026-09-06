/**
 * City 唯一 Plugin Registry 与生命周期运行时。
 *
 * 一个 City 中每个 Plugin ID 只有一个实例和一套 initialize/dispose 生命周期。
 * Agent 不保存 Registry，Workspace 也不形成 Plugin 生命周期；City 只在具体调用时
 * 根据 Agent、Workspace 与目标 Plugin 即时投影 PluginContext。
 */

import type { Hono } from "hono";
import type { Agent, Logger } from "@downcity/agent";
import { get_logger, SessionHooks } from "@downcity/agent";
import {
  get_workspace_entry,
  plugin_storage_scope,
} from "@downcity/agent/internal";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type {
  AgentPluginExecutionLease,
  AgentPluginRuntime,
} from "@/plugin/types/PluginExecutionRuntime.js";
import type {
  CityPluginRegistration,
  PluginConfigAction,
  PluginContextFactory,
  PluginDefinition,
  PluginHostAction,
  PluginJsonValue,
  PluginLifecycleContext,
  PluginSnapshot,
} from "@/plugin/index.js";
import type { CityPluginInput, CityPlugins } from "@/city/types/CityPlugin.js";
import type {
  CityAgentPluginBinding,
  CityPluginRecord,
  CityPluginRuntimeOptions,
} from "@/city/types/CityPluginRuntime.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";

/** City 唯一的 Plugin Runtime。 */
export class CityPluginRuntime {
  /** City 当前持有的唯一 Plugin 实例。 */
  private readonly plugins_by_id = new Map<string, CityPluginRecord>();

  /** 初始化失败后保留的不可执行 Plugin 状态；成功重试或显式移除时清除。 */
  private readonly failed_plugin_snapshots = new Map<string, PluginSnapshot>();

  /** 所有 Agent 共享的唯一执行 Registry。 */
  private readonly registry = new PluginRegistry();

  /** 按 Plugin ID 串行化动态添加与移除，避免同一实例生命周期交叉。 */
  private readonly plugin_lifecycle_chains = new Map<string, Promise<void>>();

  /** 新执行等待的 Plugin 初始化完成屏障。 */
  private lifecycle_stability: Promise<void> = Promise.resolve();

  /** City 关闭前需要等待的全部生命周期操作完成屏障。 */
  private lifecycle_settlement: Promise<void> = Promise.resolve();

  /** Plugin Runtime 自身的关闭状态，用于拒绝关闭期间的新执行。 */
  private runtime_status: "active" | "disposing" | "disposed" = "active";

  /** 并发关闭调用共享的唯一释放流程。 */
  private dispose_promise?: Promise<void>;

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
        await this.invoke_host_action(plugin_id, action_id, input),
      invoke_config: async (plugin_id, profile_id, action_id, input) =>
        await this.invoke_config(plugin_id, profile_id, action_id, input),
    });
  }

  /** 向 City 添加一个唯一 Plugin 实例。 */
  private add(input: CityPluginInput): Promise<void> {
    this.assert_active();
    const registration = normalize_registration(input);
    const plugin_id = normalize_id(registration.plugin.name, "plugin.name");
    const operation = this.enqueue_plugin_lifecycle(plugin_id, async () => {
      await this.add_plugin(plugin_id, registration);
    });
    this.track_lifecycle(operation);
    return operation;
  }

  /** 初始化 Plugin，并在成功后原子发布到 City 唯一 Registry。 */
  private async add_plugin(
    plugin_id: string,
    registration: CityPluginRegistration,
  ): Promise<void> {
    const existing = this.plugins_by_id.get(plugin_id);
    if (existing) {
      if (existing.plugin === registration.plugin) return await existing.ready;
      throw new Error(`Plugin already exists in City: ${plugin_id}`);
    }
    this.failed_plugin_snapshots.delete(plugin_id);

    const scope = this.options.storage.open_scope(["plugins", plugin_id]);
    const logger = get_logger();
    logger.bind_storage(scope.files, scope.root_path);
    const host_actions = new Map<string, PluginHostAction>();
    const config_actions = new Map<string, PluginConfigAction>();
    const lifecycle_context = this.create_lifecycle_context(
      plugin_id,
      Object.freeze({ path: scope.root_path, files: scope.files }),
      logger,
      host_actions,
      config_actions,
    );
    const current_time = Date.now();
    const record: CityPluginRecord = {
      plugin_id,
      registration,
      plugin: registration.plugin,
      logger,
      lifecycle_context,
      host_actions,
      config_actions,
      ready: Promise.resolve(),
      active_host_calls: 0,
      lifecycle_active: true,
      state: "initializing",
      registered_at: current_time,
      updated_at: current_time,
    };
    this.plugins_by_id.set(plugin_id, record);
    record.ready = this.initialize_plugin(record);
    void record.ready.catch(() => undefined);

    try {
      await record.ready;
      await this.registry.register(record.plugin);
    } catch (error) {
      if (this.plugins_by_id.get(plugin_id) === record) {
        this.plugins_by_id.delete(plugin_id);
      }
      await this.registry.unregister_and_wait(plugin_id);
      let lifecycle_error = error;
      try {
        await this.dispose_plugin(record);
      } catch (dispose_error) {
        lifecycle_error = new AggregateError(
          [error, dispose_error],
          `City Plugin initialization cleanup failed: ${plugin_id}`,
        );
      }
      this.failed_plugin_snapshots.set(plugin_id, {
        ...to_plugin_snapshot(record),
        status: "error",
        last_error: to_error_message(lifecycle_error),
      });
      throw lifecycle_error;
    }
  }

  /** 从 City 立即隐藏 Plugin，等待既有 execution lease 后再释放实例。 */
  private remove(plugin_id_input: string): Promise<boolean> {
    this.assert_active();
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const operation = this.enqueue_plugin_lifecycle(plugin_id, async () => {
      const record = this.plugins_by_id.get(plugin_id);
      if (!record) return this.failed_plugin_snapshots.delete(plugin_id);
      this.plugins_by_id.delete(plugin_id);
      this.failed_plugin_snapshots.delete(plugin_id);
      const errors: unknown[] = [];
      try {
        await this.registry.unregister_and_wait(plugin_id);
      } catch (error) {
        errors.push(error);
      }
      await this.wait_record_idle(record);
      try {
        await this.dispose_plugin(record);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `City Plugin removal failed: ${plugin_id}`);
      }
      return true;
    });
    this.track_lifecycle(operation, false);
    return operation;
  }

  /** 把一次生命周期操作加入 City 稳定性屏障，失败不会污染其他 Plugin。 */
  private track_lifecycle(
    operation: Promise<unknown>,
    blocks_execution = true,
  ): void {
    const settled = operation.then(() => undefined, () => undefined);
    this.lifecycle_settlement = Promise.all([
      this.lifecycle_settlement,
      settled,
    ]).then(() => undefined);
    if (blocks_execution) {
      this.lifecycle_stability = Promise.all([
        this.lifecycle_stability,
        settled,
      ]).then(() => undefined);
    }
  }

  /** 按 Plugin ID 串行执行一次完整生命周期修改。 */
  private enqueue_plugin_lifecycle<TResult>(
    plugin_id: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.plugin_lifecycle_chains.get(plugin_id);
    const result = previous ? previous.then(operation, operation) : operation();
    const settled = result.then(() => undefined, () => undefined);
    this.plugin_lifecycle_chains.set(plugin_id, settled);
    void settled.finally(() => {
      if (this.plugin_lifecycle_chains.get(plugin_id) === settled) {
        this.plugin_lifecycle_chains.delete(plugin_id);
      }
    });
    return result;
  }

  /** 返回 City 当前全部 Plugin 快照。 */
  private snapshots(): PluginSnapshot[] {
    return [
      ...[...this.plugins_by_id.values()].map(to_plugin_snapshot),
      ...this.failed_plugin_snapshots.values(),
    ]
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 返回 City 当前持有的唯一 Plugin 实例。 */
  private get(plugin_id_input: string): PluginDefinition | null {
    return this.plugins_by_id.get(String(plugin_id_input || "").trim())?.plugin ?? null;
  }

  /** 为 Agent 创建只捕获主体引用的无状态执行网关。 */
  attach_agent(agent: Agent): CityAgentPluginBinding {
    const initial_plugin_records = new Set(this.plugins_by_id.values());
    return Object.freeze({
      ensure_ready: async () => await this.lifecycle_stability,
      tools: (workspace, logger) => {
        const context_factory = this.context_factory(agent, workspace, logger);
        const runtime = this.ready_contextual(context_factory);
        return this.registry.tools(context_factory, runtime);
      },
      hooks: (workspace, logger) =>
        this.session_hooks(this.context_factory(agent, workspace, logger)),
      subscribe: (subscriber) => this.registry.subscribe_change((change) => {
        const record = this.plugins_by_id.get(change.plugin_name);
        const initial = change.type === "register"
          && record !== undefined
          && initial_plugin_records.delete(record);
        subscriber({
          type: change.type === "register" ? "add" : "remove",
          plugin_id: change.plugin_name,
          initial,
        });
      }),
    });
  }

  /** City 开始关闭时立即封闭新的 Plugin 生命周期操作与直接执行。 */
  begin_shutdown(): void {
    if (this.runtime_status === "active") {
      this.runtime_status = "disposing";
    }
  }

  /** 关闭唯一 Registry，并按注册逆序释放全部 Plugin 实例。 */
  async dispose(): Promise<void> {
    if (this.runtime_status === "disposed") return;
    if (!this.dispose_promise) {
      this.begin_shutdown();
      this.dispose_promise = this.dispose_runtime().finally(() => {
        this.runtime_status = "disposed";
      });
    }
    await this.dispose_promise;
  }

  /** 执行唯一一次 Plugin Registry 与实例释放流程。 */
  private async dispose_runtime(): Promise<void> {
    await this.lifecycle_settlement;
    const records = [...this.plugins_by_id.values()].reverse();
    this.plugins_by_id.clear();
    this.failed_plugin_snapshots.clear();
    const errors: unknown[] = [];
    try {
      await this.registry.unregister_all();
    } catch (error) {
      errors.push(error);
    }
    for (const record of records) {
      try {
        await this.wait_record_idle(record);
        await this.dispose_plugin(record);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "City Plugin Runtime shutdown failed");
    }
  }

  /** 初始化一个 City Plugin 实例。 */
  private async initialize_plugin(record: CityPluginRecord): Promise<void> {
    try {
      await record.plugin.initialize?.(record.lifecycle_context);
      record.state = "ready";
      record.updated_at = Date.now();
    } catch (error) {
      record.state = "error";
      record.last_error = error instanceof Error ? error.message : String(error);
      record.updated_at = Date.now();
      throw error;
    }
  }

  /** 幂等释放一个 City Plugin 实例。 */
  private async dispose_plugin(record: CityPluginRecord): Promise<void> {
    await record.ready.catch(() => undefined);
    if (!record.lifecycle_active) return;
    record.lifecycle_active = false;
    try {
      await record.plugin.dispose?.(record.lifecycle_context);
    } finally {
      record.updated_at = Date.now();
    }
  }

  /** 为一次 Plugin 调用创建动态上下文工厂，不缓存 Workspace 或 Plugin Context。 */
  private context_factory(
    agent: Agent,
    workspace: WorkspaceRuntime,
    logger: Logger,
  ): PluginContextFactory {
    let contextual_plugins: AgentPluginRuntime | undefined;
    const context_factory: PluginContextFactory = (plugin_id_input) => {
      const plugin_id = normalize_id(plugin_id_input, "plugin_id");
      const plugin_storage = plugin_storage_scope(agent, plugin_id);
      return create_plugin_context({
        agent_id: agent.id,
        agent_name: agent.name,
        agent_description: agent.description,
        workspace_id: workspace.id,
        workspace_path: workspace.path,
        data_path: plugin_storage.root_path,
        files: workspace.files,
        data_files: plugin_storage.files,
        get_config: () => this.options.host?.runtime_config?.(plugin_id, agent.id) ?? {},
        ...(workspace.shell ? { shell: workspace.shell } : {}),
        logger,
        embassy: this.options.embassy,
        ...(this.options.host
          ? { notifications: this.options.host.notifications(plugin_id, agent.id) }
          : {}),
        get_workspace_env: () => workspace.get_env(),
        get_instructions: () => agent.get_instructions(),
        get_plugins: () => {
          contextual_plugins ??= this.ready_contextual(context_factory);
          return contextual_plugins;
        },
        get_sessions: () => get_workspace_entry(agent, workspace.id)?.sessions
          ?? agent.sessions,
      });
    };
    return context_factory;
  }

  /** 在当前 Registry 快照上运行操作，并始终释放 execution lease。 */
  private async with_execution_lease<TResult>(
    context_factory: PluginContextFactory,
    operation: (lease: AgentPluginExecutionLease) => Promise<TResult>,
  ): Promise<TResult> {
    this.assert_active();
    const lease = this.registry.execution_view(context_factory).acquire();
    try {
      return await operation(lease);
    } finally {
      await lease.release();
    }
  }

  /** 创建等待 City 生命周期稳定后再执行的 Plugin 调用面。 */
  private ready_contextual(context_factory: PluginContextFactory): AgentPluginRuntime {
    const runtime = this.registry.contextual(context_factory);
    const wait_ready = async () => await this.lifecycle_stability;
    return Object.freeze({
      has: (plugin_name) => runtime.has(plugin_name),
      get: (plugin_name) => runtime.get(plugin_name),
      status: (plugin_name) => runtime.status(plugin_name),
      snapshots: () => runtime.snapshots(),
      list: () => runtime.list(),
      read: (params) => runtime.read(params),
      availability: async (plugin_name) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.availability(plugin_name),
        );
      },
      run_action: async (params) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.run_action(params),
        );
      },
      system_blocks: async (execution_context) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.system_blocks(execution_context),
        );
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.pipeline(point_name, value),
        );
      },
      guard: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.guard(point_name, value),
        );
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.effect(point_name, value),
        );
      },
      resolve: async <TInput, TOutput>(point_name: string, value: TInput) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.resolve<TInput, TOutput>(point_name, value),
        );
      },
    });
  }

  /** 创建 Agent/Workspace 对应的 Session Hook 集合。 */
  private session_hooks(context_factory: PluginContextFactory): SessionHooks {
    const wait_ready = async () => await this.lifecycle_stability;
    return new SessionHooks({
      system_blocks: async (hook_context) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.system_blocks(hook_context),
        );
      },
      pipeline: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        return await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.pipeline(point_name, value),
        );
      },
      effect: async <TValue>(point_name: string, value: TValue) => {
        await wait_ready();
        await this.with_execution_lease(
          context_factory,
          async (lease) => await lease.effect(point_name, value),
        );
      },
      open: async () => {
        await wait_ready();
        this.assert_active();
        const lease = this.registry.execution_view(context_factory).acquire();
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
    const entry = this.options.runtime_access.require_workspace(agent_id, workspace_id_input);
    return this.ready_contextual(
      this.context_factory(entry.agent, entry.workspace, entry.get_logger()),
    );
  }

  /** 注册当前 Agent/Workspace 下全部 Plugin HTTP 路由。 */
  private register_http_routes(
    app: Hono,
    agent_id_input: string,
    workspace_id_input: string,
  ): void {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const entry = this.options.runtime_access.require_workspace(agent_id, workspace_id_input);
    const context_factory = this.context_factory(
      entry.agent,
      entry.workspace,
      entry.get_logger(),
    );
    register_plugin_http_routes({
      app,
      get_context: context_factory,
      plugins: this.registry.snapshots()
        .map((snapshot) => this.registry.get(snapshot.name))
        .filter((plugin): plugin is PluginDefinition => plugin !== null),
    });
  }

  /** 等待并返回指定的 City Plugin 记录。 */
  private async require_ready_record(plugin_id_input: string): Promise<CityPluginRecord> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const record = this.plugins_by_id.get(plugin_id);
    if (!record) {
      const failed = this.failed_plugin_snapshots.get(plugin_id);
      if (failed) {
        throw new Error(`Plugin is unavailable in City: ${plugin_id}: ${failed.last_error || "initialization failed"}`);
      }
      throw new Error(`Plugin is not registered in City: ${plugin_id}`);
    }
    await record.ready;
    return record;
  }

  /** 调用 Plugin 注册的宿主管理 action。 */
  private async invoke_host_action(
    plugin_id_input: string,
    action_id_input: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    const plugin_id = normalize_id(plugin_id_input, "plugin_id");
    const action_id = normalize_id(action_id_input, "action_id");
    return await this.with_record_execution(plugin_id, async (record) => {
      const action = record.host_actions.get(action_id);
      if (!action) throw new Error(`Plugin host action not found: ${plugin_id}/${action_id}`);
      return normalize_json_value(await action.run(input), `${plugin_id}/${action_id} result`);
    });
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
    return await this.with_record_execution(plugin_id, async (record) => {
      const action = record.config_actions.get(action_id);
      if (!action) throw new Error(`Plugin config action not found: ${plugin_id}/${action_id}`);
      const config = this.options.host?.profile_config(plugin_id, profile_id);
      if (!config) throw new Error("City Plugin config actions require a profile host");
      return normalize_json_value(
        await action.run(input, { config }),
        `${plugin_id}/${action_id} result`,
      );
    });
  }

  /** 在 Plugin 仍属于 City 时持有一次宿主管理调用租约。 */
  private async with_record_execution<TResult>(
    plugin_id: string,
    operation: (record: CityPluginRecord) => Promise<TResult>,
  ): Promise<TResult> {
    const record = await this.require_ready_record(plugin_id);
    this.assert_active();
    if (this.plugins_by_id.get(plugin_id) !== record) {
      throw new Error(`Plugin is not registered in City: ${plugin_id}`);
    }
    record.active_host_calls += 1;
    try {
      return await operation(record);
    } finally {
      record.active_host_calls = Math.max(0, record.active_host_calls - 1);
      if (record.active_host_calls === 0) {
        record.resolve_host_calls_idle?.();
        delete record.resolve_host_calls_idle;
        delete record.host_calls_idle;
      }
    }
  }

  /** 等待 Plugin 已经开始的宿主管理调用全部收口。 */
  private async wait_record_idle(record: CityPluginRecord): Promise<void> {
    if (record.active_host_calls === 0) return;
    record.host_calls_idle ??= new Promise<void>((resolve) => {
      record.resolve_host_calls_idle = resolve;
    });
    await record.host_calls_idle;
  }

  /** 拒绝 Runtime 关闭后新增生命周期操作或执行。 */
  private assert_active(): void {
    if (this.runtime_status !== "active") {
      throw new Error(`City Plugin Runtime is ${this.runtime_status}`);
    }
  }

  /** 创建 initialize/dispose 共享的稳定 City 级上下文。 */
  private create_lifecycle_context(
    plugin_id: string,
    storage: PluginLifecycleContext["storage"],
    logger: Logger,
    host_actions: Map<string, PluginHostAction>,
    config_actions: Map<string, PluginConfigAction>,
  ): PluginLifecycleContext {
    const notifications = this.options.host?.notifications(plugin_id) ?? {
      publish: async () => {},
      dismiss: async () => {},
    };
    return Object.freeze({
      plugin: Object.freeze({
        id: plugin_id,
        action: (action: PluginHostAction) =>
          register_host_action(plugin_id, host_actions, config_actions, action, "host"),
        config_action: (action: PluginConfigAction) =>
          register_host_action(plugin_id, config_actions, host_actions, action, "config"),
      }),
      storage,
      logger,
      notifications,
      system: Object.freeze({
        list_agents: async () => this.options.runtime_access.list_agents().map((agent) => ({
          agent_id: agent.id,
          name: agent.name,
          plugin_ids: this.registry.snapshots().map((snapshot) => snapshot.name),
        })),
        list_workspaces: async () => this.options.runtime_access.list_workspaces().map((workspace) => ({
          workspace_id: workspace.id,
          name: workspace.name ?? workspace.id,
          workspace_path: workspace.path,
        })),
        invoke_agent_plugin: async (input) => {
          await this.options.runtime_access.enter_workspace(input.agent_id, input.workspace_id);
          return await this.scope(input.agent_id, input.workspace_id).run_action({
            plugin: input.plugin_id,
            action: input.action_id,
            ...(input.input !== undefined ? { payload: input.input } : {}),
          }) as unknown as PluginJsonValue;
        },
        append_agent_session_assistant_message: async (input) => {
          const entry = await this.options.runtime_access.enter_workspace(
            input.agent_id,
            input.workspace_id,
          );
          await entry.sessions.get(input.session_id, input.origin_type);
          await entry.sessions.runtime(
            input.session_id,
            input.origin_type,
          ).append_assistant_message({ text: input.text });
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

/** 把 City 内部生命周期记录投影为稳定公开快照。 */
function to_plugin_snapshot(record: CityPluginRecord): PluginSnapshot {
  return {
    name: record.plugin_id,
    title: record.plugin.title,
    description: record.plugin.description,
    status: record.state,
    registered_at: record.registered_at,
    updated_at: record.updated_at,
    ...(record.last_error ? { last_error: record.last_error } : {}),
  };
}

/** 把未知生命周期失败转换为宿主可展示的稳定文本。 */
function to_error_message(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(to_error_message).filter(Boolean).join("; ")
      || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 把 Plugin 或完整注册项归一化为 City 注册项。 */
function normalize_registration(input: CityPluginInput): CityPluginRegistration {
  if ("plugin" in input) return input;
  return {
    readme: "",
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    plugin: input,
  };
}

/** 注册宿主 action，并保证两个 surface 之间 ID 唯一。 */
function register_host_action<TAction extends PluginHostAction | PluginConfigAction>(
  plugin_id: string,
  target: Map<string, TAction>,
  other: Map<string, PluginHostAction | PluginConfigAction>,
  action: TAction,
  surface: "host" | "config",
): void {
  const action_id = normalize_id(action.id, "action.id");
  if (target.has(action_id) || other.has(action_id)) {
    throw new Error(`Plugin ${surface} action is already registered: ${plugin_id}/${action_id}`);
  }
  target.set(action_id, { ...action, id: action_id });
}

/** 拒绝宿主 action 边界中的非 JSON 返回值。 */
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
