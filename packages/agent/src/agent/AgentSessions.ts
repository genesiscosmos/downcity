/**
 * AgentSessions：本地 Agent session 集合入口。
 *
 * 关键点（中文）
 * - 统一管理 session 缓存、创建、恢复、默认配置注入与列表查询。
 * - 该服务只负责 Session 生命周期与查询，不负责 Power / RPC 启停。
 * - Session 对象创建细节集中在这里，避免 facade 和 lifecycle 重复依赖 Session 构造逻辑。
 */

import { allocate_session_id, normalize_session_id } from "@/session/SessionIdentity.js";
import type { ModelClient, AgentTool as Tool } from "@downcity/type";
import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
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
import type { SessionRemovalEvent } from "@/types/agent/SessionRemoval.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import { create_instruction_system_blocks } from "@/agent/AgentInstructions.js";
import { DefaultSessionComposer } from "@/session/input/composer/DefaultSessionComposer.js";
import type { ToolHookSet } from "@downcity/type";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import { normalize_session_origin, normalize_session_origin_type, SESSION_ORIGIN_TYPE_WORK } from "@downcity/type";
import type { SessionContextResolution } from "@/types/agent/SessionContext.js";
import { create_agent_session_origin, resolve_agent_session_id } from "@/agent/AgentSessionIdentity.js";

