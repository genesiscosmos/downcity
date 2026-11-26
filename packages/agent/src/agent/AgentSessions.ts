/**
 * AgentSessions：本地 Agent session 集合入口。
 *
 * 关键点（中文）
 * - 统一管理 session 缓存、创建、恢复、默认配置注入与列表查询。
 * - 该服务只负责 Session 生命周期与查询，不负责 Power / RPC 启停。
 * - Session 对象创建细节集中在这里，避免 facade 和 lifecycle 重复依赖 Session 构造逻辑。
 */

import type { Agent } from "@/agent/Agent.js";
import { read_result_session } from "@/session/storage/ReadResultSession.js";
import { SessionLifecycle } from "./SessionLifecycle.js";
import { archive_session_subtree } from "./SessionArchive.js";
import { read_session_execution } from "./SessionExecutionRead.js";
import { SessionExecutionProfiles } from "./SessionExecutionProfiles.js";
import type { ResolvedSessionExecutionProfile, SessionExecutionProfile, SessionExecutionProfileSelection } from "@/types/agent/SessionExecutionProfile.js";
import { allocate_session_id, normalize_session_id } from "@/session/SessionIdentity.js";
import type { AgentTool as Tool, ToolHookSet, WorkspaceRuntime, SessionDescriptor } from "@downcity/type";
import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { AgentCreateSessionInput, AgentArchiveSessionInput, AgentArchiveSessionsInput, AgentArchiveSessionResult, AgentArchiveSessionsResult, AgentCleanArchiveResult, AgentListSessionsInput, AgentSessionSummaryPage, AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { AgentSessionConstructor } from "@/types/agent/AgentOptions.js";
import type { AgentSession, AgentSessions as AgentSessionsContract } from "@/types/agent/SessionActor.js";
import { isDeepStrictEqual } from "node:util";
import type { SessionChildWork } from "@/types/session/SessionChildWork.js";
import type { AgentManagedSession } from "@/types/session/SessionOptions.js";
import { Session } from "@/session/Session.js";
import type { SessionRemovalEvent } from "@/types/agent/SessionRemoval.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import { create_instruction_system_blocks } from "@/agent/AgentInstructions.js";
import { DefaultSessionComposer } from "@/session/input/composer/DefaultSessionComposer.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import { normalize_session_descriptor, normalize_session_type, SESSION_TYPE_WORK, SESSION_KIND_WORK } from "@downcity/type";
import type { SessionContextResolution } from "@/types/agent/SessionContext.js";
import { create_main_session_descriptor } from "@/agent/AgentSessionIdentity.js";

type AgentSessionsOptions = {
  /** 宿主完整 Turn 租约；回调只在执行入口触发。 */
  acquire_execution?: () => () => void;
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /**
   * 当前 agent 用户可见名称；实时读取，使 `reconfigure` 后的新建 Session 立即使用新身份。
   */
  get_agent_name: () => string;
  /** 延迟读取 Agent 可选身份与角色列表。 */
  get_agent_role?: () => string[] | undefined;

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
    /** 只保留写前结果、不向普通业务回调投递的专用端口。 */
    result_completions?: SessionCompletionPort;
    /** 子 Turn 的等待与失败取消端口。 */
    child_work?: SessionChildWork;
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

  /** 所属 Agent 的模型定义；集合只把同一只读引用传给 Session。 */
  agent: Pick<Agent, "model">;

  /** 缓存实例时立即装配 Agent 级观察；返回的订阅在释放实例时一并解除。 */
  observe_session?: (session: AgentManagedSession) => () => void;
};

/**
 * 本地 Agent session 管理服务。
 */
export class AgentSessions implements AgentSessionsContract<AgentSession> {
  private readonly agent_id: string;
  private readonly get_agent_name: AgentSessionsOptions["get_agent_name"];
  private readonly get_agent_role: AgentSessionsOptions["get_agent_role"];
  private readonly get_agent_description: AgentSessionsOptions["get_agent_description"];
  private readonly resolve_session_context: AgentSessionsOptions["resolve_session_context"];
  private readonly logger: Logger;
  private readonly get_instruction: AgentSessionsOptions["get_instruction"];
  private session_class: AgentSessionConstructor;
  private behavior_revision = 0;
  private readonly acquire_execution?: () => () => void;
  private session_composer: SessionComposer;
  private readonly agent: AgentSessionsOptions["agent"];
  private readonly sessions_by_id = new Map<string, AgentManagedSession>();
  /** Session 实例观察器的生命周期跟随缓存，不另存交互状态。 */
  private readonly session_observers = new Map<string, () => void>();
  /** Agent 注入的集合观察装配入口；包含恢复实例和 fork。 */
  private readonly observe_session?: AgentSessionsOptions["observe_session"];
  /** 可信宿主配置及同键创建互斥；业务模型不能注册资源。 */
  private readonly execution_profiles = new SessionExecutionProfiles();
  private readonly execution_creations = new Map<string, Promise<AgentSession>>();
  /** 扫描保护集合关系，搬迁只预留待归档子树；恢复按会话身份独立保护。 */
  private readonly lifecycle = new SessionLifecycle();
  /** 当前活动目录元数据变化；只提供事实失效信号。 */
  private readonly directory_listeners = new Set<() => void>();

  /** 订阅标题等目录变化，不复制 Session 状态。 */
  on_directory_changed(listener: () => void): () => void {
    this.directory_listeners.add(listener);
    return () => { this.directory_listeners.delete(listener); };
  }

  /** 新会话初始化后的宿主订阅；恢复已有会话时不触发。 */
  private readonly creation_listeners = new Set<(session: AgentSession) => void | Promise<void>>();
  /** 会话成功离开活动集合后的宿主订阅。 */
  private readonly removal_listeners = new Set<(event: SessionRemovalEvent) => void | Promise<void>>();
  /** 宿主附属资源随缓存实例释放，不能据此绕过归档或 busy 检查。 */
  private readonly release_listeners = new Set<(session: AgentSession) => void>();

  /** 监听实例卸载与最终关闭；取消函数解除订阅。 */
  on_released(listener: (session: AgentSession) => void): () => void {
    this.release_listeners.add(listener);
    return () => { this.release_listeners.delete(listener); };
  }

  /** Agent 会话创建链；并发调用共享同一创建过程，避免产生第二条。 */
  private agent_session_creation_chain: Promise<void> = Promise.resolve();

  constructor(options: AgentSessionsOptions) {
    this.agent_id = options.agent_id;
    this.get_agent_name = options.get_agent_name;
    this.get_agent_role = options.get_agent_role;
    this.get_agent_description = options.get_agent_description;
    this.resolve_session_context = options.resolve_session_context;
    this.logger = options.logger;
    this.get_instruction = options.get_instruction;
    this.session_class = options.session_class || Session;
    this.session_composer = options.session_composer ?? new DefaultSessionComposer();
    this.agent = options.agent;
    this.acquire_execution = options.acquire_execution;
    this.observe_session = options.observe_session;
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

  /** 替换行为必须空闲；旧句柄失效但历史与 Session 身份不变，下次访问按新类恢复。 */
  reconfigure_behavior(session_class?: AgentSessionConstructor, composer?: SessionComposer): void {
    const unlock = this.guard_idle();
    try {
      this.behavior_revision++;
      this.session_class = session_class ?? Session;
      this.session_composer = composer ?? new DefaultSessionComposer();
      for (const [key, session] of this.sessions_by_id) {
        session.dispose_title_generation?.();
        session.clear_secrets();
        this.delete_cached_session(key);
      }
    } finally { unlock(); }
  }

  /**
   * 返回当前缓存的 session 实例。
   */
  list_cached_sessions(): AgentManagedSession[] {
    return [...this.sessions_by_id.values()];
  }

  /** 宿主资源释放期间关闭新建/恢复入口，键 * 表示整个 Agent。 */
  private readonly resource_guards = new Map<string, number>();

  /** 同步关闭已有空闲节点的输入；任一忙碌立即拒绝，释放函数恢复尚存活节点。 */
  guard_idle(workspace_id?: string): () => void {
    const key = workspace_id ?? "*";
    this.resource_guards.set(key, (this.resource_guards.get(key) ?? 0) + 1);
    const unlock = () => {
      const count = (this.resource_guards.get(key) ?? 1) - 1;
      if (count > 0) this.resource_guards.set(key, count); else this.resource_guards.delete(key);
    };
    const guarded: AgentManagedSession[] = [];
    try {
      for (const session of this.sessions_by_id.values()) {
        if (workspace_id && session.workspace_id !== workspace_id) continue;
        session.begin_archive();
        guarded.push(session);
      }
    } catch (error) {
      for (const session of guarded) session.finish_archive(false);
      unlock();
      throw error;
    }
    let released = false;
    return () => { if (released) return; released = true; for (const session of guarded) session.finish_archive(false); unlock(); };
  }

  /** 释放门禁同时覆盖未缓存 Session 的并发创建/恢复。 */
  private assert_resource_available(workspace_id?: string): void {
    if (this.resource_guards.has("*") || (workspace_id && this.resource_guards.has(workspace_id))) throw Object.assign(new Error("Session resource is being released"), { code: "session_busy" });
  }

  /** 观察已有内存实例；不打开存储、不恢复 Workspace 或 executor。 */
  peek(session_id: string, type = SESSION_TYPE_WORK): AgentSession | undefined {
    return this.sessions_by_id.get(this.session_cache_key(session_id, type));
  }

  /** 返回当前所有执行中的 Session 标识；可按 Workspace 与来源分类限定。 */
  list_executing_session_ids(workspace_id?: string, type?: string): string[] {
    const resolved_category = type
      ? normalize_session_type(type)
      : undefined;
    return this.list_cached_sessions()
      .filter((session) =>
        session.is_executing()
        && (!workspace_id || session.workspace_id === workspace_id)
        && (!resolved_category || session.type === resolved_category)
      )
      .map((session) => session.id);
  }

  /** 集合是否仍拥有需保护的执行；包含交互等待和尚未完成的收尾。 */
  has_live_execution(workspace_id?: string): boolean {
    return this.list_cached_sessions().some(session => session.has_live_execution()
      && (!workspace_id || session.workspace_id === workspace_id));
  }

  /** 返回当前执行中的 Session 数量。 */
  get_executing_session_count(): number {
    return this.list_executing_session_ids().length;
  }

  /** 停止当前集合内正在执行的 Session；可按 Workspace 限定。 */
  async stop_executing_sessions(workspace_id?: string): Promise<void> {
    const executing_sessions = this.list_cached_sessions().filter((session) =>
      session.has_live_execution()
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
  runtime(session_id: string, type = SESSION_TYPE_WORK): SessionPort {
    const resolved_session_id = normalize_session_id(session_id);
    const resolved_category = normalize_session_type(type);
    const session = this.sessions_by_id.get(
      this.session_cache_key(resolved_session_id, resolved_category),
    );
    if (!session) {
      throw new Error(
        `Session "${resolved_session_id}" is not loaded from type "${resolved_category}"; call sessions.get(session_id, type) first`,
      );
    }
    return session.get_runtime_port();
  }

  /**
   * 取用 Agent 自己那条会话；不存在时创建。
   *
   * 关键点（中文）
   * - 当前会话由持久 main_session_id 指针选择，永久 UUID 与 Agent ID 独立。
   * - 空指针通过显式 ensure_main 事务创建；读取不会推断或建立会话。
   * - 同一进程内并发调用会收敛到同一个创建过程，不会产生第二条。
   * - 被归档或删除后，下一次调用自然重建一条。
   * - Workspace 仅用于首次创建；已有会话的资源由宿主通过 get 注入同 ID Workspace 恢复。
   */
  async self(input?: { workspace?: WorkspaceRuntime }): Promise<AgentSession> {
    const current = await this.resolve_session_context().store.read_main();
    const key = current ? this.session_cache_key(current.session_id, "chat") : "main-pointer";
    return await this.lifecycle.access(() => this.open_self(input), [key]);
  }

  /** 生命周期保护内恢复或创建 Agent 主会话。 */
  private async open_self(input?: { /** 首次创建使用的 Workspace 实例。 */ workspace?: WorkspaceRuntime }): Promise<AgentSession> {
    const existing = await this.find_agent_session();
    if (existing) return existing;
    return await this.run_agent_session_creation(async () => {
      const cached = await this.find_agent_session();
      if (cached) return cached;
      const descriptor = create_main_session_descriptor();
      const context = this.resolve_session_context({
        ...normalize_session_descriptor(descriptor),
        creating: true,
        ...(input?.workspace ? { workspace: input.workspace } : {}),
      });
      const storage = await context.store.ensure_main(context.workspace_id);
      const session_id = storage.session_id;
      const metadata = await storage.read_metadata();
      const workspace = context.get_workspace();
      if (workspace && workspace.id !== metadata.workspace_id) throw new Error("session_workspace_immutable");
      const session = this.get_or_create_session({ session_id, ...normalize_session_descriptor(descriptor), workspace, workspace_id: metadata.workspace_id, inherit_workspace: false, storage });
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
    const descriptor = create_main_session_descriptor();
    const context = this.resolve_session_context({ ...normalize_session_descriptor(descriptor) });
    const current = await context.store.read_main();
    return current ? await this.get(current.session_id, descriptor.type) : undefined;
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
    input?: AgentCreateSessionInput & { workspace?: WorkspaceRuntime; /** 显式关闭默认 Workspace 继承。 */ inherit_workspace?: boolean },
  ): Promise<AgentSession> {
    const descriptor = normalize_session_descriptor(input);
    return await this.lifecycle.access(async () => {
      const session_id = await this.allocate_session_id(descriptor);
      return await this.create_with_id(session_id, descriptor, input?.workspace, input?.inherit_workspace, input?.title);
    }, this.session_parent_keys(descriptor));
  }

  /** 注册宿主可信配置；撤销后缓存会话也不得继续执行。 */
  register_execution_profile(profile: SessionExecutionProfile): () => void {
    return this.execution_profiles.register(profile);
  }

  /** 受约束会话按业务创建键定位；只替换 profile 明确提供的能力，不继承默认 Workspace。 */
  async create_execution_session(input: SessionExecutionProfileSelection & SessionDescriptor & {

    /** 可选范围元数据；注入运行资源时必须与 Workspace 身份相同。 */
    workspace_id?: string;
    /** 显式注入项目资源，不从 Agent 或父会话继承。 */
    workspace?: WorkspaceRuntime;
  }): Promise<AgentSession> {
    const descriptor = normalize_session_descriptor(input);
    if (input.workspace && input.workspace.id !== input.workspace_id) throw new Error("session_workspace_immutable");
    const creation_key = input.creation_key?.trim();
    if (input.creation_key !== undefined && (!creation_key || creation_key.length > 512)) throw new Error("execution_creation_key_invalid");
    const candidate_id = await this.allocate_session_id(descriptor);
    const key = creation_key ? `creation:${descriptor.type}:${creation_key}` : this.session_cache_key(candidate_id, descriptor.type);
    const pending = this.execution_creations.get(key);
    if (pending) {
      await pending;
      return await this.create_execution_session(input);
    }
    const operation = this.lifecycle.access(async () => {
      const context = this.resolve_session_context({ ...normalize_session_descriptor(descriptor) });
      await this.assert_parent_available(descriptor, context.store);
      const storage = creation_key
        ? await context.store.ensure_creation(creation_key, descriptor, input.workspace_id)
        : context.store.create_session(candidate_id, descriptor, input.workspace_id);
      const session_id = storage.session_id;
      return await this.lifecycle.read(this.session_cache_key(session_id, descriptor.type), async () => {
        const metadata = await storage.read_metadata();
        if (!isDeepStrictEqual(normalize_session_descriptor(metadata), descriptor) || metadata.workspace_id !== input.workspace_id) throw new Error("execution_creation_conflict: descriptor or scope differs");
        const persisted = metadata.execution_profile;
        if (persisted && (persisted.id !== input.execution_profile_id || persisted.version !== input.execution_profile_version
          || persisted.creation_key !== creation_key)) throw new Error("execution_creation_conflict: profile or key differs");
        if (!persisted && await storage.message_count() > 0) throw new Error("execution_profile_missing: existing history has no profile");
        const execution_profile = await this.execution_profiles.resolve({ ...input, creation_key }, {
          agent_id: this.agent_id, session_id, ...normalize_session_descriptor(descriptor), workspace_id: input.workspace_id,
        }, persisted);
        await storage.bind_execution_profile(execution_profile.reference);
        const session = this.get_or_create_session({ session_id, ...normalize_session_descriptor(descriptor), storage, execution_profile, workspace: input.workspace, workspace_id: metadata.workspace_id, inherit_workspace: false });
        await session.initialize();
        if (!persisted) await this.notify_created(session);
        return session;
      });
    }, [key, ...this.session_parent_keys(descriptor)]);
    this.execution_creations.set(key, operation);
    try { return await operation; }
    finally { if (this.execution_creations.get(key) === operation) this.execution_creations.delete(key); }
  }

  /** 读取写前完成日志与真实运行状态；中断不伪装成模型成功。 */
  async read_execution_state(session_id: string, type: string, input: {
    /** 指定 Turn ID。 */
    turn_id?: string;
    /** 指定业务请求键。 */
    request_id?: string;
  }) {
    const storage = await this.read_session_storage(session_id, type);
    return await read_session_execution(storage, this.sessions_by_id.get(this.session_cache_key(session_id, type))?.has_live_execution() === true, input,
      this.resolve_session_context().completions);
  }

  /** 读取宿主存储端口；先经过精确配置恢复，避免读取路径意外装配全权限会话。 */
  async read_session_storage(session_id: string, type: string): Promise<SessionStorage> {
    await this.get(session_id, type);
    return await this.resolve_session_context().store.open_session(session_id, type);
  }

  /**
   * 委派运行时专用的幂等工作会话入口。
   * 标识由已持久化的委派记录预分配；普通 SDK create 仍由集合生成标识。
   *
   * 关键点（中文）：派发深度由调用方传入，写入子会话来源并随之持久化；
   * 已有会话沿用自己 persisted 的深度，不由本次调用覆盖。
   */
  async ensure_work_session(
    session_id: string,
    workspace: WorkspaceRuntime,
    delegation_depth?: number,
    child_descriptor?: SessionDescriptor,
  ): Promise<AgentSession> {
    const descriptor = child_descriptor ?? { type: SESSION_TYPE_WORK, kind: SESSION_KIND_WORK };
    return await this.lifecycle.access(() => this.open_work_session(session_id, workspace, delegation_depth, child_descriptor),
      [this.session_cache_key(session_id, descriptor.type), ...this.session_parent_keys(descriptor)]);
  }

  /** 生命周期保护内恢复幂等委派或创建会话。 */
  private async open_work_session(session_id: string, workspace: WorkspaceRuntime, delegation_depth?: number, child_descriptor?: SessionDescriptor): Promise<AgentSession> {
    const descriptor: SessionDescriptor = child_descriptor ?? {
      type: SESSION_TYPE_WORK,
      kind: SESSION_KIND_WORK,
      ...(delegation_depth === undefined ? {} : { delegation_depth }),
    };
    const context = this.resolve_session_context({ ...normalize_session_descriptor(descriptor), workspace });
    if (await context.store.has_session(session_id, descriptor.type)) {
      const session = await this.get(session_id, descriptor.type, { workspace });
      if (child_descriptor && !isDeepStrictEqual(normalize_session_descriptor(session), normalize_session_descriptor(child_descriptor))) {
        throw new Error("session_relation_invalid: persisted Work Session descriptor differs from creation record");
      }
      return session;
    }
    return await this.create_with_id(session_id, descriptor, workspace);
  }

  /** 创建入口共享装配过程；固定标识只供已持久化委派使用。 */
  private async create_with_id(
    session_id: string,
    descriptor: SessionDescriptor,
    workspace?: WorkspaceRuntime,
    inherit_workspace = true,
    title?: string,
  ): Promise<AgentSession> {
    const context = this.resolve_session_context({
      ...normalize_session_descriptor(descriptor),
      creating: inherit_workspace,
      ...(workspace ? { workspace } : {}),
    });
    await this.assert_parent_available(descriptor, context.store);
    const storage = context.store.create_session(session_id, descriptor, context.workspace_id, title);
    const session = this.get_or_create_session({ session_id, workspace, ...normalize_session_descriptor(descriptor), inherit_workspace, storage });
    await session.initialize();
    await this.notify_created(session);
    return session;
  }

  /**
   * 获取一个已存在的 session。
   *
   * 关键点（中文）
   * - 归属由创建时确定；传入资源必须匹配持久化 Workspace ID。
   * - 省略资源时保留原归属，仅恢复历史与配置，不继承 Agent 默认 Workspace。
   */
  async get(
    session_id: string,
    type?: string,
    input?: { /** 恢复既有工作区的运行资源。 */ workspace?: WorkspaceRuntime },
  ): Promise<AgentSession> {
    let resolved_type = type === undefined ? undefined : normalize_session_type(type);
    if (resolved_type === undefined) {
      const [entry] = await this.resolve_session_context().store.read_metadata([{ session_id }]);
      if (!entry || entry.archived) throw new Error("session_not_found");
      resolved_type = entry.metadata.type;
    }
    const session_type = resolved_type;
    return await this.lifecycle.read(this.session_cache_key(session_id, session_type),
      () => this.open_existing_session(session_id, session_type, input));
  }

  /** 生命周期保护内读取持久化信息并恢复 Session 句柄。 */
  private async open_existing_session(session_id: string, type: string, input?: { /** 恢复时注入的 Workspace 实例。 */ workspace?: WorkspaceRuntime }): Promise<AgentSession> {
    if (input && "workspace" in input && input.workspace === null) throw new Error("session_workspace_immutable");
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("sessions.get requires a non-empty session_id");
    }
    const resolved_category = normalize_session_type(type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_category);
    const cached = this.sessions_by_id.get(cache_key);
    const context = this.resolve_session_context({
      ...(input?.workspace ? { workspace: input.workspace } : {}),
    });
    const store = context.store;
    if (
      !this.sessions_by_id.has(cache_key) &&
      !(await store.has_session(resolved_session_id, resolved_category))
    ) {
      throw new Error(
        `Session "${resolved_session_id}" not found in type "${resolved_category}"`,
      );
    }
    const storage = await store.open_session(resolved_session_id, resolved_category);
    const persisted_metadata = await storage.read_metadata();
    const reference = persisted_metadata.execution_profile;
    const execution_profile = reference ? await this.execution_profiles.resolve({
      execution_profile_id: reference.id, execution_profile_version: reference.version,
      creation_key: reference.creation_key,
    }, { agent_id: this.agent_id, session_id: resolved_session_id, ...normalize_session_descriptor(persisted_metadata),
      workspace_id: persisted_metadata.workspace_id }, reference) : undefined;
    const persisted_workspace_id = persisted_metadata.workspace_id;
    if (input?.workspace && (!input.workspace.id || input.workspace.id !== persisted_workspace_id)) throw new Error("session_workspace_immutable");
    this.assert_resource_available(persisted_workspace_id);
    if (cached) {
      if (cached.workspace_id !== persisted_workspace_id) throw new Error("session_workspace_immutable");
      // 装配前检查工具冲突；失败时不改变缓存实例或存储。
      if (input?.workspace) cached.restore_workspace(input.workspace);
      await cached.initialize();
      return cached;
    }
    const session = this.get_or_create_session({
      session_id: resolved_session_id,
      workspace: input?.workspace,
      workspace_id: persisted_workspace_id,
      inherit_workspace: false,
      ...normalize_session_descriptor(persisted_metadata),
      storage,
      execution_profile,
    });
    await session.initialize();
    return session;
  }

  /**
   * 永久删除一个 Session 及其全部 Agent 领域数据。
   *
   * 关键点（中文）
   * - 正在执行的 Session 会先停止，避免删除后继续写入。
   * - 该方法不处理任何 Power 自有数据。
   */
  async remove(session_id: string, type = SESSION_TYPE_WORK): Promise<boolean> {
    return await this.lifecycle.access(() => this.remove_existing_session(session_id, type),
      [this.session_cache_key(session_id, normalize_session_type(type))]);
  }

  /** 生命周期保护内删除单个活动会话。 */
  private async remove_existing_session(session_id: string, type: string): Promise<boolean> {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("sessions.remove requires a non-empty session_id");
    }
    const resolved_category = normalize_session_type(type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_category);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.has_live_execution()) {
      await cached.stop();
    }
    cached?.dispose_title_generation?.();
    cached?.clear_secrets();
    const store = this.resolve_session_context().store;
    const existing_record = await store.has_session(resolved_session_id, resolved_category) ? await store.read_session(resolved_session_id, resolved_category) : undefined;
    const existed = await store.remove_session(
      resolved_session_id,
      resolved_category,
    );
    this.delete_cached_session(cache_key);
    if (existed) await this.notify_removed({
      action: "deleted", session_id: resolved_session_id,
      type: resolved_category, kind: existing_record?.metadata.kind ?? cached?.kind ?? SESSION_KIND_WORK,
      workspace_id: existing_record?.metadata.workspace_id ?? cached?.workspace_id,
    });
    return existed;
  }

  /**
   * 清空一个 Session 的消息目录。
   */
  async clear_messages(session_id: string, type = SESSION_TYPE_WORK): Promise<boolean> {
    return await this.lifecycle.access(() => this.clear_existing_messages(session_id, type),
      [this.session_cache_key(session_id, normalize_session_type(type))]);
  }

  /** 生命周期保护内清理消息，避免与归档搬迁同时进行。 */
  private async clear_existing_messages(session_id: string, type: string): Promise<boolean> {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("sessions.clear_messages requires a non-empty session_id");
    }
    const resolved_category = normalize_session_type(type);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_category);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached?.has_live_execution()) {
      throw new Error(`Session "${resolved_session_id}" is currently executing`);
    }
    cached?.dispose_title_generation?.();
    cached?.clear_secrets();
    const existed = await this.resolve_session_context().store.clear_session_messages(
      resolved_session_id,
      resolved_category,
    );
    this.delete_cached_session(cache_key);
    return existed;
  }

  /** 读取永久身份的活动历史，不恢复执行器或读取模型配置。 */
  async read(session_id: string, type = SESSION_TYPE_WORK) {
    return await this.resolve_session_context().store.read_session(session_id, type);
  }

  /** 只读当前主会话，不恢复执行器；显式 self() 才确保创建。 */
  async read_main() { return await this.resolve_session_context().store.read_main(); }

  /** 只读查询明确记录的小字段；不创建 Session 或恢复执行环境。 */
  async read_metadata(addresses: readonly import("@/types/agent/SessionMetadata.js").SessionMetadataAddress[]) {
    return await this.resolve_session_context().store.read_metadata(addresses);
  }

  /**
   * 列出当前 agent 的 session 摘要页。
   */
  async list(
    input?: AgentListSessionsInput,
  ): Promise<AgentSessionSummaryPage> {
    const type = normalize_session_type(input?.type ?? SESSION_TYPE_WORK);
    return await this.resolve_session_context().store.list_sessions(
      { ...(input || {}), type },
      new Set(this.list_executing_session_ids(undefined, type)),
    );
  }

  /**
   * 归档 Session 及同一 Agent 下的全部后代 Work Session。
   *
   * 完整读取目录后，先同步关闭所有已缓存节点的输入，再按子节点优先顺序归档。
   * 运行中或排队中的任一节点会使预检失败；存储失败时保留尚未归档的父节点，
   * 已成功归档的子节点不回滚，重试会从活动目录中剩余的节点继续。
   */
  async archive(
    input: AgentArchiveSessionInput,
  ): Promise<AgentArchiveSessionResult> {
    const removals: SessionRemovalEvent[] = [];
    try {
      return await this.lifecycle.archive(() => archive_session_subtree(input, {
        agent_id: this.agent_id,
        store: this.resolve_session_context().store,
        get_cached: (session_id, type) => this.sessions_by_id.get(this.session_cache_key(session_id, type)),
        remove_cached: (session_id, type) => this.delete_cached_session(this.session_cache_key(session_id, type)),
        reserve_sessions: (plan) => this.lifecycle.reserve_archive(plan.map((item) => this.session_cache_key(item.id, item.type!))),
        record_removal: (event) => { removals.push(event); },
      }));
    } finally {
      // 生命周期保护已释放；部分成功时也必须通知，宿主回调可安全读取其他会话。
      for (const event of removals) await this.notify_removed(event);
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

  /** 精确读取归档记录，只取得历史能力，不恢复执行或模型。 */
  async read_archived(session_id: string): Promise<import("@/types/store/SessionReadView.js").SessionReadView> {
    return await this.resolve_session_context().store.read_archived_session(session_id);
  }

  /** 永久删除一条归档记录，稳定身份避免误删重建后的活动主会话。 */
  async remove_archived(session_id: string): Promise<boolean> {
    const result = await this.lifecycle.clean_archive(() => this.resolve_session_context().store.remove_archived_session(session_id));
    this.notify_directory_changed();
    return result;
  }

  /**
   * 永久清空已归档 session。
   */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    const result = await this.lifecycle.clean_archive(() => this.resolve_session_context().store.clean_archive());
    this.notify_directory_changed();
    return result;
  }

  private get_or_create_session(input?: Partial<SessionDescriptor> & {
    /**
     * 可选指定 session id。
     */
    session_id?: string;
    /** 当前 Session 可选使用的 Workspace 执行资源。 */
    workspace?: WorkspaceRuntime;
    /** 恢复时的持久化归属；显式 undefined 表示创建时无归属。 */
    workspace_id?: string;

    /** 已由集合层创建或打开的单 Session Storage。 */
    storage?: SessionStorage;
    /** 是否允许新会话继承 Agent 默认目录。 */
    inherit_workspace?: boolean;
    /** 宿主精确解析的专用执行资源；禁止合并默认能力。 */
    execution_profile?: ResolvedSessionExecutionProfile;
  }): AgentManagedSession {
    const resolved_session_id = normalize_session_id(
      input?.session_id || input?.storage?.session_id || "",
    );
    if (!resolved_session_id) throw new Error("Session creation requires an allocated ID");
    const resolved_descriptor = normalize_session_descriptor(input);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_descriptor.type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached) return cached;
    const profile = input?.execution_profile;
    const assert_profile = () => { if (profile) this.execution_profiles.assert_registered(profile.reference); };
    const instruction_blocks = () => profile?.resources.instruction ? create_instruction_system_blocks({
      agent_id: this.agent_id, agent_name: this.get_agent_name(), role: this.get_agent_role?.(),
      description: this.get_agent_description(), instruction: profile.resources.instruction,
    }) : this.load_instruction_system_blocks();

    const context = this.resolve_session_context({
      ...(input ? { ...normalize_session_descriptor(input) } : {}),
      creating: !profile && input?.inherit_workspace !== false,
      ...(input?.workspace ? { workspace: input.workspace } : {}),
    });
    const workspace_id = input && Object.hasOwn(input, "workspace_id") ? input.workspace_id : context.workspace_id;
    this.assert_resource_available(workspace_id);
    const behavior_revision = this.behavior_revision;
    const created = new this.session_class({
      acquire_execution: () => {
        if (behavior_revision !== this.behavior_revision) throw new Error("Session behavior changed; restore this Session before executing");
        this.assert_resource_available(workspace_id);
        return this.acquire_execution?.() ?? (() => {});
      },
      read_result_session: (session_id, type) => read_result_session(context.store, session_id, type),
      ...(profile ? { assert_execution_profile: assert_profile } : {}),
      agent_id: this.agent_id,
      get_agent_name: this.get_agent_name,
      get_agent_role: this.get_agent_role,
      get_agent_description: this.get_agent_description,
      workspace_id,
      workspace_path: context.workspace_path,
      ...(context.get_workspace() ? { workspace: context.get_workspace() } : {}),
      ...normalize_session_descriptor(resolved_descriptor),
      store: input?.storage || context.store.create_session(resolved_session_id, resolved_descriptor, workspace_id),
      create_session_store: (session_id) => context.store.create_session(session_id, resolved_descriptor, workspace_id),
      allocate_session_id: () => this.allocate_session_id(resolved_descriptor),
      register_forked_session: (session) => this.register_forked_session(session),
      session_id: resolved_session_id,
      get_tools: (workspace) => {
        assert_profile();
        return profile?.resources.tools ?? this.resolve_session_context({ ...normalize_session_descriptor(resolved_descriptor), workspace }).get_tools();
      },
      logger: context.logger,
      instruction_system_blocks: instruction_blocks(),
      get_instruction_system_blocks: instruction_blocks,
      get_workspace: () => context.get_workspace(),
      agent: this.agent,
      get_hooks: () => { assert_profile(); return profile?.resources.hooks ?? context.get_hooks(); },
      completions: profile ? context.result_completions : context.completions,
      child_work: profile ? undefined : context.child_work,
      archive_session: async (session_id) => await this.archive({ id: session_id, type: resolved_descriptor.type }),
      composer: profile?.resources.composer ?? this.session_composer,
    });
    this.sessions_by_id.set(cache_key, created);
    this.attach_session_observer(cache_key, created);
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
  release(session_id: string, type = SESSION_TYPE_WORK): boolean {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) return false;
    const cache_key = this.session_cache_key(
      resolved_session_id,
      normalize_session_type(type),
    );
    if (this.lifecycle.is_busy(cache_key)) return false;
    const cached = this.sessions_by_id.get(cache_key);
    if (!cached || cached.has_live_execution()) return false;
    cached.dispose_title_generation?.();
    cached.clear_secrets();
    this.delete_cached_session(cache_key);
    return true;
  }

  /** 接管 fork 产生的 Session，确保后续读取与执行使用同一运行时实例。 */
  private register_forked_session(session: AgentManagedSession): void {
    if (session.agent_id !== this.agent_id) {
      throw new Error(`Cannot register Session "${session.id}" for another Agent`);
    }
    const cache_key = this.session_cache_key(session.id, session.type);
    const cached = this.sessions_by_id.get(cache_key);
    if (cached && cached !== session) {
      throw new Error(`Session "${session.id}" already has another runtime instance`);
    }
    this.sessions_by_id.set(cache_key, session);
    this.attach_session_observer(cache_key, session);
  }

  /** 在任何初始化或执行前建立观察；同一个缓存实例只订阅一次。 */
  private attach_session_observer(cache_key: string, session: AgentManagedSession): void {
    if (this.session_observers.has(cache_key)) return;
    const release_subject = this.observe_session?.(session);
    const release_directory = session.subscribe((mutation) => {
      if (mutation.variant !== "session" || mutation.type !== "title") return;
      this.notify_directory_changed();
    });
    this.session_observers.set(cache_key, () => { release_subject?.(); release_directory(); });
  }

  /** 标题和归档清空只发目录事实，不改变通知记录。 */
  private notify_directory_changed(): void {
    for (const listener of this.directory_listeners) {
      try { listener(); } catch (error) { this.logger.warn("Session directory observer failed", { error: String(error) }); }
    }
  }

  /** 移出实例时同步解除其观察，避免旧实例向新实例的集合发布变化。 */
  private delete_cached_session(cache_key: string): void {
    const session = this.sessions_by_id.get(cache_key);
    if (session) this.notify_released(session);
    this.session_observers.get(cache_key)?.();
    this.session_observers.delete(cache_key);
    this.sessions_by_id.delete(cache_key);
  }

  /** Agent 停止全部执行后释放所有实例订阅。 */
  dispose_session_observers(): void {
    for (const session of this.sessions_by_id.values()) this.notify_released(session);
    this.release_listeners.clear();
    for (const unsubscribe of this.session_observers.values()) unsubscribe();
    this.session_observers.clear();
  }

  /** 清理通知失败不能改变已经完成的卸载事实。 */
  private notify_released(session: AgentSession): void {
    for (const listener of this.release_listeners) {
      try { listener(session); } catch (error) { this.logger.warn("Session release observer failed", { error: String(error) }); }
    }
  }

  /** 返回来源分类内唯一的 Session 运行时缓存键。 */
  private session_cache_key(session_id: string, type: string): string {
    return `${type}\u0000${normalize_session_id(session_id)}`;
  }

  /** 新建节点必须连接仍在活动存储中的同 Agent 父节点。 */
  private async assert_parent_available(descriptor: SessionDescriptor, store: SessionStore): Promise<void> {
    const { parent, parent_session_type } = descriptor;
    if (parent?.agent_id === this.agent_id && parent_session_type !== undefined
      && !await store.has_session(parent.session_id, parent_session_type)) {
      throw new Error("session_parent_unavailable: parent Session is missing or archived");
    }
  }

  /** 创建期间同时保护同 Agent 的直接父节点，阻止归档计划确定后新增后代。 */
  private session_parent_keys(descriptor: SessionDescriptor): string[] {
    const { parent, parent_session_type } = descriptor;
    if (parent?.agent_id !== this.agent_id || parent_session_type === undefined) return [];
    return [this.session_cache_key(parent.session_id, parent_session_type)];
  }

  /** 检查持久化与进程内预留标识，避免并发创建复用尚未初始化的 ID。 */
  private readonly reserved_session_ids = new Set<string>();

  /** 为新建和 fork 统一分配 ID；已分配的标识在进程生命周期内不复用。 */
  private async allocate_session_id(descriptor: SessionDescriptor): Promise<string> {
    const store = this.resolve_session_context({ ...normalize_session_descriptor(descriptor) }).store;
    return await allocate_session_id(async (session_id) => {
      const key = this.session_cache_key(session_id, descriptor.type);
      if (this.reserved_session_ids.has(key)) return true;
      this.reserved_session_ids.add(key);
      if (await store.has_session(session_id, descriptor.type)) return true;
      return false;
    });
  }

  private load_instruction_system_blocks(): AgentSessionSystemBlock[] {
    return create_instruction_system_blocks({
      agent_id: this.agent_id,
      agent_name: this.get_agent_name(),
      role: this.get_agent_role?.(),
      description: this.get_agent_description(),
      instruction: this.get_instruction(),
    });
  }

}
