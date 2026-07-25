/**
 * AgentSessions：本地 Agent session 集合入口。
 *
 * 关键点（中文）
 * - 统一管理 session 缓存、创建、恢复、默认配置注入与列表查询。
 * - 该服务只负责 session 生命周期与查询，不负责 plugin / RPC 启停。
 * - Session 对象创建细节集中在这里，避免 facade 和 lifecycle 重复依赖 Session 构造逻辑。
 */

import { nanoid } from "nanoid";
import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type {
  AgentCreateSessionInput,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
  AgentSessionSystemBlock,
} from "@/types/agent/SessionTypes.js";
import type { AgentSessionConstructor } from "@/types/agent/AgentOptions.js";
import type {
  AgentSession,
  AgentSessions as AgentSessionsContract,
} from "@/types/agent/SessionActor.js";
import type { AgentManagedSession } from "@/types/session/SessionOptions.js";
import { Session } from "@/session/Session.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import { createInstructionSystemBlocks } from "@/agent/AgentInstructions.js";
import type { AgentPluginExecutionRuntime } from "@/types/plugin/PluginRuntime.js";
import type { AgentStore } from "@/types/store/AgentStore.js";

type AgentSessionsOptions = {
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /**
   * 当前项目根目录。
   */
  project_root: string;

  /** 当前 Agent 独享的领域持久化入口。 */
  store: AgentStore;

  /**
   * 当前 agent 默认工具集合。
   */
  tools: Record<string, Tool>;

  /**
   * 当前统一日志器。
   */
  logger: Logger;

  /**
   * 当前静态 instruction 文本集合。
   */
  get_instruction: () => string[];

  /** 延迟读取当前 Agent configured env。 */
  get_agent_env: () => Record<string, string>;

  /** 创建当前 configured Plugin registry 的 Session step 执行视图。 */
  get_agent_plugins: () => AgentPluginExecutionRuntime;

  /**
   * 等待当前 Agent 持有的长期运行时启动完成。
   */
  ensure_agent_ready: () => Promise<void>;

  /**
   * 当前 agent 使用的本地 Session 类。
   */
  SessionClass?: AgentSessionConstructor;

  /** 读取 Agent 当前持有的运行时模型实例。 */
  get_agent_model: () => AgentModel | undefined;
};

/**
 * 本地 Agent session 管理服务。
 */
export class AgentSessions implements AgentSessionsContract<AgentSession> {
  private readonly agent_id: string;
  private readonly project_root: string;
  private readonly store: AgentStore;
  private readonly tools: Record<string, Tool>;
  private readonly logger: Logger;
  private readonly get_instruction: AgentSessionsOptions["get_instruction"];
  private readonly get_agent_env: AgentSessionsOptions["get_agent_env"];
  private readonly get_agent_plugins: AgentSessionsOptions["get_agent_plugins"];
  private readonly ensure_agent_ready: AgentSessionsOptions["ensure_agent_ready"];
  private readonly SessionClass: AgentSessionConstructor;
  private readonly get_agent_model: AgentSessionsOptions["get_agent_model"];
  private readonly sessions_by_id = new Map<string, AgentManagedSession>();

  constructor(options: AgentSessionsOptions) {
    this.agent_id = options.agent_id;
    this.project_root = options.project_root;
    this.store = options.store;
    this.tools = options.tools;
    this.logger = options.logger;
    this.get_instruction = options.get_instruction;
    this.get_agent_env = options.get_agent_env;
    this.get_agent_plugins = options.get_agent_plugins;
    this.ensure_agent_ready = options.ensure_agent_ready;
    this.SessionClass = options.SessionClass || Session;
    this.get_agent_model = options.get_agent_model;
  }

  /**
   * 返回当前缓存的 session 实例。
   */
  list_cached_sessions(): AgentManagedSession[] {
    return [...this.sessions_by_id.values()];
  }

  /** 返回当前所有执行中的 Session 标识。 */
  list_executing_session_ids(): string[] {
    return this.list_cached_sessions()
      .filter((session) => session.isExecuting())
      .map((session) => session.id);
  }

  /** 返回当前执行中的 Session 数量。 */
  get_executing_session_count(): number {
    return this.list_executing_session_ids().length;
  }

  /**
   * 把 Agent env 修改广播到已有 Session 的统一输入队列。
   */
  broadcast_env(env: Record<string, string>, command_id: string): void {
    for (const session of this.sessions_by_id.values()) {
      session.enqueue_agent_command({
        type: "env",
        command_id,
        env: { ...env },
      });
    }
  }

  /**
   * 把 Plugin registry 修改广播到已有 Session 的统一输入队列。
   */
  broadcast_plugins(input: {
    command_id: string;
    title: string;
    plugins: AgentPluginExecutionRuntime;
  }): void {
    for (const session of this.sessions_by_id.values()) {
      session.enqueue_agent_command({
        type: "plugins",
        command_id: input.command_id,
        title: input.title,
        plugins: input.plugins,
      });
    }
  }

