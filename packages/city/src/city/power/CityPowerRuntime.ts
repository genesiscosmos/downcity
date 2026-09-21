/**
 * City 唯一 Power Registry 与生命周期运行时。
 *
 * 一个 City 中每个 Power ID 只有一个实例和一套 initialize/dispose 生命周期。
 * Agent 不保存 Registry；City 在 Power 集合变化时把编译产物推送给全部 Agent，
 * 具体调用由 Agent 在执行时注入调用环境。
 *
 * 关键点（中文）
 * - 不存在全局生命周期屏障：单个 Power 的初始化只影响它自己。
 * - 不存在 execution lease：Power 被移除时正在执行的调用按各自实现收口。
 */

import type { Hono } from "hono";
import type { Agent, Logger } from "@downcity/agent";
import { get_logger } from "@downcity/agent";
import type { AgentTool, ToolCallContext, ToolHookSet } from "@downcity/type";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type {
  CityPowerRegistration,
  PowerConfigAction,
  PowerContext,
  PowerContextFactory,
  PowerDefinition,
  PowerExecutionContext,
  PowerHostAction,
  PowerJsonValue,
  PowerLifecycleContext,
  PowerSnapshot,
} from "@/power/index.js";
import type { CityPowerInput, CityPowers } from "@/city/types/CityPower.js";
import type {
  CityPowerRecord,
  CityPowerRuntimeOptions,
} from "@/city/types/CityPowerRuntime.js";
import { PowerRegistry } from "@/power/core/PowerRegistry.js";
import { create_power_context } from "@/power/core/PowerContext.js";
import { create_power_session_collection } from "@/city/power/PowerSessionBridge.js";
import { register_power_http_routes } from "@/power/core/PowerHttpRoutes.js";

/** City 唯一的 Power Runtime。 */
export class CityPowerRuntime {
  /** City 当前持有的唯一 Power 实例。 */
  private readonly powers_by_id = new Map<string, CityPowerRecord>();

  /** 初始化失败后保留的不可执行 Power 状态；成功重试或显式移除时清除。 */
  private readonly failed_power_snapshots = new Map<string, PowerSnapshot>();

  /** 所有 Agent 共享的唯一执行 Registry。 */
  private readonly registry = new PowerRegistry();

  /** 按 Power ID 串行化动态添加与移除，避免同一实例生命周期交叉。 */
  private readonly power_lifecycle_chains = new Map<string, Promise<void>>();

  /**
   * City 关闭前需要等待的全部生命周期操作。
   *
   * 关键点（中文）：它只用于关闭收口，不会阻塞任何 Power 的执行；
   * 单个 Power 初始化慢不会影响其他 Power 或 Session。
   */
  private lifecycle_settlement: Promise<void> = Promise.resolve();

  /** Power Runtime 自身的关闭状态，用于拒绝关闭期间的新执行。 */
  private runtime_status: "active" | "disposing" | "disposed" = "active";

  /** 并发关闭调用共享的唯一释放流程。 */
  private dispose_promise?: Promise<void>;

  /** 编译产物变化订阅器；宿主用它把新产物推送给 Agent。 */
  private readonly surface_subscribers = new Set<() => void>();

  /** City 向应用提供的 Power 集合入口。 */
  readonly public_api: CityPowers;

  constructor(private readonly options: CityPowerRuntimeOptions) {
    this.public_api = Object.freeze({
      add: (input) => this.add(input),
      remove: async (power_id) => await this.remove(power_id),
      snapshots: () => this.snapshots(),
      get: (power_id) => this.get(power_id),
      scope: (input) => this.scope(input.agent_id, input.workspace_id),
      register_http_routes: (app, input) => {
        this.register_http_routes(app, input.agent_id, input.workspace_id);
      },
      invoke: async (power_id, action_id, input) =>
        await this.invoke_host_action(power_id, action_id, input),
      invoke_config: async (power_id, action_id, input) =>
        await this.invoke_config(power_id, action_id, input),
      subscribe_surface: (subscriber) => {
        this.surface_subscribers.add(subscriber);
        return () => {
          this.surface_subscribers.delete(subscriber);
        };
      },
      settled: async () => await this.lifecycle_settlement,
    });
  }

