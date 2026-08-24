/**
 * Agent：身份、模型、指令与 Plugin 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - PluginRegistry 只属于 Agent，所有 Workspace 共享同一份注册定义。
 * - Workspace Tool、Session、Shell 与项目日志由 AgentWorkspace 独立持有。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type {
  AgentOptions,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type { PluginWebServices } from "@/types/plugin/PluginServices.js";
import type { City } from "../city/index.js";
import type {
  AgentCreateSessionOptions,
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { LocalSessionStore } from "@/workspace/store/LocalSessionStore.js";
import { MemoryFileSystem } from "@/workspace/store/MemoryFileSystem.js";
import type {
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
  AgentArchiveSessionsResult,
  AgentArchiveSessionResult,
  AgentCleanArchiveResult,
} from "@/types/agent/SessionTypes.js";
import {
  agent_city,
  agent_storage,
  clear_agent_runtime,
  create_agent_workspace,
  dispose_agent_runtime,
  get_agent_storage,
  initialize_agent_runtime,
  list_agent_workspaces,
} from "@/internal/AgentRuntime.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

  /** Agent 默认模型；Session 可以显式覆盖。 */
  readonly model?: AgentModel;

  /** Agent 面向用户的 Session 创建入口。 */
  readonly sessions: AgentSessionCollection;

  /** 当前 Agent 持有的 Web 搜索与文档能力。 */
  readonly web?: PluginWebServices;

  /** Agent 注册的唯一 PluginRegistry。 */
  readonly plugins: PluginRegistry;

  /** Agent 自定义 Tool；进入每个 Workspace 时与项目 Tool 合并。 */
  readonly custom_tools: Record<string, Tool>;

  /** Agent 使用的 Session 类。 */
  readonly session_class?: AgentSessionConstructor;

  /** AgentPlugin 的内部访问名，仍指向 Agent 唯一 Registry。 */
  readonly plugin_registry: PluginRegistry;

  /** 当前 Agent 所在的完整 City；未加入 City 时为空。 */
  get city(): City | undefined {
    return agent_city(this);
  }

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 级 Plugin lifecycle 启动流程。 */
  private readonly plugin_ready: Promise<unknown>;

  /** 无 Workspace 时使用的进程内 Session 集合。 */
  private readonly memory_sessions: AgentSessions;

  /** City 中按 Agent 持有的持久化 Session 集合；无 City 时按需保持为空。 */
  private persistent_sessions?: AgentSessions;

  /** Agent 内部维护的 Session 唯一路由；值是实际执行上下文所属的集合。 */
  private readonly session_routes = new Map<string, AgentSessions>();

  /** 登记 Agent 内部 Session 路由；不属于公开 SDK API。 */
  register_session_route(session_id: string, sessions: AgentSessions): void {
    const key = String(session_id || "").trim();
    if (key) this.session_routes.set(key, sessions);
  }

  /** Workspace 离开时移除该执行集合下的 Session 路由。 */
  unregister_session_routes(sessions: AgentSessions): void {
    for (const [session_id, routed_sessions] of this.session_routes.entries()) {
      if (routed_sessions === sessions) this.session_routes.delete(session_id);
    }
  }

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    initialize_agent_runtime(this);
    this.model = options.model;
    this.web = options.web;
    this.instruction = normalize_instruction_input(options.instruction);
    const agent = this;
    const agent_plugin_context: AgentPluginContext = Object.freeze({
      agent_id: this.id,
      logger: this.logger,
      web: this.web,
      get city() {
        return agent_city(agent);
      },
      get instructions() {
        return agent.get_instructions();
      },
    });
    this.session_class = options.session_class;
    this.plugins = new PluginRegistry(agent_plugin_context, options.plugins || []);
    this.plugin_registry = this.plugins;
    this.plugin_ready = this.plugins.start_all();
    this.custom_tools = options.tools && typeof options.tools === "object"
      ? { ...options.tools }
      : {};
    const memory_files = MemoryFileSystem.shared(`/memory/agents/${this.id}`);
    const memory_store = new LocalSessionStore({
      files: memory_files,
      storage_root_path: memory_files.root_path,
      agent_id: this.id,
    });
    this.memory_sessions = this.create_unscoped_sessions(memory_store);
    this.sessions = {
      create: async (input) => await this.create_session(input),
      get: async (session_id, input) => await this.get_session(session_id, input),
      list: async (input) => await this.list_sessions(input),
      archive: async (input) => await this.archive_session(input),
      archived: async (input) => await this.list_archived_sessions(input),
      clean_archive: async () => await this.clean_archived_sessions(),
      runtime: (session_id) => this.resolve_session_runtime(session_id),
      remove: async (session_id) => await this.resolve_session_collection(session_id).remove(session_id),
      clear_messages: async (session_id) => await this.resolve_session_collection(session_id).clear_messages(session_id),
    };
  }

  /** 更新 Agent 的静态基础指令。 */
  set_instruction(input: string | string[]): void {
    const next_instruction = normalize_instruction_input(input);
    this.instruction.splice(0, this.instruction.length, ...next_instruction);
  }

  /** 返回 Agent 指令快照。 */
  get_instructions(): readonly string[] {
    return [...this.instruction];
  }

  /** 返回 Agent 级日志器。 */
  get_logger(): Logger {
    return this.logger;
  }

  /** 释放 Agent 进入的全部 Workspace 与 Agent Plugin。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      await this.plugin_ready.catch(() => undefined);
      const entries = [...list_agent_workspaces(this)];
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      await this.plugins.unregister_all();
      this.memory_sessions.dispose_title_generation();
      this.persistent_sessions?.dispose_title_generation();
      await dispose_agent_runtime(this);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      agent_city(this)?.release_agent(this);
      clear_agent_runtime(this);
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 等待 Agent 级 Plugin 完成启动，供内部运行时使用。 */
  async ensure_ready(): Promise<void> {
    await this.plugin_ready;
  }

  /** 在指定 City Workspace 中创建属于当前 Agent 的 Session。 */
  private async create_session(input?: AgentCreateSessionOptions) {
    if (this.dispose_promise) throw new Error("Cannot create a Session after Agent disposal");
    await this.plugin_ready;
    if (!input?.workspace) {
      return await this.get_unscoped_sessions().create();
    }
    const sessions = create_agent_workspace(this, input.workspace).sessions;
    const session = await sessions.create();
    this.session_routes.set(session.id, sessions);
    return session;
  }

  /** 恢复属于当前 Agent 的 Session；Workspace 仅作为可选定位提示。 */
  private async get_session(session_id: string, input?: AgentCreateSessionOptions) {
    if (!session_id) throw new Error("agent.sessions.get requires a session_id");
    if (this.dispose_promise) throw new Error("Cannot get a Session after Agent disposal");
    if (input?.workspace) {
      const sessions = create_agent_workspace(this, input.workspace).sessions;
      const session = await sessions.get(session_id);
      this.session_routes.set(session_id, sessions);
      return session;
    }
    const routed_sessions = this.session_routes.get(session_id);
    if (routed_sessions) return await routed_sessions.get(session_id);
    return await this.get_unscoped_sessions().get(session_id);
  }

  private resolve_session_collection(session_id: string): AgentSessions {
    return this.session_routes.get(String(session_id || "").trim()) || (agent_city(this) ? this.get_unscoped_sessions() : this.memory_sessions);
  }

  private resolve_session_runtime(session_id: string) {
    const key = String(session_id || "").trim();
    const routed_sessions = this.session_routes.get(key);
    if (routed_sessions) return routed_sessions.runtime(key);
    if (this.memory_sessions.list_cached_sessions().some((session) => session.id === key)) {
      return this.memory_sessions.runtime(key);
    }
    if (this.persistent_sessions?.list_cached_sessions().some((session) => session.id === key)) {
      return this.persistent_sessions.runtime(key);
    }
    throw new Error(`Session "${key}" not found`);
  }

  private async list_sessions(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> {
    // Agent Store 是唯一的 Session 目录；Workspace 集合只提供执行上下文。
    return await this.get_unscoped_sessions().list(input);
  }

  private async archive_session(input: AgentArchiveSessionInput): Promise<AgentArchiveSessionResult> {
    const sessions = this.session_routes.get(String(input?.id || "").trim()) || this.persistent_sessions || this.memory_sessions;
    return await sessions.archive(input);
  }

  private async list_archived_sessions(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult> {
    // 直接透传分页参数，避免跨 Workspace 重复扫描与固定 500 条上限。
    return await this.get_unscoped_sessions().archived(input);
  }

  private async clean_archived_sessions(): Promise<AgentCleanArchiveResult> {
    return await this.get_unscoped_sessions().clean_archive();
  }

  /** 返回无 Workspace 执行上下文的 Agent 级 Session 集合。 */
  private get_unscoped_sessions(): AgentSessions {
    if (this.persistent_sessions) return this.persistent_sessions;
    if (!agent_city(this)) return this.memory_sessions;
    const storage = agent_storage(this) || get_agent_storage(this);
    this.persistent_sessions = this.create_unscoped_sessions(storage.sessions);
    return this.persistent_sessions;
  }

  /** 创建不绑定 Workspace 的 Session 集合，统一用于内存与 Agent 持久化 Store。 */
  private create_unscoped_sessions(store: import("@/types/store/SessionStore.js").SessionStore): AgentSessions {
    return new AgentSessions({
      agent_id: this.id,
      workspace_path: ".",
      store,
      tools: this.custom_tools,
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      get_workspace_env: () => ({}),
      get_agent_plugins: () => ({
        plugins: [],
        read: () => ({ plugins: [] }),
        run_action: async () => ({ success: false, error: "Workspace is required" }),
        system_blocks: async () => [],
        acquire: () => ({
          read: () => ({ plugins: [] }),
          run_action: async () => ({ success: false, error: "Workspace is required" }),
          system_blocks: async () => [],
          release: async () => {},
        }),
      }),
      ensure_agent_ready: async () => { await this.plugin_ready; },
      get_agent_model: () => this.model,
      session_class: this.session_class,
    });
  }
}
