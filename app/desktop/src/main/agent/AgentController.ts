/**
 * Desktop native Agent 与 Session 控制器。
 *
 * Electron main 直接拥有 City、Agent 和 Session 订阅。Session mutation 是 Renderer
 * 对话投影的唯一实时事实源，IPC 运行态只负责表达提交、执行、停止和失败阶段。
 */

import {
  Agent,
  get_logger,
  type AgentSession,
  type AgentSessionPromptInput,
  type AgentSessionSummary,
  type RespondSessionInteractionInput,
  type SessionApprovalMode,
  type SessionMutationUnsubscribe,
} from "@downcity/agent";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  City,
  create_city_host_instance_id,
  register_city_host,
  unregister_city_host,
} from "@downcity/city";
import {
  type LocalAgentConfig,
  type LocalWorkspaceConfig,
  normalize_agent_id,
} from "@downcity/local/product";
import type {
  DesktopAgentWorkspace,
  DesktopAgentSummary,
  DesktopChatInput,
  DesktopChatRewriteInput,
  DesktopChatRewriteResult,
  DesktopChatMutationEvent,
  DesktopChatHistoryPage,
  DesktopChatRuntime,
  DesktopChatRuntimeEvent,
  DesktopChatSendResult,
  DesktopChatSnapshot,
  DesktopAgentDefinition,
  DesktopUpdateAgentInput,
  DesktopModelSummary,
  DesktopSessionConfiguration,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi.js";
import {
  create_desktop_agent_model,
  create_desktop_embassy,
  create_desktop_agent_tools,
  create_desktop_plugin_loader,
  create_desktop_workspace,
  list_desktop_agent_models,
  resolve_desktop_agent_model,
} from "./DesktopAgentAssembly.js";
import type { DesktopLocalData } from "./DesktopLocalData.js";
import type { LocalPluginLoader } from "@downcity/local/product";
import { generate_agent_avatar_svg, read_downcity_logo_svg } from "./GeneratedAgentAvatar.js";

const session_model_settings_key = "desktop.session-models";

/** Agent 控制器向 Electron 窗口广播的实时事件。 */
interface AgentControllerEvents {
  /** 广播 canonical Session mutation。 */
  mutation(event: DesktopChatMutationEvent): void;
  /** 广播 Session 运行态。 */
  runtime(event: DesktopChatRuntimeEvent): void;
}

/** Electron main 内的 native Agent 生命周期控制器。 */
export class AgentController {
  /** Desktop 与 CLI 共用的本地数据库和产品 Repository。 */
  /** Desktop 读取本地 Plugin 定义与 profile 的 Loader。 */
  private readonly plugin_loader: LocalPluginLoader;
  /** Desktop 进程内的 Agent 索引与 transport 转发器。 */
  private readonly city = new City();
  /** 当前 Desktop City 宿主实例标识。 */
  private readonly host_instance_id = create_city_host_instance_id();
  /** 已订阅 Session 的取消订阅函数。 */
  private readonly session_unsubscribes = new Map<string, SessionMutationUnsubscribe>();
  /** Main 进程持有的 Session 运行态投影。 */
  private readonly runtimes = new Map<string, DesktopChatRuntime>();
  /** 当前进程已经按持久化 ID 恢复的 Session 模型。 */
  private readonly restored_session_models = new Map<string, string>();
  /** Desktop 首次访问前完成的本地 Agent 装配。 */
  private readonly ready_promise: Promise<void>;

  constructor(
    private readonly data: DesktopLocalData,
    private readonly events: AgentControllerEvents,
  ) {
    this.plugin_loader = create_desktop_plugin_loader(this.data);
    this.ready_promise = this.initialize_agents();
  }

  /** 等待 Desktop City 完成 Agent 装配与宿主登记。 */
  async ready(): Promise<void> {
    await this.ready_promise;
  }

  /** 当前是否存在仍在执行的对话，用于保护账户切换。 */
  has_active_sessions(): boolean {
    return [...this.runtimes.values()].some((runtime) => runtime.status === "submitted" || runtime.status === "streaming" || runtime.status === "waiting_input");
  }

  /** 列出 CLI 与 Desktop 共用的 Agent 注册记录。 */
  async list_agents(): Promise<DesktopAgentSummary[]> {
    await this.ready_promise;
    return this.data.agents.list().map((record) => to_desktop_agent_summary(record, this.data.agents.get_avatar_url(record.agent_id)));
  }

  /** 读取 Agent 的完整本地定义，供 Renderer 编辑。 */
  async get_agent(agent_id: string): Promise<DesktopAgentDefinition> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return {
      agent_id: config.agent_id,
      model_id: typeof config.execution?.model_id === "string" ? config.execution.model_id : "",
      instruction: config.instruction,
      plugins: Object.fromEntries(Object.entries(config.plugins).map(([plugin_id, reference]) => [plugin_id, reference.profile ? { profile: reference.profile } : {}])),
    };
  }

  /** 列出独立登记的全部 Workspace。 */
  async list_workspaces(): Promise<DesktopWorkspaceSummary[]> {
    await this.ready_promise;
    return this.data.workspaces.list().map(to_desktop_workspace_summary);
  }

  /** 独立登记 Workspace，不隐式创建 Agent 或 Session。 */
  async create_workspace(
    workspace_path: string,
    name: string,
  ): Promise<DesktopWorkspaceSummary> {
    await this.ready_promise;
    const normalized_path = String(workspace_path || "").trim();
    if (!normalized_path) throw new Error("workspace_path is required");
    return to_desktop_workspace_summary(this.data.workspaces.ensure({
      workspace_path: normalized_path,
      name: String(name || "").trim(),
    }));
  }

  /** 创建一个不绑定 Workspace 的 Agent。 */
  async create_agent(
    agent_id: string,
    model_id: string,
  ): Promise<{ agent: DesktopAgentSummary }> {
    const normalized_model_id = String(model_id || "").trim();
    if (!normalized_model_id) throw new Error("model_id is required");
    await this.ready_promise;
    const current_time = new Date().toISOString();
    const candidate: LocalAgentConfig = {
      agent_id: normalize_agent_id(agent_id),
      version: "1.0.0",
      execution: { type: "api", model_id: normalized_model_id },
      instruction: "",
      plugins: {},
      created_at: current_time,
      updated_at: current_time,
    };
    const agent = await this.create_native_agent(candidate);
    let config: LocalAgentConfig | null = null;
    try {
      config = this.data.agents.create(candidate);
    } catch (error) {
      if (config) this.data.agents.remove(config.agent_id);
      await agent.dispose().catch(() => undefined);
      throw error;
    }
    return {
      agent: to_desktop_agent_summary({
        agent_id: agent.id,
        version: config.version,
        execution: config.execution,
      }, this.data.agents.get_avatar_url(agent.id)),
    };
  }

  /** 保存 Agent 定义，并以同一稳定 ID 替换进程内实例。 */
  async update_agent(agent_id: string, input: DesktopUpdateAgentInput): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    const current = this.data.agents.get(agent_id);
    if (!current) throw new Error(`Agent not found: ${agent_id}`);
    if ([...this.runtimes.values()].some((runtime) => runtime.agent_id === current.agent_id && (runtime.status === "submitted" || runtime.status === "streaming" || runtime.status === "waiting_input"))) {
      throw new Error("Agent 正在执行 Session，请等待执行结束后再编辑");
    }
    const model_id = String(input.model_id || "").trim();
    if (!model_id) throw new Error("model_id is required");
    const candidate: LocalAgentConfig = {
      ...current,
      execution: { ...current.execution, type: "api", model_id },
      instruction: String(input.instruction || ""),
      plugins: Object.fromEntries(Object.entries(input.plugins || {}).map(([plugin_id, reference]) => {
        const profile = String(reference.profile || "").trim();
        return [plugin_id, profile ? { profile } : {}];
      })),
      updated_at: new Date().toISOString(),
    };
      const replacement = await this.create_native_agent(candidate);
    let saved = false;
    let previous_agent: Agent | null = null;
    try {
      this.data.agents.save(candidate);
      saved = true;
      previous_agent = this.city.agents.get(current.agent_id);
      if (previous_agent) await this.city.agents.remove(previous_agent.id);
      this.city.agents.add(replacement);
    } catch (error) {
      await this.city.agents.remove(replacement.id).catch(() => null);
      if (previous_agent) this.city.agents.add(previous_agent);
      if (saved) this.data.agents.save(current);
      await replacement.dispose().catch(() => undefined);
      throw error;
    }
    for (const [session_key, unsubscribe] of this.session_unsubscribes) {
      if (!session_key.startsWith(`${current.agent_id}:`)) continue;
      unsubscribe();
      this.session_unsubscribes.delete(session_key);
      this.runtimes.delete(session_key);
      this.restored_session_models.delete(session_key);
    }
    await previous_agent?.dispose();
    return to_desktop_agent_summary(this.data.agents.get(current.agent_id)!, this.data.agents.get_avatar_url(current.agent_id));
  }

  /** 保存 Agent 头像并返回刷新后的摘要。 */
  async set_avatar(agent_id: string, source_path: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    this.data.agents.set_avatar(agent_id, source_path);
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return to_desktop_agent_summary(config, this.data.agents.get_avatar_url(config.agent_id));
  }

  /** 删除 Agent 头像并返回刷新后的摘要。 */
  async remove_avatar(agent_id: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    this.data.agents.remove_avatar(agent_id);
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    return to_desktop_agent_summary(config, undefined);
  }

  /** 生成并保存一份新的随机 Downcity Ghost 头像。 */
  async generate_avatar(agent_id: string): Promise<DesktopAgentSummary> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    this.data.agents.set_generated_avatar(config.agent_id, generate_agent_avatar_svg(randomUUID(), read_downcity_logo_svg()));
    return to_desktop_agent_summary(config, this.data.agents.get_avatar_url(config.agent_id));
  }

  /** 让指定 Agent 进入独立登记的 Workspace。 */
  async connect_agent(agent_id: string, workspace_id: string): Promise<DesktopAgentWorkspace> {
    await this.ready_promise;
    const config = this.data.agents.get(agent_id);
    if (!config) throw new Error(`Agent not found: ${agent_id}`);
    const workspace = this.data.workspaces.get(workspace_id);
    if (!workspace) throw new Error(`Workspace is not registered: ${workspace_id}`);
    if (!this.city.agents.get(config.agent_id)) throw new Error(`Agent is not available in Desktop City: ${config.agent_id}`);
    await this.require_agent_workspace(config.agent_id, workspace_id);
    return { agent_id: config.agent_id, workspace_id, workspace: to_desktop_workspace_summary(workspace) };
  }

  /** 列出一个 native Agent 在当前 Workspace 中的 Session。 */
  async list_sessions(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary[]> {
    const page = await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.list();
    return page.items.map(to_desktop_session_summary);
  }

  /** 列出当前 Federation 中可用于 Agent 对话的模型。 */
  async list_models(): Promise<DesktopModelSummary[]> {
    await this.ready_promise;
    return await list_desktop_agent_models(this.data, process.env);
  }

  /** 在当前 Workspace 创建新的 Session。 */
  async create_session(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary> {
    const agent = this.require_native_agent(agent_id);
    const workspace = this.city.workspaces.get(workspace_id)
      ?? (await this.require_agent_workspace(agent_id, workspace_id)).workspace;
    const session = await agent.sessions.create({ workspace });
    this.observe_session(agent_id, workspace_id, session);
    return to_desktop_session_summary(await session.get_info());
  }

  /** 从 canonical Message 锚点创建分支 Session，并纳入 Desktop 实时投影。 */
  async fork_session(agent_id: string, workspace_id: string, session_id: string, message_id: string): Promise<DesktopSessionSummary> {
    const source = await this.get_session(agent_id, workspace_id, session_id);
    const source_info = await source.get_info();
    const forked = await source.fork({ message_id });
    const source_title = String(source_info.title || "新会话").trim();
    await forked.rename(`${source_title}（分支）`);
    this.observe_session(agent_id, workspace_id, forked);
    return to_desktop_session_summary(await forked.get_info());
  }

  /** 从历史用户消息之前创建新 Session，并以修改后的文本启动新 Turn。 */
  async rewrite_session_message(agent_id: string, workspace_id: string, session_id: string, input: DesktopChatRewriteInput): Promise<DesktopChatRewriteResult> {
    const source = await this.get_session(agent_id, workspace_id, session_id);
    if ((await source.status()).state === "running") throw new Error("Session 正在执行，不能编辑历史消息");
    const message_id = String(input.message_id || "").trim();
    const text = String(input.text || "").trim();
    if (!message_id) throw new Error("message_id is required");
    if (!text) throw new Error("编辑后的消息不能为空");
    if (input.action !== "fork" && input.action !== "rollback") throw new Error("不支持的历史消息重写方式");
    const source_info = await source.get_info();
    const forked = await source.fork({ message_id, include_message: false });
    const source_title = String(source_info.title || "新对话").trim();
    try {
      await forked.rename(input.action === "fork" ? `${source_title}（分支）` : source_title);
      this.observe_session(agent_id, workspace_id, forked);
      const sent = await this.send_message(agent_id, workspace_id, forked.id, { text, files: [], references: [] });
      if (input.action === "rollback") {
        await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.archive({ id: session_id });
        this.release_session_projection(agent_id, workspace_id, session_id);
      }
      return { session: to_desktop_session_summary(await forked.get_info()), turn_id: sent.turn_id };
    } catch (error) {
      await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.remove(forked.id).catch(() => false);
      this.release_session_projection(agent_id, workspace_id, forked.id);
      throw error;
    }
  }

  /** 更新 Session 的 canonical 标题。 */
  async rename_session(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    title: string,
  ): Promise<string> {
    return await (await this.get_session(agent_id, workspace_id, session_id)).rename(title);
  }

  /** 归档 Session，并释放 Desktop 对它的进程内投影。 */
  async archive_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.archive({ id: session_id });
    this.release_session_projection(agent_id, workspace_id, session_id);
  }

  /** 永久删除 Session，并释放 Desktop 对它的进程内投影。 */
  async remove_session(agent_id: string, workspace_id: string, session_id: string): Promise<boolean> {
    const removed = await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.remove(session_id);
    if (removed) this.release_session_projection(agent_id, workspace_id, session_id);
    return removed;
  }

  /** 列出一个 Agent 已归档的 Session。 */
  async list_archived_sessions(agent_id: string, workspace_id: string): Promise<DesktopSessionSummary[]> {
    const page = await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.archived();
    return page.items.map(to_desktop_session_summary);
  }

  /** 读取一个 native Session 的 canonical 消息和运行态。 */
  async get_chat_snapshot(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatSnapshot> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const page = await session.messages();
    return {
      messages: page.items.filter((message) => message.visibility === "visible"),
      runtime: await this.read_runtime(agent_id, workspace_id, session),
      has_more: page.has_more,
      ...(page.next_before_sequence ? { next_before_sequence: page.next_before_sequence } : {}),
    };
  }

  /** 读取 Session 的一个更早历史 Segment。 */
  async get_chat_history(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    before_sequence: number,
  ): Promise<DesktopChatHistoryPage> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const page = await session.messages({ before_sequence });
    return {
      messages: page.items.filter((message) => message.visibility === "visible"),
      has_more: page.has_more,
      ...(page.next_before_sequence ? { next_before_sequence: page.next_before_sequence } : {}),
    };
  }

  /** 向 Session 提交输入；后续执行结果通过实时事件广播。 */
  async send_message(agent_id: string, workspace_id: string, session_id: string, input: DesktopChatInput): Promise<DesktopChatSendResult> {
    const query = normalize_chat_input(input);
    const session = await this.get_session(agent_id, workspace_id, session_id);
    this.update_runtime({ agent_id, workspace_id, session_id, status: "submitted", updated_at: Date.now() });
    try {
      const turn = await session.prompt({ query });
      void turn.finished.catch((reason: unknown) => {
        this.update_runtime({
          agent_id,
          workspace_id,
          session_id,
          status: "failed",
          turn_id: turn.id,
          error: to_error_message(reason),
          updated_at: Date.now(),
        });
      });
      return { turn_id: turn.id };
    } catch (reason) {
      this.update_runtime({
        agent_id,
        workspace_id,
        session_id,
        status: "failed",
        error: to_error_message(reason),
        updated_at: Date.now(),
      });
      throw reason;
    }
  }

  /** 将显式压缩命令加入 Session 的有序执行队列。 */
  async compact_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.compact();
  }

  /** 停止当前 Session Turn。 */
  async stop_session(agent_id: string, workspace_id: string, session_id: string): Promise<void> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.stop();
    this.update_runtime({ agent_id, workspace_id, session_id, status: "stopped", updated_at: Date.now() });
  }

  /** 响应当前 Session 等待中的审批或问题。 */
  async respond_interaction(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    input: RespondSessionInteractionInput,
  ): Promise<void> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.respond(input);
  }

  /** 读取 Session 当前运行态。 */
  async get_runtime(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopChatRuntime> {
    return await this.read_runtime(agent_id, workspace_id, await this.get_session(agent_id, workspace_id, session_id));
  }

  /** 读取 Session 当前模型与审批模式。 */
  async get_configuration(agent_id: string, workspace_id: string, session_id: string): Promise<DesktopSessionConfiguration> {
    return await this.read_session_configuration(workspace_id, await this.get_session(agent_id, workspace_id, session_id));
  }

  /** 解析 Federation 模型并切换当前 Session。 */
  async set_model(agent_id: string, workspace_id: string, session_id: string, model_id: string): Promise<DesktopSessionConfiguration> {
    const entry = await this.require_agent_workspace(agent_id, workspace_id);
    const session = await this.get_session(agent_id, workspace_id, session_id);
    const model = await resolve_desktop_agent_model(this.data, model_id, entry.workspace.get_env());
    await session.set({ model });
    this.persist_session_model_id(agent_id, workspace_id, session_id, model_id);
    this.restored_session_models.set(get_session_key(agent_id, workspace_id, session_id), model_id);
    return await this.read_session_configuration(workspace_id, session);
  }

  /** 更新当前 Session 的安全审批模式。 */
  async set_approval_mode(
    agent_id: string,
    workspace_id: string,
    session_id: string,
    approval_mode: SessionApprovalMode,
  ): Promise<DesktopSessionConfiguration> {
    const session = await this.get_session(agent_id, workspace_id, session_id);
    await session.set({ security: { approval_mode } });
    return await this.read_session_configuration(workspace_id, session);
  }

  /** 释放 Desktop 进程拥有的全部 native Agent。 */
  async dispose(): Promise<void> {
    await this.ready_promise.catch(() => undefined);
    for (const unsubscribe of this.session_unsubscribes.values()) unsubscribe();
    this.session_unsubscribes.clear();
    this.runtimes.clear();
    this.restored_session_models.clear();
    const agents = this.city.agents.list();
    const results: PromiseSettledResult<unknown>[] = [];
    results.push(...await Promise.allSettled([this.city.close()]));
    results.push(...await Promise.allSettled(agents.map(async (agent) => await agent.dispose())));
    results.push(...await Promise.allSettled([
      unregister_city_host(this.host_instance_id),
    ]));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length > 0) throw new AggregateError(errors, "Desktop Agent dispose failed");
  }

  /** 从本地产品配置显式创建并注册全部 Desktop Agent。 */
  private async initialize_agents(): Promise<void> {
    const initialized_agents: Agent[] = [];
    try {
      for (const config of this.data.agents.list()) {
        const agent = await this.create_native_agent(config);
        this.city.agents.add(agent);
        try {
          initialized_agents.push(agent);
        } catch (error) {
          await agent.dispose().catch(() => undefined);
          throw error;
        }
      }
      await register_city_host({
        owner: "desktop",
        pid: process.pid,
        instance_id: this.host_instance_id,
        started_at: new Date().toISOString(),
      });
    } catch (error) {
      await Promise.allSettled(initialized_agents.map(async (agent) => {
        await agent.dispose();
      }));
      throw error;
    }
  }

  /** 显式装配一个 Desktop native Agent。 */
  private async create_native_agent(config: LocalAgentConfig): Promise<Agent> {
    const [model, plugins, tools] = await Promise.all([
      Promise.resolve(create_desktop_agent_model(this.data, config, process_environment())),
      this.plugin_loader.create_plugins(config, ({ plugin_id, profile }) => ({
        plugin_id,
        profile,
        embassy: create_desktop_embassy(this.data, process.env),
        data_path: path.join(
          this.data.root_path,
          "agents",
          config.agent_id,
          "plugins",
          plugin_id,
        ),
        logger: get_logger(),
        extensions: {},
      })),
      Promise.resolve(create_desktop_agent_tools()),
    ]);
    return new Agent({
      id: config.agent_id,
      instruction: config.instruction,
      model,
      plugins,
      tools,
    });
  }

  /** 读取 Session，并确保实时 mutation 只订阅一次。 */
  private async get_session(agent_id: string, workspace_id: string, session_id: string): Promise<AgentSession> {
    const session = await (await this.require_agent_workspace(agent_id, workspace_id)).sessions.get(session_id);
    await this.restore_session_model(agent_id, workspace_id, session);
    this.observe_session(agent_id, workspace_id, session);
    return session;
  }

  /** 建立 SDK Session 到 Renderer 的唯一事件桥。 */
  private observe_session(agent_id: string, workspace_id: string, session: AgentSession): void {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    if (this.session_unsubscribes.has(session_key)) return;
    const unsubscribe = session.subscribe((mutation) => {
      this.events.mutation({ agent_id, workspace_id, session_id: session.id, mutation });
      if (mutation.variant === "part" && mutation.type === "interaction") {
        const current = this.runtimes.get(session_key);
        this.update_runtime({
          agent_id,
          workspace_id,
          session_id: session.id,
          status: mutation.part.status === "pending" ? "waiting_input" : "streaming",
          ...(mutation.turn_id ? { turn_id: mutation.turn_id } : current?.turn_id ? { turn_id: current.turn_id } : {}),
          updated_at: mutation.created_at,
        });
      }
      if (mutation.variant !== "turn") return;
      this.update_runtime({
        agent_id,
        workspace_id,
        session_id: session.id,
        status: mutation.type === "start"
          ? "streaming"
          : mutation.status === "completed"
            ? "completed"
            : mutation.status === "stopped"
              ? "stopped"
              : "failed",
        turn_id: mutation.turn_id,
        ...(mutation.error ? { error: mutation.error } : {}),
        updated_at: mutation.created_at,
      });
    });
    this.session_unsubscribes.set(session_key, unsubscribe);
  }

  /** 释放一个 Session 的订阅、运行态和 Desktop 模型覆盖。 */
  private release_session_projection(agent_id: string, workspace_id: string, session_id: string): void {
    const session_key = get_session_key(agent_id, workspace_id, session_id);
    this.session_unsubscribes.get(session_key)?.();
    this.session_unsubscribes.delete(session_key);
    this.runtimes.delete(session_key);
    this.restored_session_models.delete(session_key);
    const model_ids = this.read_session_model_ids();
    if (!(session_key in model_ids)) return;
    delete model_ids[session_key];
    this.data.settings.set(session_model_settings_key, model_ids);
  }

  /** 从 SDK status 恢复应用重启或首次进入时的运行态。 */
  private async read_runtime(agent_id: string, workspace_id: string, session: AgentSession): Promise<DesktopChatRuntime> {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    const current = this.runtimes.get(session_key);
    if (current) return current;
    const status = await session.status();
    const runtime: DesktopChatRuntime = {
      agent_id,
      workspace_id,
      session_id: session.id,
      status: status.state === "running" ? "streaming" : "idle",
      ...(status.active_turn_id ? { turn_id: status.active_turn_id } : {}),
      updated_at: Date.now(),
    };
    this.runtimes.set(session_key, runtime);
    return runtime;
  }

  /** 把 SDK Session 配置收敛成可序列化 Renderer 投影。 */
  private async read_session_configuration(workspace_id: string, session: AgentSession): Promise<DesktopSessionConfiguration> {
    const status = await session.status();
    const agent_config = this.data.agents.get(session.agent_id);
    const default_model_id = typeof agent_config?.execution?.model_id === "string" ? agent_config.execution.model_id : "";
    const session_key = get_session_key(session.agent_id, workspace_id, session.id);
    const configured_model = session.config.model as { modelId?: unknown } | undefined;
    const runtime_model_id = typeof configured_model?.modelId === "string" ? configured_model.modelId : "";
    return {
      model_id: runtime_model_id || this.read_session_model_ids()[session_key] || default_model_id,
      approval_mode: status.security.approval_mode,
    };
  }

  /** 恢复 Desktop 为 Session 单独保存的模型覆盖。 */
  private async restore_session_model(agent_id: string, workspace_id: string, session: AgentSession): Promise<void> {
    const session_key = get_session_key(agent_id, workspace_id, session.id);
    const model_id = this.read_session_model_ids()[session_key];
    if (!model_id || this.restored_session_models.get(session_key) === model_id) return;
    const entry = await this.require_agent_workspace(agent_id, workspace_id);
    const model = await resolve_desktop_agent_model(this.data, model_id, entry.workspace.get_env());
    await session.set({ model }, { persist_action: false });
    this.restored_session_models.set(session_key, model_id);
  }

  /** 读取按 Agent + Session 索引的稳定模型 ID。 */
  private read_session_model_ids(): Record<string, string> {
    const value = this.data.settings.get<Record<string, unknown>>(session_model_settings_key) ?? {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, model_id]) => typeof model_id === "string" && model_id.trim() ? [[key, model_id.trim()]] : []));
  }

  /** 保存一个 Session 的稳定模型 ID。 */
  private persist_session_model_id(agent_id: string, workspace_id: string, session_id: string, model_id: string): void {
    const current = this.read_session_model_ids();
    this.data.settings.set(session_model_settings_key, {
      ...current,
      [get_session_key(agent_id, workspace_id, session_id)]: model_id,
    });
  }

  /** 保存并广播 Session 运行态。 */
  private update_runtime(runtime: DesktopChatRuntime): void {
    this.runtimes.set(get_session_key(runtime.agent_id, runtime.workspace_id, runtime.session_id), runtime);
    this.events.runtime({ runtime });
  }

  /** 读取由 Desktop City 持有的本地 Agent。 */
  private require_native_agent(agent_id: string): Agent {
    const agent = this.city.agents.get(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 按需让 Desktop Agent 进入指定 Workspace。 */
  private async require_agent_workspace(agent_id: string, workspace_id: string) {
    const agent = this.require_native_agent(agent_id);
    const existing = agent.workspace(workspace_id);
    if (existing) return existing;
    const config = this.data.workspaces.get(workspace_id);
    if (!config) throw new Error(`Workspace not found: ${workspace_id}`);
    const workspace = this.city.workspace(workspace_id)
      ?? this.city.workspaces.add(await create_desktop_workspace(this.data, config));
    return agent.enter(workspace);
  }
}

/** 把 Registry Agent 收敛成 Renderer 所需摘要。 */
function to_desktop_agent_summary(record: Pick<LocalAgentConfig, "agent_id" | "version" | "execution">, avatar_url?: string): DesktopAgentSummary {
  return {
    agent_id: record.agent_id,
    ...(avatar_url ? { avatar_url } : {}),
    model_id: typeof record.execution?.model_id === "string" ? record.execution.model_id : "",
    version: record.version,
  };
}

/** 把 Registry Workspace 收敛成 Renderer 所需摘要。 */
function to_desktop_workspace_summary(record: LocalWorkspaceConfig): DesktopWorkspaceSummary {
  return {
    workspace_id: record.workspace_id,
    workspace_path: record.workspace_path,
    name: record.name,
  };
}

/** 把 SDK Session 摘要投影为 Desktop 导航模型。 */
function to_desktop_session_summary(session: AgentSessionSummary): DesktopSessionSummary {
  return {
    session_id: session.session_id,
    title: session.title || "新会话",
    preview_text: session.preview_text || "",
    created_at: session.created_at || 0,
    updated_at: session.updated_at || session.created_at || 0,
    message_count: session.message_count,
    executing: Boolean(session.executing),
  };
}

/** 生成不会与其他 Agent Session 冲突的主进程缓存键。 */
function get_session_key(agent_id: string, workspace_id: string, session_id: string): string {
  return `${agent_id}:${workspace_id}:${session_id}`;
}

/** 把进程环境收敛为不含 undefined 的只读配置。 */
function process_environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** 把未知失败统一转换为可序列化文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 校验 IPC Chat 输入并转换成 SDK 标准 User Message parts。 */
function normalize_chat_input(input: DesktopChatInput): AgentSessionPromptInput["query"] {
  const text = String(input?.text || "").trim();
  const files = Array.isArray(input?.files) ? input.files : [];
  const references = Array.isArray(input?.references) ? input.references.filter((reference) => String(reference?.message_id || "").trim() && String(reference?.text || "").trim()) : [];
  if (!text && files.length === 0 && references.length === 0) throw new Error("message is required");
  if (files.length === 0 && references.length === 0) return text;
  const parts: Array<Record<string, unknown>> = [];
  if (references.length > 0) {
    parts.push({
      type: "text",
      text: references.map((reference) => `> 引用 ${reference.role === "user" ? "用户" : "Agent"} 消息：\n> ${String(reference.text).trim().replace(/\n/g, "\n> ")}`).join("\n\n"),
    });
    for (const reference of references) {
      parts.push({
        type: "data-reference",
        data: { message_id: String(reference.message_id), role: reference.role, text: String(reference.text).trim() },
      });
    }
  }
  if (text) parts.push({ type: "text", text });
  for (const file of files) {
    const data_url = String(file?.data_url || "");
    if (!data_url.startsWith("data:")) throw new Error("attachment must use a data URL");
    parts.push({
      type: "file",
      mediaType: String(file?.media_type || "application/octet-stream"),
      url: data_url,
      filename: String(file?.filename || "attachment"),
    });
  }
  return parts as unknown as AgentSessionPromptInput["query"];
}
