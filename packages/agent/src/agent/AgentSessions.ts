/**
 * AgentSessions：本地 Agent session 集合入口。
 *
 * 关键点（中文）
 * - 统一管理 session 缓存、创建、恢复、默认配置注入与列表查询。
 * - 该服务只负责 Session 生命周期与查询，不负责 Extension / RPC 启停。
 * - Session 对象创建细节集中在这里，避免 facade 和 lifecycle 重复依赖 Session 构造逻辑。
 */

import { nanoid } from "nanoid";
import type { RuntimeTool as Tool } from "@downcity/type";
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
import { create_instruction_system_blocks } from "@/agent/AgentInstructions.js";
import type { SessionExtensionRuntime } from "@downcity/type/session";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";
import { normalize_session_origin, normalize_session_origin_type } from "@/session/SessionOrigin.js";

type AgentSessionsOptions = {
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /**
   * 按 Session 解析执行上下文。
   *
   * AgentSessions 是 Agent 唯一的 Session 集合；Workspace 相关能力不能
   * 固定在集合实例上，而应在创建或恢复单个 Session 时解析。
   */
  resolve_session_context: (workspace?: WorkspaceRuntime) => {
    workspace_path: string;
    workspace_id?: string;
    logger: Logger;
    tools: Record<string, Tool>;
    get_workspace_env: () => Record<string, string>;
    get_extensions: () => SessionExtensionRuntime;
    store: SessionStore;
  };

  /**
   * 当前统一日志器。
   */
  logger: Logger;

  /**
   * 当前静态 instruction 文本集合。
   */
  get_instruction: () => string[];

  /**
   * 等待当前 Agent 持有的长期运行时启动完成。
   */
  ensure_agent_ready: () => Promise<void>;

  /**
   * 当前 agent 使用的本地 Session 类。
   */
  session_class?: AgentSessionConstructor;

  /** 读取 Agent 当前持有的运行时模型实例。 */
  get_agent_model: () => AgentModel | undefined;

  /** Session 创建或恢复后的内部路由登记回调。 */
  on_session_routed?: (session_id: string, sessions: AgentSessions) => void;
};

/**
 * 本地 Agent session 管理服务。
 */
export class AgentSessions implements AgentSessionsContract<AgentSession> {
  private readonly agent_id: string;
  private readonly resolve_session_context: AgentSessionsOptions["resolve_session_context"];
  private readonly logger: Logger;
  private readonly get_instruction: AgentSessionsOptions["get_instruction"];
  private readonly ensure_agent_ready: AgentSessionsOptions["ensure_agent_ready"];
  private readonly session_class: AgentSessionConstructor;
  private readonly get_agent_model: AgentSessionsOptions["get_agent_model"];
  private readonly on_session_routed?: AgentSessionsOptions["on_session_routed"];
  private readonly sessions_by_id = new Map<string, AgentManagedSession>();

  constructor(options: AgentSessionsOptions) {
    this.agent_id = options.agent_id;
    this.resolve_session_context = options.resolve_session_context;
    this.logger = options.logger;
    this.get_instruction = options.get_instruction;
    this.ensure_agent_ready = options.ensure_agent_ready;
    this.session_class = options.session_class || Session;
    this.get_agent_model = options.get_agent_model;
    this.on_session_routed = options.on_session_routed;
  }

  /**
   * 返回当前缓存的 session 实例。
   */
  list_cached_sessions(): AgentManagedSession[] {
    return [...this.sessions_by_id.values()];
  }

  /** 返回当前所有执行中的 Session 标识；可按 Workspace 与来源分区限定。 */
  list_executing_session_ids(workspace_id?: string, origin_type?: string): string[] {
    const resolved_origin_type = origin_type
      ? normalize_session_origin_type(origin_type)
      : undefined;
    return this.list_cached_sessions()
      .filter((session) =>
        session.is_executing()
        && (!workspace_id || session.workspace_id === workspace_id)
        && (!resolved_origin_type || session.origin.type === resolved_origin_type)
      )
      .map((session) => session.id);
  }

  /** 返回当前执行中的 Session 数量。 */
  get_executing_session_count(): number {
    return this.list_executing_session_ids().length;
  }

  /** 停止当前集合内正在执行的 Session；可按 Workspace 限定。 */
  async stop_executing_sessions(workspace_id?: string): Promise<void> {
    const executing_sessions = this.list_cached_sessions().filter((session) =>
      session.is_executing()
      && (!workspace_id || session.workspace_id === workspace_id)
    );
    await Promise.all(executing_sessions.map(async (session) => await session.stop()));
  }

  /** 释放全部缓存 Session 的标题后台任务。 */
  dispose_title_generation(workspace_id?: string): void {
    for (const session of this.sessions_by_id.values()) {
      if (workspace_id && session.workspace_id !== workspace_id) continue;
      session.dispose_title_generation?.();
    }
  }

  /**
   * 把 Agent env 修改广播到已有 Session 的统一输入队列。
   */
  broadcast_env(env: Record<string, string>, command_id: string, workspace_id?: string): void {
    for (const session of this.sessions_by_id.values()) {
      if (workspace_id && session.workspace_id !== workspace_id) continue;
      session.enqueue_workspace_env({
        command_id,
        env: { ...env },
      });
    }
  }