  /**
   * 为指定 Agent 编译当前 Power 产物。
   *
   * 关键点（中文）
   * - 产物是普通值与普通函数，Agent 持有后执行时不再回查 City。
   * - Workspace 不属于编译输入：同一个 Agent 可以进入多个 Workspace，
   *   执行时由 Agent 通过调用环境注入，City 在调用点解析出对应 Workspace。
   */
  compile_surface(agent: Agent): { tools: Record<string, AgentTool>; hooks: ToolHookSet } {
    const context_factory = this.context_factory(agent);
    return {
      tools: this.registry.tools(context_factory),
      hooks: this.registry.hooks(context_factory),
    };
  }

  /** 向 City 添加一个唯一 Power 实例。 */
  private add(input: CityPowerInput): Promise<void> {
    this.assert_active();
    const registration = normalize_registration(input);
    const power_id = normalize_id(registration.power.name, "power.name");
    const operation = this.enqueue_power_lifecycle(power_id, async () => {
      await this.add_power(power_id, registration);
    });
    this.track_lifecycle(operation);
    return operation;
  }

  /** 初始化 Power，并在成功后原子发布到 City 唯一 Registry。 */
  private async add_power(
    power_id: string,
    registration: CityPowerRegistration,
  ): Promise<void> {
    const existing = this.powers_by_id.get(power_id);
    if (existing) {
      if (existing.power === registration.power) return await existing.ready;
      throw new Error(`Power already exists in City: ${power_id}`);
    }
    this.failed_power_snapshots.delete(power_id);

    const scope = this.options.storage.open_scope(["powers", power_id]);
    const logger = get_logger();
    logger.bind_storage(scope.files, scope.root_path);
    const host_actions = new Map<string, PowerHostAction>();
    const config_actions = new Map<string, PowerConfigAction>();
    const lifecycle_context = this.create_lifecycle_context(
      power_id,
      Object.freeze({ path: scope.root_path, files: scope.files }),
      logger,
      host_actions,
      config_actions,
    );
    const current_time = Date.now();
    const record: CityPowerRecord = {
      power_id,
      registration,
      power: registration.power,
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
    this.powers_by_id.set(power_id, record);
    record.ready = this.initialize_power(record);
    void record.ready.catch(() => undefined);

    try {
      await record.ready;
      await this.registry.register(record.power);
      this.publish_surface_change();
    } catch (error) {
      if (this.powers_by_id.get(power_id) === record) {
        this.powers_by_id.delete(power_id);
      }
      await this.registry.unregister(power_id);
      let lifecycle_error = error;
      try {
        await this.dispose_power(record);
      } catch (dispose_error) {
        lifecycle_error = new AggregateError(
          [error, dispose_error],
          `City Power initialization cleanup failed: ${power_id}`,
        );
      }
      this.failed_power_snapshots.set(power_id, {
        ...to_power_snapshot(record),
        status: "error",
        last_error: to_error_message(lifecycle_error),
      });
      this.publish_surface_change();
      throw lifecycle_error;
    }
  }

  /**
   * 从 City 移除 Power，并在宿主管理调用收口后释放实例。
   *
   * 关键点（中文）：不存在 execution lease；Power 内部的长任务由实现自行收口。
   */
  private remove(power_id_input: string): Promise<boolean> {
    this.assert_active();
    const power_id = normalize_id(power_id_input, "power_id");
    const operation = this.enqueue_power_lifecycle(power_id, async () => {
      const record = this.powers_by_id.get(power_id);
      if (!record) return this.failed_power_snapshots.delete(power_id);
      this.powers_by_id.delete(power_id);
      this.failed_power_snapshots.delete(power_id);
      const errors: unknown[] = [];
      try {
        await this.registry.unregister(power_id);
      } catch (error) {
        errors.push(error);
      }
      this.publish_surface_change();
      await this.wait_record_idle(record);
      try {
        await this.dispose_power(record);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `City Power removal failed: ${power_id}`);
      }
      return true;
    });
    this.track_lifecycle(operation);
    return operation;
  }