type AgentSessionsOptions = {
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /**
   * 当前 agent 用户可见名称；实时读取，使 `reconfigure` 后的新建 Session 立即使用新身份。
   */
  get_agent_name: () => string;

  /**
   * 当前 agent 一句话能力描述；实时读取，进入工具与扩展的调用环境。
   */
  get_agent_description: () => string;

  /**
   * 按 Session 解析执行上下文。
   *
   * AgentSessions 是 Agent 唯一的 Session 集合；Workspace 与工具集合不能
   * 固定在集合实例上，而应在创建或恢复单个 Session 时按会话身份解析。
   */
  resolve_session_context: (input?: SessionContextResolution) => {
    /** Agent 拥有的可靠完成事件写前端口。 */
    completions?: SessionCompletionPort;
    workspace_path: string;
    workspace_id?: string;
    logger: Logger;
    get_tools: () => Record<string, Tool>;
    get_workspace: () => WorkspaceRuntime | undefined;
    get_hooks: () => ToolHookSet;
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
   * 当前 agent 使用的本地 Session 类。
   */
  session_class?: AgentSessionConstructor;

  /** 当前 Agent 使用的 Session Composer；其所有 Session 共享该实例。 */
  session_composer?: SessionComposer;

  /** 读取 Agent 当前持有的运行时模型实例。 */
  get_agent_model: () => ModelClient | undefined;
};

/**
 * 本地 Agent session 管理服务。
 */
export class AgentSessions implements AgentSessionsContract<AgentSession> {
  private readonly agent_id: string;
  private readonly get_agent_name: AgentSessionsOptions["get_agent_name"];
  private readonly get_agent_description: AgentSessionsOptions["get_agent_description"];
  private readonly resolve_session_context: AgentSessionsOptions["resolve_session_context"];
  private readonly logger: Logger;
  private readonly get_instruction: AgentSessionsOptions["get_instruction"];
  private readonly session_class: AgentSessionConstructor;
  private readonly session_composer: SessionComposer;
  private readonly get_agent_model: AgentSessionsOptions["get_agent_model"];
  private readonly sessions_by_id = new Map<string, AgentManagedSession>();
  /** 新会话初始化后的宿主订阅；恢复已有会话时不触发。 */
  private readonly creation_listeners = new Set<(session: AgentSession) => void | Promise<void>>();
  /** 会话成功离开活动集合后的宿主订阅。 */
  private readonly removal_listeners = new Set<(event: SessionRemovalEvent) => void | Promise<void>>();
  /** Agent 会话创建链；并发调用共享同一创建过程，避免产生第二条。 */
  private agent_session_creation_chain: Promise<void> = Promise.resolve();

  constructor(options: AgentSessionsOptions) {
    this.agent_id = options.agent_id;
    this.get_agent_name = options.get_agent_name;
    this.get_agent_description = options.get_agent_description;
    this.resolve_session_context = options.resolve_session_context;
    this.logger = options.logger;
    this.get_instruction = options.get_instruction;
    this.session_class = options.session_class || Session;
    this.session_composer = options.session_composer ?? new DefaultSessionComposer();
    this.get_agent_model = options.get_agent_model;
  }

  /** 监听新会话；宿主可在任务启动前建立消息和运行态投影。 */
  on_created(listener: (session: AgentSession) => void | Promise<void>): () => void {
    this.creation_listeners.add(listener);
    return () => { this.creation_listeners.delete(listener); };
  }

  /** 监听成功归档或删除；取消函数释放宿主订阅。 */
  on_removed(listener: (event: SessionRemovalEvent) => void | Promise<void>): () => void {
    this.removal_listeners.add(listener);
    return () => { this.removal_listeners.delete(listener); };
  }

  /** 数据提交后通知宿主；投影失败不改变已成功的领域操作。 */
  private async notify_removed(event: SessionRemovalEvent): Promise<void> {
    await Promise.all([...this.removal_listeners].map(async (listener) => {
      try {
        await listener(event);
      } catch (error) {
        this.logger.error("Session removal listener failed", { ...event, error: String(error) });
      }
    }));
  }

  /** 通知宿主；投影失败不能把已经持久化的会话创建判为失败。 */
  private async notify_created(session: AgentSession): Promise<void> {
    await Promise.all([...this.creation_listeners].map(async (listener) => {
      try {
        await listener(session);
      } catch (error) {
        this.logger.error("Session creation listener failed", {
          session_id: session.id,
          error: String(error),
        });
      }
    }));
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
   * 获取已缓存 Session 的 runtime port。
   *
   * runtime 是执行层的内部投影，不负责创建 Session。需要创建时必须
   * 通过 `create()` 获取内部生成的 ID；需要恢复时必须先调用 `get()`。
   */
  runtime(session_id: string, origin_type = SESSION_ORIGIN_TYPE_WORK): SessionPort {
    const resolved_session_id = normalize_session_id(session_id);
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
   * 取用 Agent 自己那条会话；不存在时创建。
   *
   * 关键点（中文）
   * - 身份就是 `origin.type = "agent"`，`session_id` 就是 Agent 的 `id`：
   *   因此不新增索引，也不维护额外状态。
   * - 同一进程内并发调用会收敛到同一个创建过程，不会产生第二条。
   * - 被归档或删除后，下一次调用自然重建一条。
   * - Workspace 仅用于首次创建；已有会话的目录实例由宿主通过 get/set 明确恢复。
   */
  async self(input?: { workspace?: WorkspaceRuntime }): Promise<AgentSession> {
    const existing = await this.find_agent_session();
    if (existing) return existing;
    return await this.run_agent_session_creation(async () => {
      const cached = await this.find_agent_session();
      if (cached) return cached;
      const origin = create_agent_session_origin();
      const context = this.resolve_session_context({
        origin,
        creating: true,
        ...(input?.workspace ? { workspace: input.workspace } : {}),
      });
      const session_id = resolve_agent_session_id(this.agent_id);
      const session = this.get_or_create_session({
        session_id,
        origin,
        ...(input?.workspace ? { workspace: input.workspace } : {}),
        storage: context.store.create_session(session_id, origin, context.workspace_id),
      });
      await session.initialize();
      await this.notify_created(session);
      return session;
    });
  }

  /**
   * 尝试恢复已存在的 Agent 会话；不存在或已失效时返回空。
   *
   * 关键点（中文）：查找不切换目录，宿主负责注入恢复后的 Workspace 实例。
   */
  private async find_agent_session(): Promise<AgentSession | undefined> {
    const origin = create_agent_session_origin();
    const context = this.resolve_session_context({ origin });
    const session_id = resolve_agent_session_id(this.agent_id);
    try {
      if (!(await context.store.has_session(session_id, origin.type))) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return await this.get(session_id, origin.type);
  }

  /** 串行化 Agent 会话创建；失败时释放链，使下一次调用可以重试。 */
  private async run_agent_session_creation(
    create: () => Promise<AgentSession>,
  ): Promise<AgentSession> {
    const previous = this.agent_session_creation_chain;
    const operation = previous.then(create, create);
    this.agent_session_creation_chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return await operation;
  }

  /**
   * 新建一个 session。
   */
  async create(
    input?: AgentCreateSessionInput & { workspace?: WorkspaceRuntime },
  ): Promise<AgentSession> {
    const origin = normalize_session_origin(input?.origin);
    const session_id = await this.allocate_session_id(origin);
    return await this.create_with_id(session_id, origin, input?.workspace);
  }

  /**
   * 委派运行时专用的幂等工作会话入口。
   * 标识由已持久化的委派记录预分配；普通 SDK create 仍由集合生成标识。
   */
  async ensure_work_session(session_id: string, workspace: WorkspaceRuntime): Promise<AgentSession> {
    const origin = { type: SESSION_ORIGIN_TYPE_WORK };
    const context = this.resolve_session_context({ origin, workspace });
    if (await context.store.has_session(session_id, origin.type)) {
      return await this.get(session_id, origin.type, { workspace });
    }
    return await this.create_with_id(session_id, origin, workspace);
  }

  /** 创建入口共享装配过程；固定标识只供已持久化委派使用。 */
  private async create_with_id(
    session_id: string,
    origin: SessionOrigin,
    workspace?: WorkspaceRuntime,
  ): Promise<AgentSession> {
    const context = this.resolve_session_context({
      origin,
      creating: true,
      ...(workspace ? { workspace } : {}),
    });
    const session = this.get_or_create_session({
      session_id,
      workspace,
      origin,
      storage: context.store.create_session(
        session_id,
        origin,
        context.workspace_id,
      ),
    });
    await session.initialize();
    await this.notify_created(session);
    return session;
  }

  /**
   * 获取一个已存在的 session。
   *
   * 关键点（中文）
   * - 当前目录不是 Session 身份：传入的 Workspace 与持久化值不一致时不再报错，
   *   而是以传入值为准成为该 Session 的新当前目录。
   * - 省略 Workspace 时沿用持久化值；两者都为空时该 Session 没有项目上下文。
   */
  async get(
    session_id: string,
    origin_type = SESSION_ORIGIN_TYPE_WORK,
    input?: { workspace?: WorkspaceRuntime },
  ): Promise<AgentSession> {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("sessions.get requires a non-empty session_id");
    }
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin_type);
    const context = this.resolve_session_context({
      origin: { type: resolved_origin_type },
      ...(input?.workspace ? { workspace: input.workspace } : {}),
    });
    const store = context.store;
    if (
      !this.sessions_by_id.has(cache_key) &&
      !(await store.has_session(resolved_session_id, resolved_origin_type))
    ) {
      throw new Error(
        `Session "${resolved_session_id}" not found in origin "${resolved_origin_type}"`,
      );
    }
    const storage = await store.open_session(resolved_session_id, resolved_origin_type);
    const persisted_metadata = await storage.read_metadata();
    const persisted_workspace_id = String(persisted_metadata.workspace_id || "").trim() || undefined;
    const requested_workspace_id = String(input?.workspace?.id || "").trim() || undefined;
    // 目录不是身份，也不在 Session 侧还原：
    // - 宿主传了实例 → 用它；
    // - 本进程有缓存 → 沿用内存实例；
    // - 都没有 → 该会话没有项目上下文，但仍可正常读历史与对话。
    const session = this.get_or_create_session({
      session_id: resolved_session_id,
      ...(input?.workspace ? { workspace: input.workspace } : {}),
      origin: persisted_metadata.origin,
      storage,
    });
    await session.initialize();
    if (input?.workspace && (
      requested_workspace_id !== persisted_workspace_id
      || session.get("workspace") !== input.workspace
    )) {
      // 持久化 ID 相同不代表缓存实例已经恢复目录；宿主注入也必须更新执行资源。
      await session.set({ workspace: input.workspace }, { persist_action: false });
    }
    return session;
  }

  /**
   * 永久删除一个 Session 及其全部 Agent 领域数据。
   *
   * 关键点（中文）
   * - 正在执行的 Session 会先停止，避免删除后继续写入。
   * - 该方法不处理任何 Power 自有数据。
   */
  async remove(session_id: string, origin_type = SESSION_ORIGIN_TYPE_WORK): Promise<boolean> {
    const resolved_session_id = normalize_session_id(session_id);
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
    if (existed) await this.notify_removed({
      type: "deleted", session_id: resolved_session_id,
      origin_type: resolved_origin_type, workspace_id: cached?.workspace_id,
    });
    return existed;
  }

  /**
   * 清空一个 Session 的消息目录。
   */
  async clear_messages(session_id: string, origin_type = SESSION_ORIGIN_TYPE_WORK): Promise<boolean> {
    const resolved_session_id = normalize_session_id(session_id);
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
    const origin_type = normalize_session_origin_type(input?.origin_type ?? SESSION_ORIGIN_TYPE_WORK);
    return await this.resolve_session_context({ origin: { type: origin_type } }).store.list_sessions(
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
    const session_id = normalize_session_id(input?.id || "");
    if (!session_id) {
      throw new Error("sessions.archive requires a non-empty id");
    }
    const origin_type = normalize_session_origin_type(input.origin_type ?? SESSION_ORIGIN_TYPE_WORK);
    const cache_key = this.session_cache_key(session_id, origin_type);

    const cached = this.sessions_by_id.get(cache_key);
    cached?.begin_archive();
    try {
      const result = await this.resolve_session_context().store.archive_session(session_id, origin_type);
      cached?.finish_archive(true);
      cached?.dispose_title_generation?.();
      this.sessions_by_id.delete(cache_key);
      await this.notify_removed({
        type: "archived", session_id, origin_type, workspace_id: cached?.workspace_id,
      });
      return result;
    } catch (error) {
      cached?.finish_archive(false);
      throw error;
    }
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
   * 删除：把 Session 重新绑定到另一个 Workspace。
   *
   * 删除理由：它表达的是「Workspace 是 Session 绑定」这个旧模型。目录切换改由
   * `session.set({ workspace })` 承担，恢复时不再校验归属，因此不需要第二条路径。
   */

  private get_or_create_session(input?: {
    /**
     * 可选指定 session id。
     */
    session_id?: string;
    /** 当前 Session 可选使用的 Workspace。 */
    workspace?: WorkspaceRuntime;
    /** 当前 Session 的创建来源。 */
    origin?: SessionOrigin;
    /** 已由集合层创建或打开的单 Session Storage。 */
    storage?: SessionStorage;
  }): AgentManagedSession {
    const resolved_session_id = normalize_session_id(
      input?.session_id || input?.storage?.session_id || "",
    );
    if (!resolved_session_id) throw new Error("Session creation requires an allocated ID");
    const resolved_origin = normalize_session_origin(input?.origin);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin.type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached) return cached;

    const context = this.resolve_session_context({
      ...(input?.origin ? { origin: input.origin } : {}),
      creating: true,
      ...(input?.workspace ? { workspace: input.workspace } : {}),
    });
    const created = new this.session_class({
      agent_id: this.agent_id,
      agent_name: this.get_agent_name(),
      agent_description: this.get_agent_description(),
      workspace_path: context.workspace_path,
      ...(context.get_workspace() ? { workspace: context.get_workspace() } : {}),
      origin: resolved_origin,
      store: input?.storage || context.store.create_session(resolved_session_id, resolved_origin, context.workspace_id),
      create_session_store: (session_id) => context.store.create_session(session_id, resolved_origin, context.workspace_id),
      allocate_session_id: () => this.allocate_session_id(resolved_origin),
      register_forked_session: (session) => this.register_forked_session(session),
      session_id: resolved_session_id,
      get_tools: () => context.get_tools(),
      logger: context.logger,
      instruction_system_blocks: this.load_instruction_system_blocks(),
      get_instruction_system_blocks: () => this.load_instruction_system_blocks(),
      get_workspace: () => context.get_workspace(),
      get_agent_model: () => this.get_agent_model(),
      get_hooks: () => context.get_hooks(),
      completions: context.completions,
      archive_session: async (session_id) => await this.archive({ id: session_id, origin_type: resolved_origin.type }),
      composer: this.session_composer,
    });
    this.sessions_by_id.set(cache_key, created);
    return created;
  }

  /**
   * 释放一个空闲 Session 的运行时实例。
   *
   * 关键点（中文）
   * - 只释放内存实例；消息与元数据都在 Store 中，下次 `get()` 会重新恢复。
   * - 正在执行的 Session 不释放：执行上下文与取消信号都在实例上，丢掉会让 Turn 失去归属。
   * - 返回是否真的释放。调用方必须先自行解除对该实例的订阅，否则重新 `get()` 会拿到新实例
   *   而旧订阅仍然挂在被丢弃的实例上。
   */
  release(session_id: string, origin_type = SESSION_ORIGIN_TYPE_WORK): boolean {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) return false;
    const cache_key = this.session_cache_key(
      resolved_session_id,
      normalize_session_origin_type(origin_type),
    );
    const cached = this.sessions_by_id.get(cache_key);
    if (!cached || cached.is_executing()) return false;
    cached.dispose_title_generation?.();
    this.sessions_by_id.delete(cache_key);
    return true;
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
  }

  /** 返回来源分区内唯一的 Session 运行时缓存键。 */
  private session_cache_key(session_id: string, origin_type: string): string {
    return `${origin_type}\u0000${normalize_session_id(session_id)}`;
  }

  /** 检查持久化与进程内预留标识，避免并发创建复用尚未初始化的 ID。 */
  private readonly reserved_session_ids = new Set<string>();

  /** 为新建和 fork 统一分配 ID；已分配的标识在进程生命周期内不复用。 */
  private async allocate_session_id(origin: SessionOrigin): Promise<string> {
    const store = this.resolve_session_context({ origin }).store;
    return await allocate_session_id(async (session_id) => {
      const key = this.session_cache_key(session_id, origin.type);
      if (this.reserved_session_ids.has(key)) return true;
      this.reserved_session_ids.add(key);
      if (await store.has_session(session_id, origin.type)) return true;
      return false;
    });
  }

  private load_instruction_system_blocks(): AgentSessionSystemBlock[] {
    return create_instruction_system_blocks({
      agent_id: this.agent_id,
      agent_name: this.get_agent_name(),
      instruction: this.get_instruction(),
    });
  }

}