  /**
   * 把 Extension 配置修改广播到已有 Session 的统一输入队列。
   */
  broadcast_extensions(input: {
    command_id: string;
    title: string;
    extensions: SessionExtensionRuntime;
    workspace_id?: string;
  }): void {
    for (const session of this.sessions_by_id.values()) {
      if (input.workspace_id && session.workspace_id !== input.workspace_id) continue;
      session.enqueue_extensions({
        command_id: input.command_id,
        title: input.title,
        extensions: input.extensions,
      });
    }
  }

  /**
   * 获取已缓存 Session 的 runtime port。
   *
   * runtime 是执行层的内部投影，不负责创建 Session。需要创建时必须
   * 通过 `create()` 获取内部生成的 ID；需要恢复时必须先调用 `get()`。
   */
  runtime(session_id: string, origin_type = "chat"): SessionPort {
    const resolved_session_id = String(session_id || "").trim();
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const session = this.sessions_by_id.get(
      this.session_cache_key(resolved_session_id, resolved_origin_type),
    );
    if (!session) {
      throw new Error(
        `Session "${resolved_session_id}" is not loaded from origin "${resolved_origin_type}"; call sessions.get(session_id, origin_type) first`,
      );
    }
    return session.get_runtime_port();
  }

  /**
   * 新建一个 session。
   */
  async create(
    input?: AgentCreateSessionInput & { workspace?: WorkspaceRuntime },
  ): Promise<AgentSession> {
    const origin = normalize_session_origin(input?.origin);
    const session = this.get_or_create_session({
      workspace: input?.workspace,
      origin,
    });
    this.on_session_routed?.(session.id, this);
    await session.initialize();
    return session;
  }

