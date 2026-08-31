/**
 * Agent：身份、模型、指令与 Plugin 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - PluginRegistry 只属于 Agent，所有 Workspace 共享同一份注册定义。
 * - Session 由 AgentSessions 统一持有；Workspace 只在单个 Session 创建时提供执行资源。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import type { AgentModel } from "@/agent/AgentModel.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type {
  AgentOptions,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type { PluginWebServices } from "@/types/plugin/PluginServices.js";
import type {
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import {
  agent_embassy,
  clear_agent_runtime,
  create_workspace_entry,
  dispose_agent_runtime,
  get_agent_storage,
  initialize_agent_runtime,
  list_workspace_entries,
  mark_agent_session_started,
  release_agent_from_city,
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

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 级 Plugin lifecycle 启动流程。 */
  private readonly plugin_ready: Promise<unknown>;

  /** Agent 唯一的 Session 集合。 */
  private readonly session_manager: AgentSessions;

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
      get embassy() {
        return agent_embassy(agent);
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
    const no_workspace_plugins = () => ({
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
    });
    const get_store = (): import("@/types/store/SessionStore.js").SessionStore =>
      get_agent_storage(this).sessions;
    const session_store = {
      session: (session_id: string, workspace_id?: string) => get_store().session(session_id, workspace_id),
      has_session: async (session_id: string) => await get_store().has_session(session_id),
      remove_session: async (session_id: string) => await get_store().remove_session(session_id),
      clear_session_messages: async (session_id: string) => await get_store().clear_session_messages(session_id),
      list_sessions: async (input: Parameters<import("@/types/store/SessionStore.js").SessionStore["list_sessions"]>[0], executing: ReadonlySet<string>) => await get_store().list_sessions(input, executing),
      archive_session: async (session_id: string) => await get_store().archive_session(session_id),
      list_archived_sessions: async (input?: Parameters<import("@/types/store/SessionStore.js").SessionStore["list_archived_sessions"]>[0]) => await get_store().list_archived_sessions(input),
      clean_archive: async () => await get_store().clean_archive(),
      dispose: async () => {},
    } satisfies import("@/types/store/SessionStore.js").SessionStore;
    this.session_manager = new AgentSessions({
      agent_id: this.id,
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      ensure_agent_ready: async () => { await this.plugin_ready; },
      get_agent_model: () => this.model,
      session_class: this.session_class,
      on_session_routed: () => mark_agent_session_started(agent),
      resolve_session_context: (workspace) => {
        if (!workspace) return {
          workspace_path: ".",
          logger: this.logger,
          tools: this.custom_tools,
          get_workspace_env: () => ({}),
          get_agent_plugins: no_workspace_plugins,
          store: session_store,
        };
        return create_workspace_entry(this, workspace).get_session_context();
      },
    });
    this.sessions = this.session_manager;
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
      const entries = [...list_workspace_entries(this)];
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      await this.plugins.unregister_all();
      this.session_manager.dispose_title_generation();
      await dispose_agent_runtime(this);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      release_agent_from_city(this);
      clear_agent_runtime(this);
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 等待 Agent 级 Plugin 完成启动，供内部运行时使用。 */
  async ensure_ready(): Promise<void> {
    await this.plugin_ready;
  }

}
