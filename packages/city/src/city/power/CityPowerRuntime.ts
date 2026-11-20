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
import type { Agent, Group, Logger } from "@downcity/agent";
import { EMPTY_TOOL_HOOK_SET, SESSION_TYPE_WORK, read_session_call_context, session_call_context } from "@downcity/type";
import type { PowerSurface } from "@downcity/type";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type {
  PowerActionResult,
  PowerCallSite,
  PowerConfigAction,
  PowerContext,
  PowerDefinition,
  PowerHostAction,
  PowerJsonValue,
  PowerLifecycleContext,
  PowerRuntimeHost,
  PowerSnapshot,
} from "@/power/index.js";
import { create_power_call, StepSnapshot } from "@/power/index.js";
import type { CityPowers } from "@/city/types/CityPower.js";
import type {
  CityPowerRecord,
  CityPowerRuntimeOptions,
} from "@/city/types/CityPowerRuntime.js";
import { PowerRegistry } from "@/power/core/PowerRegistry.js";
import { CityPowerLifecycle } from "./CityPowerLifecycle.js";
import {
  create_power_context,
  freeze_power_config,
} from "@/power/core/PowerContext.js";
import { create_power_session_collection, create_power_session_handle } from "@/city/power/PowerSessionBridge.js";
import { register_power_http_routes } from "@/power/core/PowerHttpRoutes.js";
import { CityExecutionProfiles } from "./CityExecutionProfiles.js";
import { assert_power_session_owner, create_power_session_host } from "./CityPowerSessionHost.js";
import { CityNotifications } from "./CityNotifications.js";
import { resolve_notification_targets } from "./CityNotificationSources.js";

/** City 唯一的 Power Runtime。 */
export class CityPowerRuntime implements PowerRuntimeHost {
  /** 唯一实例记录、取消与失败清理责任的持有者。 */
  private readonly lifecycle: CityPowerLifecycle;

  /** 所有 Agent 共享的唯一执行 Registry。 */
  private readonly registry = new PowerRegistry();
  /** Power 生命周期持有的可信执行配置注册表。 */
  private readonly execution_profiles = new CityExecutionProfiles();

  /** 新 Agent 加入时先装配专用执行配置，确保历史可精确恢复。 */
  attach_agent_execution_profiles(agent: Agent): void {
    this.execution_profiles.attach_agent(agent);
    this.notifications.attach_agent(agent);
  }

  /** 主体移除时释放通知观察，不触碰Session状态。 */
  detach_agent_notifications(agent: Agent): void {
    this.notifications.detach_agent(agent);
  }

  /** Workspace 集合事实改变时使通知目录失效。 */
  notification_targets_changed(): void { this.notifications.targets_changed(); }

  /** Group 集合装配只传事实，不持有通知规则。 */
  attach_group_notifications(group: Group): void { this.notifications.attach_group(group); }
  /** Group 离开 City 时释放观察。 */
  detach_group_notifications(group: Group): void { this.notifications.detach_group(group); }

  /** City 向应用提供的 Power 集合入口。 */
  readonly public_api: CityPowers;

  /** 当前生效的能力产物；Power 集合变化时原子替换。 */
  private surface: PowerSurface = Object.freeze({ tools: {}, hooks: EMPTY_TOOL_HOOK_SET });