  /**
   * 获取一个已存在的 session。
   */
  async get(
    session_id: string,
    origin_type = "chat",
    input?: { workspace?: WorkspaceRuntime },
  ): Promise<AgentSession> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.get requires a non-empty session_id");
    }
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin_type);
    const context = this.resolve_session_context(input?.workspace);
    const store = context.store;
    if (
      !this.sessions_by_id.has(cache_key) &&
      !(await store.has_session(resolved_session_id, resolved_origin_type))
    ) {
      throw new Error(
        `Session "${resolved_session_id}" not found in origin "${resolved_origin_type}"`,
      );
    }
    const persisted_metadata = await store
      .session(resolved_session_id, { type: resolved_origin_type }, input?.workspace?.id)
      .read_metadata();
    const persisted_workspace_id = String(persisted_metadata.workspace_id || "").trim() || undefined;
    const persisted_origin = persisted_metadata.origin;
    const cached = this.sessions_by_id.get(cache_key);
    const requested_workspace_id = String(input?.workspace?.id || "").trim() || undefined;
    if (persisted_workspace_id !== requested_workspace_id) {
      throw new Error(
        persisted_workspace_id
          ? `Session "${resolved_session_id}" requires Workspace "${persisted_workspace_id}"`
          : `Session "${resolved_session_id}" is not bound to a Workspace`,
      );
    }
    if (cached && cached.workspace_id !== requested_workspace_id) {
      throw new Error(
        `Session "${resolved_session_id}" is already bound to Workspace "${cached.workspace_id || ""}"`,
      );
    }
    const session = this.get_or_create_session({
      session_id: resolved_session_id,
      workspace: input?.workspace,
      origin: persisted_origin,
    });
    this.on_session_routed?.(resolved_session_id, this);
    await session.initialize();
    return session;
  }

  /**
   * 永久删除一个 Session 及其全部 Agent 领域数据。
   *
   * 关键点（中文）
   * - 正在执行的 Session 会先停止，避免删除后继续写入。
   * - 该方法不处理任何 Extension 自有数据。
   */
  async remove(session_id: string, origin_type = "chat"): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.remove requires a non-empty session_id");
    }
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin_type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.is_executing()) {
      await cached.stop();
    }
    cached?.dispose_title_generation?.();
    const existed = await this.resolve_session_context().store.remove_session(
      resolved_session_id,
      resolved_origin_type,
    );
    this.sessions_by_id.delete(cache_key);
    return existed;
  }

  /**
   * 清空一个 Session 的消息目录。
   */
  async clear_messages(session_id: string, origin_type = "chat"): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.clear_messages requires a non-empty session_id");
    }
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin_type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.is_executing()) {
      throw new Error(`Session "${resolved_session_id}" is currently executing`);
    }
    cached?.dispose_title_generation?.();
    const existed = await this.resolve_session_context().store.clear_session_messages(
      resolved_session_id,
      resolved_origin_type,
    );
    this.sessions_by_id.delete(cache_key);
    return existed;
  }

  /**
   * 列出当前 agent 的 session 摘要页。
   */
  async list(
    input?: AgentListSessionsInput,
  ): Promise<AgentSessionSummaryPage> {
    const origin_type = normalize_session_origin_type(input?.origin_type ?? "chat");
    return await this.resolve_session_context().store.list_sessions(
      { ...(input || {}), origin_type },
      new Set(this.list_executing_session_ids(undefined, origin_type)),
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
    const origin_type = normalize_session_origin_type(input.origin_type ?? "chat");
    const cache_key = this.session_cache_key(session_id, origin_type);

    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.is_executing()) {
      throw new Error(`Session "${session_id}" is currently executing`);
    }

    const result = await this.resolve_session_context().store.archive_session(session_id, origin_type);
    cached?.dispose_title_generation?.();
    this.sessions_by_id.delete(cache_key);
    return result;
  }

  /**
   * 列出当前 agent 的已归档 session 摘要页。
   */
  async archived(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    return await this.resolve_session_context().store.list_archived_sessions(input);
  }

  /**
   * 永久清空已归档 session。
   */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    return await this.resolve_session_context().store.clean_archive();
  }

  /**
   * 把 Session 重新绑定到另一个 Workspace。
   *
   * 关键点（中文）
   * - 只改写 meta.json 中的 workspace_id 并清掉运行时缓存；
   * - 之后用新 Workspace 恢复时不再触发严格的 workspace 归属校验。
   */
  async workspace(
    session_id: string,
    workspace: WorkspaceRuntime,
  ): Promise<AgentSession> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("sessions.workspace requires a non-empty session_id");
    }
    const resolved_origin_type = normalize_session_origin_type("chat");
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin_type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.is_executing()) {
      throw new Error(`Session "${resolved_session_id}" is currently executing`);
    }
    const context = this.resolve_session_context(workspace);
    if (!(await context.store.has_session(resolved_session_id, resolved_origin_type))) {
      throw new Error(`Session "${resolved_session_id}" not found`);
    }
    const store = context.store.session(
      resolved_session_id,
      { type: resolved_origin_type },
      context.workspace_id,
    );
    const metadata = await store.read_metadata();
    if (metadata.agent_id !== this.agent_id) {
      throw new Error(`Session "${resolved_session_id}" belongs to another Agent`);
    }
    await store.write_metadata({
      ...metadata,
      workspace_id: context.workspace_id,
    });
    this.sessions_by_id.delete(cache_key);
    cached?.dispose_title_generation?.();
    return await this.get(resolved_session_id, resolved_origin_type, { workspace });
  }

  private get_or_create_session(input?: {
    /**
     * 可选指定 session id。
     */
    session_id?: string;
    /** 当前 Session 可选使用的 Workspace。 */
    workspace?: WorkspaceRuntime;
    /** 当前 Session 的创建来源。 */
    origin?: SessionOrigin;
  }): AgentManagedSession {
    const resolved_session_id =
      String(input?.session_id || "").trim() ||
      `session-${Date.now()}-${nanoid(8)}`;
    const origin = normalize_session_origin(input?.origin);
    const cache_key = this.session_cache_key(resolved_session_id, origin.type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached) return cached;

    const context = this.resolve_session_context(input?.workspace);
    const created = new this.session_class({
      agent_id: this.agent_id,
      workspace_path: context.workspace_path,
      ...(context.workspace_id ? { workspace_id: context.workspace_id } : {}),
      origin,
      store: context.store.session(resolved_session_id, origin, context.workspace_id),
      get_session_store: (session_id) => context.store.session(session_id, origin, context.workspace_id),
      register_forked_session: (session) => this.register_forked_session(session),
      session_id: resolved_session_id,
      tools: context.tools,
      logger: context.logger,
      instruction_system_blocks: this.load_instruction_system_blocks(context.workspace_path),
      get_instruction_system_blocks: () => this.load_instruction_system_blocks(context.workspace_path),
      get_workspace_env: () => context.get_workspace_env(),
      get_agent_model: () => this.get_agent_model(),
      get_extensions: () => context.get_extensions(),
      get_managed_extension_system_blocks: async () => [],
      ensure_configured: async (session) => {
        await this.ensure_agent_ready();
      },
    });
    this.sessions_by_id.set(cache_key, created);
    return created;
  }

  /** 接管 fork 产生的 Session，确保后续读取与执行使用同一运行时实例。 */
  private register_forked_session(session: AgentManagedSession): void {
    if (session.agent_id !== this.agent_id) {
      throw new Error(`Cannot register Session "${session.id}" for another Agent`);
    }
    const cache_key = this.session_cache_key(session.id, session.origin.type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached && cached !== session) {
      throw new Error(`Session "${session.id}" already has another runtime instance`);
    }
    this.sessions_by_id.set(cache_key, session);
    this.on_session_routed?.(session.id, this);
  }

  /** 返回来源分区内唯一的 Session 运行时缓存键。 */
  private session_cache_key(session_id: string, origin_type: string): string {
    return `${origin_type}\u0000${session_id}`;
  }

  private load_instruction_system_blocks(workspace_path: string): AgentSessionSystemBlock[] {
    return create_instruction_system_blocks(
      this.get_instruction(),
      workspace_path,
    );
  }

}
