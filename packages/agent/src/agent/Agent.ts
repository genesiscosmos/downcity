/**
 * Agent：身份、模型、指令与 Session 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - Plugin 与其他宿主扩展由 City 持有，Agent 只接收 Session 执行端口。
 * - Session 由 AgentSessions 统一持有；Workspace 只在单个 Session 创建时提供执行资源。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import type { AgentModel } from "@/agent/AgentModel.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import type {
  AgentOptions,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type {
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import {
  clear_agent_runtime,
  create_workspace_entry,
  dispose_agent_runtime,
  ensure_agent_runtime_ready,
  get_agent_storage,
  initialize_agent_runtime,
  list_workspace_entries,
  mark_agent_session_started,
  resolve_agent_session_hooks,
  release_agent_from_container,
} from "@/internal/AgentRuntime.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

  /** Agent 的用户可见名称。 */
  readonly name: string;

  /** Agent 的一句话能力描述，供展示与 Group 调度使用。 */
  readonly description: string;

  /** Agent 默认模型；Session 可以显式覆盖。 */
  readonly model?: AgentModel;

  /** Agent 面向用户的 Session 创建入口。 */
  readonly sessions: AgentSessionCollection;

  /** Agent 自定义 Tool；进入每个 Workspace 时与项目 Tool 合并。 */
  readonly custom_tools: Record<string, Tool>;

  /** Agent 使用的 Session 类。 */
  readonly session_class?: AgentSessionConstructor;

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 唯一的 Session 集合。 */
  private readonly session_manager: AgentSessions;

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    this.name = String(options.name || "").trim() || this.id;
    this.description = String(options.description || "").trim();
    initialize_agent_runtime(this);
    this.model = options.model;
    this.instruction = normalize_instruction_input(options.instruction);
    const agent = this;
    this.session_class = options.session_class;
    this.custom_tools = options.tools && typeof options.tools === "object"
      ? { ...options.tools }
      : {};
    const get_store = (): import("@/types/store/SessionStore.js").SessionStore =>
      get_agent_storage(this).sessions;
    const session_store = {
      session: (session_id, origin, workspace_id) => get_store().session(session_id, origin, workspace_id),
      has_session: async (session_id, origin_type) => await get_store().has_session(session_id, origin_type),
      remove_session: async (session_id, origin_type) => await get_store().remove_session(session_id, origin_type),
      clear_session_messages: async (session_id, origin_type) => await get_store().clear_session_messages(session_id, origin_type),
      list_sessions: async (input: Parameters<import("@/types/store/SessionStore.js").SessionStore["list_sessions"]>[0], executing: ReadonlySet<string>) => await get_store().list_sessions(input, executing),
      archive_session: async (session_id, origin_type) => await get_store().archive_session(session_id, origin_type),
      list_archived_sessions: async (input?: Parameters<import("@/types/store/SessionStore.js").SessionStore["list_archived_sessions"]>[0]) => await get_store().list_archived_sessions(input),
      clean_archive: async () => await get_store().clean_archive(),
      dispose: async () => {},
    } satisfies import("@/types/store/SessionStore.js").SessionStore;
    this.session_manager = new AgentSessions({
      agent_id: this.id,
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      ensure_agent_ready: async () => await this.ensure_ready(),
      get_agent_model: () => this.model,
      session_class: this.session_class,
      on_session_routed: () => mark_agent_session_started(agent),
      resolve_session_context: (workspace) => {
        if (!workspace) return {
          workspace_path: ".",
          logger: this.logger,
          tools: this.custom_tools,
          get_workspace_env: () => ({}),
          get_hooks: () => resolve_agent_session_hooks(this),
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

  /** 释放 Agent 进入的全部 Workspace 与运行时资源。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const entries = [...list_workspace_entries(this)];
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      this.session_manager.dispose_title_generation();
      results.push(...await Promise.allSettled([release_agent_from_container(this)]));
      results.push(...await Promise.allSettled([dispose_agent_runtime(this)]));
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      clear_agent_runtime(this);
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 等待 Agent 自身运行时 ready，供内部运行时使用。 */
  async ensure_ready(): Promise<void> {
    await ensure_agent_runtime_ready(this);
  }

}