  /**
   * 获取或创建一个 session runtime port。
   */
  runtime(session_id: string): SessionPort {
    return this.get_or_create_session({ session_id }).getRuntimePort();
  }

  /**
   * 新建一个 session。
   */
  async create(
    input?: AgentCreateSessionInput,
  ): Promise<AgentSession> {
    const explicit_session_id =
      String(input?.sessionId || "").trim() || undefined;
    if (
      explicit_session_id &&
      (this.sessions_by_id.has(explicit_session_id) ||
        (await this.store.has_session(explicit_session_id)))
    ) {
      throw new Error(`Session "${explicit_session_id}" already exists`);
    }
    const session = this.get_or_create_session({
      session_id: explicit_session_id,
    });
    await session.initialize();
    return session;
  }

  /**
   * 获取一个已存在的 session。
   */
  async get(session_id: string): Promise<AgentSession> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.get requires a non-empty sessionId");
    }
    if (
      !this.sessions_by_id.has(resolved_session_id) &&
      !(await this.store.has_session(resolved_session_id))
    ) {
      throw new Error(`Session "${resolved_session_id}" not found`);
    }
    const session = this.get_or_create_session({
      session_id: resolved_session_id,
    });
    await session.initialize();
    return session;
  }

  /**
   * 永久删除一个 Session 及其全部 Agent 领域数据。
   *
   * 关键点（中文）
   * - 正在执行的 Session 会先停止，避免删除后继续写入。
   * - 该方法不处理任何 Plugin 自有数据。
   */
  async remove(session_id: string): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.remove requires a non-empty sessionId");
    }
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached?.isExecuting()) {
      await cached.stop();
    }
    const existed = await this.store.remove_session(resolved_session_id);
    this.sessions_by_id.delete(resolved_session_id);
    return existed;
  }

  /**
   * 清空一个 Session 的消息目录。
   */
  async clear_messages(session_id: string): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.clear_messages requires a non-empty sessionId");
    }
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached?.isExecuting()) {
      throw new Error(`Session "${resolved_session_id}" is currently executing`);
    }
    const existed = await this.store.clear_session_messages(resolved_session_id);
    this.sessions_by_id.delete(resolved_session_id);
    return existed;
  }

  /**
   * 列出当前 agent 的 session 摘要页。
   */
  async list(
    input?: AgentListSessionsInput,
  ): Promise<AgentSessionSummaryPage> {
    return await this.store.list_sessions(
      input,
      new Set(this.list_executing_session_ids()),
    );
  }

  /**
   * 归档单个 session。
   */
  async archive(
    input: AgentArchiveSessionInput,
  ): Promise<AgentArchiveSessionResult> {
    const session_id = String(input?.id || "").trim();
    if (!session_id) {
      throw new Error("sessions.archive requires a non-empty id");
    }

    const executing_session_ids = new Set(this.list_executing_session_ids());
    if (executing_session_ids.has(session_id)) {
      throw new Error(`Session "${session_id}" is currently executing`);
    }

    const result = await this.store.archive_session(session_id);
    this.sessions_by_id.delete(session_id);
    return result;
  }

  /**
   * 列出当前 agent 的已归档 session 摘要页。
   */
  async archived(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    return await this.store.list_archived_sessions(input);
  }

  /**
   * 永久清空已归档 session。
   */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    return await this.store.clean_archive();
  }

  private get_or_create_session(input?: {
    /**
     * 可选指定 session id。
     */
    session_id?: string;
  }): AgentManagedSession {
    const resolved_session_id =
      String(input?.session_id || "").trim() ||
      `session-${Date.now()}-${nanoid(8)}`;
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached) return cached;

    const created = new this.SessionClass({
      agentId: this.agent_id,
      projectRoot: this.project_root,
      store: this.store.session(resolved_session_id),
      get_session_store: (session_id) => this.store.session(session_id),
      sessionId: resolved_session_id,
      tools: this.tools,
      logger: this.logger,
      instruction_system_blocks: this.load_instruction_system_blocks(),
      get_instruction_system_blocks: () => this.load_instruction_system_blocks(),
      getAgentEnv: () => this.get_agent_env(),
      getAgentModel: () => this.get_agent_model(),
      get_agent_plugins: () => this.get_agent_plugins(),
      getManagedPluginSystemBlocks: async () => [],
      ensureConfigured: async (session) => {
        await this.ensure_agent_ready();
      },
    });
    this.sessions_by_id.set(resolved_session_id, created);
    return created;
  }

  private load_instruction_system_blocks(): AgentSessionSystemBlock[] {
    return createInstructionSystemBlocks(
      this.get_instruction(),
      this.project_root,
    );
  }

}