  /** 把一次生命周期操作加入关闭收口屏障，失败不会污染其他 Power。 */
  private track_lifecycle(operation: Promise<unknown>): void {
    const settled = operation.then(() => undefined, () => undefined);
    this.lifecycle_settlement = Promise.all([
      this.lifecycle_settlement,
      settled,
    ]).then(() => undefined);
  }

  /** 按 Power ID 串行执行一次完整生命周期修改。 */
  private enqueue_power_lifecycle<TResult>(
    power_id: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.power_lifecycle_chains.get(power_id);
    const result = previous ? previous.then(operation, operation) : operation();
    const settled = result.then(() => undefined, () => undefined);
    this.power_lifecycle_chains.set(power_id, settled);
    void settled.finally(() => {
      if (this.power_lifecycle_chains.get(power_id) === settled) {
        this.power_lifecycle_chains.delete(power_id);
      }
    });
    return result;
  }

  /** 返回 City 当前全部 Power 快照。 */
  private snapshots(): PowerSnapshot[] {
    return [
      ...[...this.powers_by_id.values()].map(to_power_snapshot),
      ...this.failed_power_snapshots.values(),
    ]
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 返回 City 当前持有的唯一 Power 实例。 */
  private get(power_id_input: string): PowerDefinition | null {
    return this.powers_by_id.get(String(power_id_input || "").trim())?.power ?? null;
  }

  /** City 开始关闭时立即封闭新的 Power 生命周期操作与直接执行。 */
  begin_shutdown(): void {
    if (this.runtime_status === "active") {
      this.runtime_status = "disposing";
    }
  }

  /** 关闭唯一 Registry，并按注册逆序释放全部 Power 实例。 */
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

  /** 执行唯一一次 Power Registry 与实例释放流程。 */
  private async dispose_runtime(): Promise<void> {
    await this.lifecycle_settlement;
    const records = [...this.powers_by_id.values()].reverse();
    this.powers_by_id.clear();
    this.failed_power_snapshots.clear();
    const errors: unknown[] = [];
    try {
      await this.registry.unregister_all();
    } catch (error) {
      errors.push(error);
    }
    for (const record of records) {
      try {
        await this.wait_record_idle(record);
        await this.dispose_power(record);
      } catch (error) {
        errors.push(error);
      }
    }
    this.surface_subscribers.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "City Power Runtime shutdown failed");
    }
  }

  /** 初始化一个 City Power 实例。 */
  private async initialize_power(record: CityPowerRecord): Promise<void> {
    try {
      await record.power.initialize?.(record.lifecycle_context);
      record.state = "ready";
      record.updated_at = Date.now();
    } catch (error) {
      record.state = "error";
      record.last_error = error instanceof Error ? error.message : String(error);
      record.updated_at = Date.now();
      throw error;
    }
  }

  /** 幂等释放一个 City Power 实例。 */
  private async dispose_power(record: CityPowerRecord): Promise<void> {
    await record.ready.catch(() => undefined);
    if (!record.lifecycle_active) return;
    record.lifecycle_active = false;
    try {
      await record.power.dispose?.(record.lifecycle_context);
    } finally {
      record.updated_at = Date.now();
    }
  }

  /** 通知订阅者重新编译并推送产物。 */
  private publish_surface_change(): void {
    for (const subscriber of this.surface_subscribers) {
      try {
        subscriber();
      } catch {
        // 观察者失败不能回滚已经完成的 Power 集合修改。
      }
    }
  }

  /**
   * 为一次 Power 调用创建动态上下文工厂。
   *
   * 关键点（中文）
   * - 工厂只在调用发生时使用，不缓存 Workspace 或 PowerContext。
   * - Agent 注入的 ToolCallContext 同时提供执行身份与 Workspace，
   *   City 在此之上补齐自身句柄。
   */
  private context_factory(agent: Agent): PowerContextFactory {
    const build_context = (
      power_id: string,
      call_context: ToolCallContext,
    ): PowerContext => {
      const workspace = this.require_call_workspace(agent.id, call_context);
      const power_storage = this.options.storage.open_scope([
        "agents",
        agent.id,
        "powers",
        power_id,
      ]);
      return create_power_context({
        agent_id: agent.id,
        agent_name: agent.name,
        agent_description: agent.description,
        workspace_id: workspace.id,
        workspace_path: workspace.path,
        workspace,
        data_path: power_storage.root_path,
        files: workspace.files,
        data_files: power_storage.files,
        get_config: () => this.options.host?.config?.(power_id).get() ?? {},
        ...(workspace.shell ? { shell: workspace.shell } : {}),
        logger: agent.get_logger(),
        embassy: this.options.embassy,
        ...(this.options.host
          ? { notifications: this.options.host.notifications(power_id, agent.id) }
          : {}),
        get_workspace_env: () => workspace.get_env(),
        get_instructions: () => agent.get_instructions(),
        get_powers: () => this.registry.contextual(
          build_context,
          (execution_context) => merge_call_context(call_context, execution_context),
        ),
        sessions: create_power_session_collection({
          get_sessions: () => agent.sessions,
          workspace,
        }),
      });
    };
    return build_context;
  }

  /** 解析一次调用所属的 Workspace；缺少绑定时报出装配错误。 */
  private require_call_workspace(
    agent_id: string,
    call_context: ToolCallContext,
  ): WorkspaceRuntime {
    const workspace = call_context.workspace;
    if (!workspace) {
      throw new Error(`Power call requires a Workspace: ${agent_id}`);
    }
    return this.options.runtime_access.require_workspace(agent_id, workspace.id);
  }

  /** 返回一个 Agent/Workspace 的直接 Power 执行面。 */
  private scope(agent_id_input: string, workspace_id_input: string): AgentPowerRuntime {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const agent = this.options.runtime_access.get_agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    const workspace = this.options.runtime_access.require_workspace(agent_id, workspace_id_input);
    return this.registry.contextual(
      this.context_factory(agent),
      (execution_context) => create_call_context({
        agent_id: agent.id,
        agent_name: agent.name,
        agent_description: agent.description,
        agent_instructions: agent.get_instructions(),
        workspace,
        execution_context,
      }),
    );
  }

  /** 注册当前 Agent/Workspace 下全部 Power HTTP 路由。 */
  private register_http_routes(
    app: Hono,
    agent_id_input: string,
    workspace_id_input: string,
  ): void {
    const agent_id = normalize_id(agent_id_input, "agent_id");
    const agent = this.options.runtime_access.get_agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    const workspace = this.options.runtime_access.require_workspace(agent_id, workspace_id_input);
    const context_factory = this.context_factory(agent);
    register_power_http_routes({
      app,
      get_context: (power_id) => context_factory(
        power_id,
        create_call_context({
          agent_id: agent.id,
          agent_name: agent.name,
          agent_description: agent.description,
          agent_instructions: agent.get_instructions(),
          workspace,
        }),
      ),
      powers: this.registry.snapshots()
        .map((snapshot) => this.registry.get(snapshot.name))
        .filter((power): power is PowerDefinition => power !== null),
    });
  }

  /** 等待并返回指定的 City Power 记录。 */
  private async require_ready_record(power_id_input: string): Promise<CityPowerRecord> {
    const power_id = normalize_id(power_id_input, "power_id");
    const record = this.powers_by_id.get(power_id);
    if (!record) {
      const failed = this.failed_power_snapshots.get(power_id);
      if (failed) {
        throw new Error(`Power is unavailable in City: ${power_id}: ${failed.last_error || "initialization failed"}`);
      }
      throw new Error(`Power is not registered in City: ${power_id}`);
    }
    await record.ready;
    return record;
  }

  /** 调用 Power 注册的宿主管理 action。 */
  private async invoke_host_action(
    power_id_input: string,
    action_id_input: string,
    input?: PowerJsonValue,
  ): Promise<PowerJsonValue> {
    const power_id = normalize_id(power_id_input, "power_id");
    const action_id = normalize_id(action_id_input, "action_id");
    return await this.with_record_execution(power_id, async (record) => {
      const action = record.host_actions.get(action_id);
      if (!action) throw new Error(`Power host action not found: ${power_id}/${action_id}`);
      return normalize_json_value(await action.run(input), `${power_id}/${action_id} result`);
    });
  }

  /** 调用 Power 的唯一 Config action。 */
  private async invoke_config(
    power_id_input: string,
    action_id_input: string,
    input?: PowerJsonValue,
  ): Promise<PowerJsonValue> {
    const power_id = normalize_id(power_id_input, "power_id");
    const action_id = normalize_id(action_id_input, "action_id");
    return await this.with_record_execution(power_id, async (record) => {
      const action = record.config_actions.get(action_id);
      if (!action) throw new Error(`Power config action not found: ${power_id}/${action_id}`);
      return normalize_json_value(
        await action.run(input, { config: record.lifecycle_context.config }),
        `${power_id}/${action_id} result`,
      );
    });
  }

  /** 在 Power 仍属于 City 时持有一次宿主管理调用。 */
  private async with_record_execution<TResult>(
    power_id: string,
    operation: (record: CityPowerRecord) => Promise<TResult>,
  ): Promise<TResult> {
    const record = await this.require_ready_record(power_id);
    this.assert_active();
    if (this.powers_by_id.get(power_id) !== record) {
      throw new Error(`Power is not registered in City: ${power_id}`);
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

  /** 等待 Power 已经开始的宿主管理调用全部收口。 */
  private async wait_record_idle(record: CityPowerRecord): Promise<void> {
    if (record.active_host_calls === 0) return;
    record.host_calls_idle ??= new Promise<void>((resolve) => {
      record.resolve_host_calls_idle = resolve;
    });
    await record.host_calls_idle;
  }

  /** 拒绝 Runtime 关闭后新增生命周期操作或执行。 */
  private assert_active(): void {
    if (this.runtime_status !== "active") {
      throw new Error(`City Power Runtime is ${this.runtime_status}`);
    }
  }

  /** 创建 initialize/dispose 共享的稳定 City 级上下文。 */
  private create_lifecycle_context(
    power_id: string,
    storage: PowerLifecycleContext["storage"],
    logger: Logger,
    host_actions: Map<string, PowerHostAction>,
    config_actions: Map<string, PowerConfigAction>,
  ): PowerLifecycleContext {
    const notifications = this.options.host?.notifications(power_id) ?? {
      publish: async () => {},
      dismiss: async () => {},
    };
    const hosted_config = this.options.host?.config?.(power_id);
    const config = hosted_config ?? {
      get: () => ({}),
      set: async () => {
        throw new Error("City does not provide Power config storage");
      },
    };
    return Object.freeze({
      power: Object.freeze({
        id: power_id,
        action: (action: PowerHostAction) =>
          register_host_action(power_id, host_actions, config_actions, action, "host"),
        config_action: (action: PowerConfigAction) =>
          register_host_action(power_id, config_actions, host_actions, action, "config"),
      }),
      config,
      storage,
      logger,
      notifications,
      system: Object.freeze({
        list_agents: async () => this.options.runtime_access.list_agents().map((agent) => ({
          agent_id: agent.id,
          name: agent.name,
        })),
        list_workspaces: async () => this.options.runtime_access.list_workspaces().map((workspace) => ({
          workspace_id: workspace.id,
          name: workspace.name ?? workspace.id,
          workspace_path: workspace.path,
        })),
        invoke_agent_power: async (input) => {
          await this.options.runtime_access.enter_workspace(input.agent_id, input.workspace_id);
          return await this.scope(input.agent_id, input.workspace_id).run_action({
            power: input.power_id,
            action: input.action_id,
            ...(input.input !== undefined ? { payload: input.input } : {}),
          }) as unknown as PowerJsonValue;
        },
        create_agent_session: async (input) => {
          const workspace = await this.options.runtime_access.enter_workspace(
            input.agent_id,
            input.workspace_id,
          );
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          const session = await agent.sessions.create({
            workspace,
            origin: input.origin,
          });
          return { session_id: session.id };
        },
        prompt_agent_session: async (input) => {
          const workspace = await this.options.runtime_access.enter_workspace(
            input.agent_id,
            input.workspace_id,
          );
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          await agent.sessions.get(input.session_id, input.origin_type, { workspace });
          const session = agent.sessions.runtime(input.session_id, input.origin_type);
          const turn = await session.prompt({
            query: input.query,
            ...(input.request_id ? { request_id: input.request_id } : {}),
          });
          return Object.freeze({
            session_id: input.session_id,
            turn_id: turn.id,
            finished: turn.finished.then((result) => ({
              turn_id: turn.id,
              text: String(result.text || ""),
              success: result.success === true,
              ...(result.error ? { error: String(result.error) } : {}),
            })),
            subscribe: (subscriber) => session.subscribe((mutation) =>
              subscriber(mutation as unknown as import("@/power/index.js").PowerSessionMutation)),
            stop: async () => {
              await session.stop();
            },
          });
        },
        append_agent_session_message: async (input) => {
          const workspace = await this.options.runtime_access.enter_workspace(
            input.agent_id,
            input.workspace_id,
          );
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          await agent.sessions.get(input.session_id, input.origin_type, { workspace });
          await agent.sessions.runtime(
            input.session_id,
            input.origin_type,
          ).append_agent_message({ text: input.text });
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

/** 用一次嵌套调用的执行快照覆盖外层调用环境的可变部分。 */
function merge_call_context(
  base: ToolCallContext,
  execution_context?: PowerExecutionContext,
): ToolCallContext {
  if (!execution_context) return base;
  return Object.freeze({
    ...base,
    ...(execution_context.session_id
      ? { session_id: execution_context.session_id }
      : {}),
    ...(execution_context.session_origin
      ? { session_origin: execution_context.session_origin }
      : {}),
    ...(execution_context.turn_id ? { turn_id: execution_context.turn_id } : {}),
    ...(execution_context.abort_signal
      ? { abort_signal: execution_context.abort_signal }
      : {}),
    ...(execution_context.workspace_env
      ? { workspace_env: execution_context.workspace_env }
      : {}),
  });
}

/** 构造不属任何 Turn 的调用环境。 */
function create_call_context(input: {
  /** 当前 Agent 稳定标识。 */
  readonly agent_id: string;
  /** 当前 Agent 用户可见名称。 */
  readonly agent_name: string;
  /** 当前 Agent 能力描述。 */
  readonly agent_description: string;
  /** 当前 Agent 指令快照。 */
  readonly agent_instructions: readonly string[];
  /** 当前 Workspace 实例。 */
  readonly workspace: WorkspaceRuntime;
  /** 可选执行快照。 */
  readonly execution_context?: PowerExecutionContext;
}): ToolCallContext {
  return merge_call_context(
    Object.freeze({
      agent_id: input.agent_id,
      agent_name: input.agent_name,
      agent_description: input.agent_description,
      agent_instructions: Object.freeze([...input.agent_instructions]),
      session_id: "",
      session_origin: { type: "chat" },
      workspace: input.workspace,
      messages: Object.freeze([]),
    }),
    input.execution_context,
  );
}

/** 把 City 内部生命周期记录投影为稳定公开快照。 */
function to_power_snapshot(record: CityPowerRecord): PowerSnapshot {
  return {
    name: record.power_id,
    title: record.power.title,
    description: record.power.description,
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

/** 把 Power 或完整注册项归一化为 City 注册项。 */
function normalize_registration(input: CityPowerInput): CityPowerRegistration {
  if ("power" in input) return input;
  return {
    readme: "",
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    power: input,
  };
}

/** 注册宿主 action，并保证两个 surface 之间 ID 唯一。 */
function register_host_action<TAction extends PowerHostAction | PowerConfigAction>(
  power_id: string,
  target: Map<string, TAction>,
  other: Map<string, PowerHostAction | PowerConfigAction>,
  action: TAction,
  surface: "host" | "config",
): void {
  const action_id = normalize_id(action.id, "action.id");
  if (target.has(action_id) || other.has(action_id)) {
    throw new Error(`Power ${surface} action is already registered: ${power_id}/${action_id}`);
  }
  target.set(action_id, { ...action, id: action_id });
}

/** 拒绝宿主 action 边界中的非 JSON 返回值。 */
function normalize_json_value(value: PowerJsonValue, label: string): PowerJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`${label} is not JSON-serializable`);
    return JSON.parse(serialized) as PowerJsonValue;
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