  constructor(private readonly options: CityPowerRuntimeOptions) {
    this.lifecycle = new CityPowerLifecycle({
      runtime: options,
      registry: this.registry,
      create_context: (record, storage) => this.create_lifecycle_context(
        record.power_id, storage, record.logger, record.host_actions, record.config_actions, record.initialization_abort.signal,
      ),
      changed: () => this.publish_surface_change(),
      release_profiles: (power_id) => this.execution_profiles.release_power(power_id),
    });
    this.public_api = Object.freeze({
      add: (input) => this.lifecycle.add(input),
      prepare: (inputs) => this.lifecycle.prepare(inputs),
      refresh: (input) => this.lifecycle.refresh(input),
      remove: async (power_id) => await this.lifecycle.remove(power_id),
      cancel_initialization: (power_id) => this.lifecycle.cancel_initialization(power_id),
      snapshots: () => this.lifecycle.snapshots(),
      get: (power_id) => this.require_power(power_id),
      scope: (input) => this.scope(input.agent_id, input.workspace_id),
      register_http_routes: (app, input) => {
        this.register_http_routes(app, input.agent_id, input.workspace_id);
      },
      invoke: async (power_id, action_id, input) =>
        await this.invoke_host_action(power_id, action_id, input),
      invoke_config: async (power_id, action_id, input) =>
        await this.invoke_config(power_id, action_id, input),
      settled: async () => await this.lifecycle.settlement,
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
  /** 返回 City 当前持有的唯一 Power 实例。 */
  private require_power(power_id_input: string): PowerDefinition | null {
    const record = this.lifecycle.records.get(String(power_id_input || "").trim());
    return record?.state === "ready" && !record.staged ? record.power : null;
  }

  /** 关闭门禁与通知，同时同步取消已提交的初始化。 */
  begin_shutdown(): void {
    this.lifecycle.begin_shutdown();
    this.notifications.begin_shutdown();
  }

  /** 关闭 Registry 和实例；失败资源仍归 City 所有，可再次关闭重试。 */
  async dispose(): Promise<void> {
    this.begin_shutdown();
    await this.lifecycle.dispose();
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
    const record = this.lifecycle.records.get(power_id);
    if (record?.state === "disposing" || record?.state === "cleanup_failed") this.lifecycle.assert_ready(record);
    const agent_id = String(site.agent_id || "").trim();
    const agent = this.options.runtime_access.get_agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    const workspace = site.workspace
      ? this.options.runtime_access.require_workspace(agent_id, site.workspace.id)
      : undefined;
    const power_storage = this.options.storage.open_scope([
      "agents",
      agent_id,
      "powers",
      power_id,
    ]);
    const call = create_power_call({
      ...(site.tool_call_id ? { tool_call_id: site.tool_call_id } : {}),
      ...(site.interactions ? { interactions: site.interactions } : {}),
      abort_signal: site.abort_signal ?? new AbortController().signal,
      label: `power:${power_id}`,
    });
    // 动作和已挂载 HTTP 路由每次调用都取得当前身份，同次调用保持稳定引用。
    const federation = this.options.federation;
    return create_power_context({
      host: this,
      site,
      agent_id,
      agent_name: agent.name,
      agent_description: agent.description,
      ...(workspace ? { workspace } : {}),
      data_path: power_storage.root_path,
      data_root_path: this.options.storage.root_path,
      data_files: power_storage.files,
      ...(workspace?.shell ? { shell: workspace.shell } : {}),
      sessions: create_power_session_collection({
        get_sessions: () => agent.sessions,
        workspace,
      }),
      session: this.resolve_session_handle(agent, site),
      ...(site.turn_id ? { turn: Object.freeze({ id: site.turn_id, execution_id: site.execution_id, abort_signal: call.abort_signal }) } : {}),
      snapshot: this.resolve_snapshot(site, workspace, agent),
      call,
      config: freeze_power_config(this.options.host?.config?.(power_id).get() ?? {}),
      logger: agent.get_logger(),
      federation,
      notifications: this.notifications.publisher({ source_kind: "power", power_id, agent_id }),
      get_workspace_env: () => workspace?.get_env() ?? {},
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
    site: PowerCallSite,
  ): PowerContext["session"] {
    const session_id = String(site.session_id || "").trim();
    if (!session_id) return undefined;
    try {
      const runtime = agent.sessions.runtime(session_id, site.session_type ?? SESSION_TYPE_WORK);
      return create_power_session_handle(runtime);
    } catch {
      return undefined;
    }
  }

  /** 由来源身份组装本步冻结的事实。 */
  private resolve_snapshot(
    site: PowerCallSite,
    workspace: WorkspaceRuntime | undefined,
    agent: Agent,
  ): StepSnapshot {
    const session_id = String(site.session_id || "").trim();
    const turn_id = String(site.turn_id || "").trim();
    return new StepSnapshot({
      ...(session_id ? { session_id } : {}),
      ...(site.session_type ? session_call_context(read_session_call_context({ ...site, session_type: site.session_type, session_kind: site.session_kind ?? "work" })) : {}),
      ...(turn_id ? { turn_id } : {}),
      ...(workspace ? { project_root: workspace.path } : {}),
      workspace_env: site.workspace_env ?? workspace?.get_env() ?? {},
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
    const record = this.lifecycle.records.get(power_id);
    if (!record) {
      const failed = this.lifecycle.failed_snapshots.get(power_id);
      if (failed) {
        throw new Error(`Power is unavailable in City: ${power_id}: ${failed.last_error || "initialization failed"}`);
      }
      throw new Error(`Power is not registered in City: ${power_id}`);
    }
    await record.ready;
    this.lifecycle.assert_ready(record);
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
    if (this.lifecycle.records.get(power_id) !== record) {
      throw new Error(`Power is not registered in City: ${power_id}`);
    }
    this.lifecycle.assert_ready(record);
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

  /** 通知发布只在这里选路，具体未读状态由 Notification Power 拥有。 */
  private readonly notifications = new CityNotifications();

  /** 关闭期间拒绝新调用，失败清理记录也不会重新获得执行资格。 */
  private assert_active(): void { this.lifecycle.assert_active(); }

  /** 创建 initialize/dispose 共享的稳定 City 级上下文。 */
  private create_lifecycle_context(
    power_id: string,
    storage: PowerLifecycleContext["storage"],
    logger: Logger,
    host_actions: Map<string, PowerHostAction>,
    config_actions: Map<string, PowerConfigAction>,
    abort_signal: AbortSignal,
  ): PowerLifecycleContext {
    const notifications = this.notifications.publisher({ source_kind: "power", power_id });
    const hosted_config = this.options.host?.config?.(power_id);
    const config = hosted_config ?? {
      path: "",
      get: () => ({}),
      set: async () => {
        throw new Error("City does not provide Power config storage");
      },
    };
    // 生命周期上下文可能被 Power 长期持有；每次读取都解析当前绑定。
    const options = this.options;
    return Object.freeze({
      get federation() { return options.federation; },
      power: Object.freeze({
        id: power_id,
        background: async <TResult>(operation: () => Promise<TResult>) => await this.with_record_execution(power_id, async () => await operation()),
        action: (action: PowerHostAction) =>
          register_host_action(power_id, host_actions, config_actions, action, "host"),
        config_action: (action: PowerConfigAction) =>
          register_host_action(power_id, config_actions, host_actions, action, "config"),
      }),
      config,
      storage,
      abort_signal,
      data_root_path: this.options.storage.root_path,
      logger,
      notifications,
      system: Object.freeze({
        ...create_power_session_host(power_id, this.options.runtime_access, this.execution_profiles),
        register_notification_receiver: (receiver) => this.notifications.register(receiver, this.options.runtime_access.list_agents(), this.options.runtime_access.list_groups()),
        resolve_notification_targets: async (targets) => await resolve_notification_targets(targets, this.options.runtime_access.list_agents(), this.options.runtime_access.list_groups(), this.options.runtime_access.list_notification_workspace_ids()),
        list_agent_interactions: async ({ agent_id }) => {
          const agent = this.options.runtime_access.get_agent(agent_id);
          if (!agent) throw new Error(`Agent not found: ${agent_id}`);
          return await agent.interactions.list() as unknown as PowerJsonValue;
        },
        respond_agent_interaction: async ({ agent_id, reference, response }) => {
          const agent = this.options.runtime_access.get_agent(agent_id);
          if (!agent) throw new Error(`Agent not found: ${agent_id}`);
          return await agent.interactions.respond({ reference, response }) as unknown as PowerJsonValue;
        },
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
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          const workspace = input.workspace_id
            ? await this.options.runtime_access.enter_workspace(input.agent_id, input.workspace_id)
            : undefined;
          const powers = this.registry.powers_for(this, {
            agent_id: agent.id,
            ...(workspace ? { workspace } : {}),
            workspace_env: workspace?.get_env() ?? {},
            agent_instructions: agent.get_instructions(),
          });
          return await powers.run_action({
            power: input.power_id,
            action: input.action_id,
            ...(input.input !== undefined ? { payload: input.input } : {}),
          }) as unknown as PowerJsonValue;
        },
        prompt_agent_session: async (input) => {
          const workspace = input.workspace_id
            ? await this.options.runtime_access.enter_workspace(input.agent_id, input.workspace_id)
            : undefined;
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          await assert_power_session_owner(power_id, agent, this.execution_profiles, input.session_id, input.type);
          await agent.sessions.get(input.session_id, input.type, { workspace });
          const session = agent.sessions.runtime(input.session_id, input.type);
          const turn = await session.prompt({
            actor: input.actor,
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
          const workspace = input.workspace_id
            ? await this.options.runtime_access.enter_workspace(input.agent_id, input.workspace_id)
            : undefined;
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          await assert_power_session_owner(power_id, agent, this.execution_profiles, input.session_id, input.type);
          await agent.sessions.get(input.session_id, input.type, { workspace });
          await agent.sessions.runtime(
            input.session_id,
            input.type,
          ).append_agent_message({ text: input.text });
        },
        get_agent_session_workspace: async (input) => {
          const agent = this.options.runtime_access.get_agent(input.agent_id);
          if (!agent) throw new Error(`Agent not found in City: ${input.agent_id}`);
          const session = await agent.sessions.get(input.session_id, input.type);
          const workspace = session.get("workspace");
          return workspace ? {
            workspace_id: workspace.id,
            name: workspace.name ?? workspace.id,
            workspace_path: workspace.path,
          } : undefined;
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
