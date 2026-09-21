/**
 * City 唯一 Power Registry 与生命周期运行时。
 *
 * 一个 City 中每个 Power ID 只有一个实例和一套 initialize/dispose 生命周期。
 * City 编译一次能力产物并以活视图形式交给 Agent；Agent 不缓存，也不参与拉取。
 * 具体调用由 Agent 在执行时注入调用环境，容器在调用点反查 Agent 身份。
 *
 * 关键点（中文）
 * - 不存在全局生命周期屏障：单个 Power 的初始化只影响它自己。
 * - 不存在 execution lease：Power 被移除时正在执行的调用按各自实现收口。
 */

import type { Hono } from "hono";
import type { Agent, Logger } from "@downcity/agent";
import { get_logger } from "@downcity/agent";
import { EMPTY_TOOL_HOOK_SET, normalize_session_origin } from "@downcity/type";
import type { PowerSurface } from "@downcity/type";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type {
  CityPowerRegistration,
  PowerActionResult,
  PowerCallSite,
  PowerConfigAction,
  PowerContext,
  PowerDefinition,
  PowerHostAction,
  PowerJsonValue,
  PowerLifecycleContext,
  PowerRuntimeHost,
  PowerSessionHandle,
  PowerSnapshot,
} from "@/power/index.js";
import { create_power_call, StepSnapshot } from "@/power/index.js";
import type { CityPowerInput, CityPowers } from "@/city/types/CityPower.js";
import type {
  CityPowerRecord,
  CityPowerRuntimeOptions,
} from "@/city/types/CityPowerRuntime.js";
import { PowerRegistry } from "@/power/core/PowerRegistry.js";
import {
  create_power_context,
  create_power_session_handle,
  freeze_power_config,
} from "@/power/core/PowerContext.js";
import { create_power_session_collection } from "@/city/power/PowerSessionBridge.js";
import { register_power_http_routes } from "@/power/core/PowerHttpRoutes.js";

/** City 唯一的 Power Runtime。 */
export class CityPowerRuntime implements PowerRuntimeHost {
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

  /** City 向应用提供的 Power 集合入口。 */
  readonly public_api: CityPowers;

  /** 当前生效的能力产物；Power 集合变化时原子替换。 */
  private surface: PowerSurface = Object.freeze({ tools: {}, hooks: EMPTY_TOOL_HOOK_SET });

  constructor(private readonly options: CityPowerRuntimeOptions) {
    this.public_api = Object.freeze({
      add: (input) => this.add(input),
      remove: async (power_id) => await this.remove(power_id),
      snapshots: () => this.all_power_snapshots(),
      get: (power_id) => this.require_power(power_id),
      scope: (input) => this.scope(input.agent_id, input.workspace_id),
      register_http_routes: (app, input) => {
        this.register_http_routes(app, input.agent_id, input.workspace_id);
      },
      invoke: async (power_id, action_id, input) =>
        await this.invoke_host_action(power_id, action_id, input),
      invoke_config: async (power_id, action_id, input) =>
        await this.invoke_config(power_id, action_id, input),
      settled: async () => await this.lifecycle_settlement,
    });
  }

  /**
   * 返回容器当前生效的能力产物。
   *
   * 关键点（中文）
   * - 返回的是同一个活对象；主体持有引用后不需要失效通知。
   * - 编译输入不含 Agent：调用上下文已携带 Agent 身份，容器在执行点反查。
   */
  surface_view(): PowerSurface {
    return this.surface;
  }

  /** 重新编译当前 Power 集合，并原子替换活视图。 */
  private recompile_surface(): void {
    this.surface = Object.freeze({
      tools: this.registry.tools(this),
      hooks: this.registry.hooks(this),
    });
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

  /** 返回 City 当前全部 Power 快照（含初始化失败项）。 */
  private all_power_snapshots(): PowerSnapshot[] {
    return [
      ...[...this.powers_by_id.values()].map(to_power_snapshot),
      ...this.failed_power_snapshots.values(),
    ]
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** 返回 City 当前持有的唯一 Power 实例。 */
  private require_power(power_id_input: string): PowerDefinition | null {
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
    this.surface = Object.freeze({ tools: {}, hooks: EMPTY_TOOL_HOOK_SET });
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

  /**
   * 重新编译当前 Power 集合，并原子替换活视图。
   *
   * 关键点（中文）：主体持有的是同一个活对象引用，替换内部值即对它可见，
   * 因此不需要失效通知。
   */
  private publish_surface_change(): void {
    this.surface = Object.freeze({
      tools: this.registry.tools(this),
      hooks: this.registry.hooks(this),
    });
  }

  /**
   * 为一次 Power 调用创建动态上下文工厂。
   *
   * 关键点（中文）
   * - 每次调用都重新反查，不缓存 Workspace、Agent 或 PowerContext。
   * - Agent 身份从来源身份读取，容器在调用点反查自己的索引。
   */
  context_for(power_id: string, site: PowerCallSite): PowerContext {
    const agent_id = String(site.agent_id || "").trim();
    const agent = this.options.runtime_access.get_agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    const workspace = this.require_call_workspace(agent_id, site);
    const power_storage = this.options.storage.open_scope([
      "agents",
      agent_id,
      "powers",
      power_id,
    ]);
    const call = create_power_call({
      ...(site.call_id ? { call_id: site.call_id } : {}),
      ...(site.interactions ? { interactions: site.interactions } : {}),
      abort_signal: site.abort_signal ?? new AbortController().signal,
      label: `power:${power_id}`,
    });
    return create_power_context({
      host: this,
      site,
      agent_id,
      agent_name: agent.name,
      agent_description: agent.description,
      workspace_id: workspace.id,
      workspace_path: workspace.path,
      workspace,
      data_path: power_storage.root_path,
      data_files: power_storage.files,
      ...(workspace.shell ? { shell: workspace.shell } : {}),
      sessions: create_power_session_collection({
        get_sessions: () => agent.sessions,
        workspace,
      }),
      session: this.resolve_session_handle(agent, workspace, site),
      ...(site.turn_id ? { turn: Object.freeze({ id: site.turn_id, abort_signal: call.abort_signal }) } : {}),
      snapshot: this.resolve_snapshot(site, workspace, agent),
      call,
      config: freeze_power_config(this.options.host?.config?.(power_id).get() ?? {}),
      logger: agent.get_logger(),
      embassy: this.options.embassy,
      ...(this.options.host
        ? { notifications: this.options.host.notifications(power_id, agent_id) }
        : {}),
      get_workspace_env: () => workspace.get_env(),
      get_instructions: () => agent.get_instructions(),
    });
  }

  /**
   * 由来源身份与 Agent 解析本次调用可见的 Session 句柄。
   *
   * 关键点（中文）：句柄只在 Session 已加载时提供；system 查询等入口可能携带
   * 尚未加载的 Session 标识，此时返回 undefined，不阻断调用。
   */
  private resolve_session_handle(
    agent: Agent,
    workspace: WorkspaceRuntime,
    site: PowerCallSite,
  ): PowerContext["session"] {
    const session_id = String(site.session_id || "").trim();
    if (!session_id) return undefined;
    const origin = normalize_session_origin(site.session_origin ?? { type: "chat" });
    try {
      const runtime = agent.sessions.runtime(session_id, origin.type);
      return create_power_session_handle(
        runtime as unknown as PowerSessionHandle,
        session_id,
        origin,
        workspace.id,
      );
    } catch {
      return undefined;
    }
  }

  /** 由来源身份组装本步冻结的事实。 */
  private resolve_snapshot(
    site: PowerCallSite,
    workspace: WorkspaceRuntime,
    agent: Agent,
  ): StepSnapshot {
    const session_id = String(site.session_id || "").trim();
    const turn_id = String(site.turn_id || "").trim();
    return new StepSnapshot({
      ...(session_id ? { session_id } : {}),
      ...(site.session_origin ? { session_origin: site.session_origin } : {}),
      ...(turn_id ? { turn_id } : {}),
      project_root: workspace.path,
      workspace_env: site.workspace_env ?? workspace.get_env(),
      agent_systems: site.agent_instructions ?? agent.get_instructions(),
    });
  }

  /** 为指定来源构造 Power 之间的调用面。 */
  powers_for(site: PowerCallSite): PowerContext["city"]["powers"] {
    const registry = this.registry;
    const host = this;
    return Object.freeze({
      get: (power_id: string) => registry.get(power_id),
      snapshots: () => registry.snapshots(),
      run_action: async (input) => await registry.run_action({
        host,
        site,
        power: input.power,
        action: input.action,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      }),
      pipeline: async <TValue extends PowerJsonValue>(point_name: string, value: TValue) =>
        await registry.pipeline(host, site, point_name, value),
      effect: async <TValue extends PowerJsonValue>(point_name: string, value: TValue) =>
        await registry.effect(host, site, point_name, value),
    });
  }

  /** 读取指定 power 定义。 */
  get_power(power_id: string): unknown | null {
    return this.registry.get(power_id);
  }

  /** 列出当前全部 power 快照。 */
  snapshots(): PowerSnapshot[] {
    return this.registry.snapshots();
  }

  /** 执行一次 power action。 */
  async run_action(input: {
    power: string;
    action: string;
    payload?: PowerJsonValue;
    site: PowerCallSite;
  }): Promise<PowerActionResult<PowerJsonValue>> {
    return await this.registry.run_action({
      host: this,
      site: input.site,
      power: input.power,
      action: input.action,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    });
  }

  /** 在指定来源身份下运行一个 pipeline 点。 */
  async pipeline<TValue extends PowerJsonValue>(
    point_name: string,
    value: TValue,
    site: PowerCallSite,
  ): Promise<TValue> {
    return await this.registry.pipeline(this, site, point_name, value);
  }

  /** 在指定来源身份下运行一个 effect 点。 */
  async effect<TValue extends PowerJsonValue>(
    point_name: string,
    value: TValue,
    site: PowerCallSite,
  ): Promise<void> {
    await this.registry.effect(this, site, point_name, value);
  }

  /** 解析一次调用所属的 Workspace；缺少绑定时报出装配错误。 */
  private require_call_workspace(
    agent_id: string,
    site: PowerCallSite,
  ): WorkspaceRuntime {
    const workspace = site.workspace;
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
    return this.registry.powers_for(this, {
      agent_id: agent.id,
      workspace,
      workspace_env: workspace.get_env(),
      agent_instructions: agent.get_instructions(),
    });
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
    const host = this;
    const site: PowerCallSite = {
      agent_id: agent.id,
      workspace,
      workspace_env: workspace.get_env(),
      agent_instructions: agent.get_instructions(),
    };
    register_power_http_routes({
      app,
      get_context: (power_id) => host.context_for(power_id, site),
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
