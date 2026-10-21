/**
 * Agent：身份、模型、指令与 Session 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；`workspace` 只是创建 Session 时的默认目录，可在会话中切换。
 * - 能力与 Transport 由容器持有，Agent 只收下容器在绑定时推送的能力，不持有容器引用。
 * - Session 由 AgentSessions 统一持有；Workspace 只在单个 Session 创建或恢复时提供。
 * - Agent 自己那条会话由 `session()` 暴露；它是一条普通 Session。
 */

import type {
  CityRuntime,
  ModelClient,
  AgentTool as Tool,
  StorageProvider,
  ToolCallContext,
  ToolHookSet,
  WorkspaceRuntime,
} from "@downcity/type";

import {
  create_instruction_system_blocks,
  normalize_instruction_input,
} from "@/agent/AgentInstructions.js";
import type {
  AgentOptions,
  AgentSessionConstructor,
} from "@/types/agent/AgentOptions.js";
import type { AgentReconfigureInput } from "@/types/agent/AgentReconfigureInput.js";
import type {
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { AgentMemoryStorageProvider } from "@/agent/AgentMemoryStorage.js";
import { LocalSessionStore } from "@/session/storage/LocalSessionStore.js";
import { EMPTY_TOOL_HOOK_SET, SESSION_HOOK_POINTS } from "@downcity/type";
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import { compile_session_callbacks } from "@/agent/SessionCallbacks.js";
import { SessionCompletions } from "@/agent/SessionCompletions.js";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import type { SessionSystemMessage } from "@downcity/type";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import {
  build_session_system_blocks,
  resolve_session_power_system_blocks,
} from "@/session/input/SessionSystem.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import { resolve_system_timezone } from "@/session/storage/Metadata.js";
import { SessionWork } from "@/agent/SessionWork.js";
import type { SessionWorkContract } from "@/types/agent/SessionWork.js";
import { SessionDelegations } from "@/agent/SessionDelegations.js";
import { LocalSessionDelegationStore } from "@/agent/LocalSessionDelegationStore.js";
import { SESSION_ORIGIN_TYPE_WORK } from "@downcity/type";
import type { AgentWorkHost } from "@/types/agent/AgentWorkHost.js";
import type { AgentSessionInput } from "@/types/agent/AgentSessionInput.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

  /** Agent 的用户可见名称；通过 `reconfigure` 原地更新。 */
  private agent_name: string;

  /** Agent 的一句话能力描述，供展示与 Group 调度使用；通过 `reconfigure` 原地更新。 */
  private agent_description: string;

  /** Agent 默认模型；Session 可以显式覆盖，也可通过 `reconfigure` 更换。 */
  private agent_model?: ModelClient;

  /**
   * 新建 Session 时注入的默认目录。
   *
   * 关键点（中文）
   * - 它是宿主在构造 Agent 时声明的默认值，不是绑定；单个 Session 可用 `set({ workspace })` 换掉。
   * - 省略时新建的 Session 没有项目上下文：没有文件工具与 Shell，纯模型对话仍可用。
   */
  readonly workspace?: WorkspaceRuntime;

  /** Agent 面向用户的 Session 创建入口。 */
  readonly sessions: AgentSessionCollection;

  /** Agent 自定义 Tool；进入每个 Workspace 时与项目 Tool 合并。 */
  readonly custom_tools: Record<string, Tool>;

  /** Agent 使用的 Session 类。 */
  readonly session_class?: AgentSessionConstructor;

  /** 当前 Agent 使用的 Session Composer；其所有 Session 共享该实例。 */
  readonly session_composer?: SessionComposer;

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 自有检查点处理器；与容器提供的 Power hooks 合并使用。 */
  private readonly custom_hooks: ToolHookSet;

  /**
   * Agent 会话可用的会话工具；延迟创建并复用。
   *
   * 关键点（中文）：工具只依赖 SessionWork 协议，不从 ToolCallContext 回查主体；
   * 它们只在 Agent 主会话和 Channel 会话里注册。
   */
  /** 当前 Agent 的工作端口，跨主体调用仍由目标 Agent 持有自己的会话与记录。 */
  private session_work?: SessionWork;
  /** 容器绑定时注入的主体发现与项目解析能力。 */
  private work_host?: AgentWorkHost;
  /** 委派执行与结果回传运行时；独立于工具的生命周期。 */
  private delegations?: SessionDelegations;
  /** 持久化完成事件及其回调重试；生命周期跟随 Agent。 */
  private completions?: SessionCompletions;
  /** 宿主负责恢复模型与消息订阅的幂等装配入口。 */
  private readonly prepare_work_session: AgentOptions["prepare_work_session"];
  private readonly resolve_work_model: AgentOptions["resolve_work_model"];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 唯一的 Session 集合。 */
  private readonly session_manager: AgentSessions;

  /** 未加入容器时使用的隔离进程内存储。 */
  private storage_provider: StorageProvider = new AgentMemoryStorageProvider();
  /** 宿主提供的项目目录解析能力，仅用于派发工作会话。 */
  private readonly resolve_work_workspace: AgentOptions["resolve_work_workspace"];

  /** 当前绑定的容器运行环境；独立运行时为空。 */
  private host?: CityRuntime;

  /** 延迟创建的 Agent 私有持久化视图。 */
  private agent_storage?: AgentStorage;

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    this.agent_name = String(options.name || "").trim() || this.id;
    this.agent_description = String(options.description || "").trim();
    this.agent_model = options.model;
    this.workspace = options.workspace;
    this.resolve_work_workspace = options.resolve_work_workspace;
    this.prepare_work_session = options.prepare_work_session;
    this.resolve_work_model = options.resolve_work_model;
    this.instruction = normalize_instruction_input(options.instruction);
    this.session_class = options.session_class;
    this.session_composer = options.session_composer;
    this.custom_tools = options.tools && typeof options.tools === "object"
      ? { ...options.tools }
      : {};
    const base_hooks = options.hooks ?? EMPTY_TOOL_HOOK_SET;
    this.custom_hooks = {
      ...base_hooks,
      effect: {
        ...base_hooks.effect,
        [SESSION_HOOK_POINTS.turn_committed]: [
          ...(base_hooks.effect[SESSION_HOOK_POINTS.turn_committed] ?? []),
          ...compile_session_callbacks(options.callbacks ?? {}),
        ],
      },
    };
    const completion_ids = new Set<string>();
    for (const handler of this.custom_hooks.effect[SESSION_HOOK_POINTS.turn_committed] ?? []) {
      const id = handler.handler_id?.trim();
      if (!id || completion_ids.has(id)) throw new Error("Agent completion callbacks require unique, stable handler_id values");
      completion_ids.add(id);
    }
    this.session_manager = new AgentSessions({
      agent_id: this.id,
      // 关键点（中文）：身份用回调实时读取，`reconfigure` 后新建 Session 立即使用新名称与描述；
      // 已创建的 Session 保留创建时的身份快照，由宿主的 system 快照决定何时同步。
      get_agent_name: () => this.agent_name,
      get_agent_description: () => this.agent_description,
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      get_agent_model: () => this.model,
      session_class: this.session_class,
      session_composer: this.session_composer,
      resolve_session_context: (input) => {
        const storage = this.resolve_storage();
        // 默认目录只用于新建会话；恢复时目录由宿主在 get() 时注入，
        // 用默认值顶替会变成一次静默换目录。
        const workspace = input?.workspace
          ?? (input?.creating ? this.workspace : undefined);
        if (!workspace) return {
          workspace_path: ".",
          completions: this.resolve_completions(),
          logger: this.logger,
          get_tools: () => this.resolve_tools(),
          get_workspace: () => undefined,
          get_hooks: () => this.resolve_hooks(),
          store: storage.sessions,
        };
        // 静态 Workspace Tool 与 Agent Tool 的命名冲突属于 Session 创建不变量，
        // 在装配时立即失败；执行时仍通过 getter 读取最新宿主扩展。
        this.resolve_tools(workspace);
        return {
          workspace_path: workspace.path,
          completions: this.resolve_completions(),
          workspace_id: workspace.id,
          logger: this.logger,
          get_tools: () => this.resolve_tools(workspace),
          get_workspace: () => workspace,
          get_hooks: () => this.resolve_hooks(),
          store: storage.sessions,
        };
      },
    });
    this.sessions = this.session_manager;
  }

  /** 返回 Agent 当前的用户可见名称。 */
  get name(): string {
    return this.agent_name;
  }

  /** 返回 Agent 当前的能力描述。 */
  get description(): string {
    return this.agent_description;
  }

  /** 返回 Agent 当前的默认模型。 */
  get model(): ModelClient | undefined {
    return this.agent_model;
  }

  /** 更新 Agent 的静态基础指令。 */
  set_instruction(input: string | string[]): void {
    const next_instruction = normalize_instruction_input(input);
    this.instruction.splice(0, this.instruction.length, ...next_instruction);
  }

  /**
   * 原地重配 Agent 的身份与默认能力。
   *
   * 关键点（中文）
   * - 与「替换 Agent 实例」相对：实例、Session 订阅与运行态全部保留，因此执行中的 Turn 不会被中断。
   * - 只影响后续读取：执行中的 Turn 继续使用它开始时快照的 system 与模型。
   * - 已持久化的 Session system 快照不会自动刷新，需要由宿主按会话调用 `syncshot()`。
   * - 省略的字段保持当前值；名称传入空值时回退到 `agent_id`，与构造语义一致。
   */
  reconfigure(input: AgentReconfigureInput): void {
    if (this.dispose_promise) throw new Error("Agent is disposing");
    if (input.name !== undefined) {
      this.agent_name = String(input.name || "").trim() || this.id;
    }
    if (input.description !== undefined) {
      this.agent_description = String(input.description || "").trim();
    }
    if (input.instruction !== undefined) {
      this.set_instruction(input.instruction);
    }
    if (input.model !== undefined) {
      this.agent_model = input.model;
    }
  }

  /** 返回 Agent 指令快照。 */
  get_instructions(): readonly string[] {
    return [...this.instruction];
  }

  /**
   * 取用 Agent 自己那条会话，不存在时先建立。
   *
   * 关键点（中文）
   * - 它就是一条普通 Session：工作区能力、set/get、消息、审批与其他会话完全一致。
   * - 不接收 Workspace：目录在创建时注入，之后用 `session.set({ workspace })` 切换。
   */  async session(input?: AgentSessionInput): Promise<AgentSession> {
    return await this.session_manager.self(
      input?.workspace ? { workspace: input.workspace } : undefined,
    );
  }

  /** 返回 Agent 级日志器。 */
  get_logger(): Logger {
    return this.logger;
  }

  /**
   * 绑定容器运行环境；必须在创建或恢复 Session 前完成。
   *
   * 关键点（中文）
   * - 主体只收下容器推送的存储能力，不持有容器引用。
   * - 存储一旦在独立模式下被使用就不能再切换，否则已有 Session 会写入两个事实源。
   */
  bind(host: CityRuntime, work_host?: AgentWorkHost): void {
    if (this.host) {
      if (this.host === host) return;
      throw new Error(`Agent "${this.id}" is already bound to another container`);
    }
    if (this.agent_storage) {
      throw new Error(
        `Agent "${this.id}" already used standalone storage; bind it before using Sessions`,
      );
    }
    this.host = host;
    this.work_host = work_host;
    this.storage_provider = host.storage;
  }

  /**
   * 解除容器绑定，主体回到独立运行状态。
   *
   * 关键点（中文）
   * - 由容器在放下引用后调用；主体不反向通知容器。
   * - 已解析的存储视图同时丢弃，避免解绑后继续写旧容器存储。
   */
  unbind(): void {
    this.delegations?.suspend();
    // 解绑前绑定旧存储，停止中的 Turn 仍需把完成事件写到原 Agent 私有目录。
    this.resolve_completions().suspend();
    this.host = undefined;
    this.work_host = undefined;
    this.storage_provider = new AgentMemoryStorageProvider();
    this.agent_storage = undefined;
  }

  /**
   * 宿主完成 Workspace、Power 和消息订阅装配后恢复未完成委派。
   * 只启动后台观察，不等待子任务结束；也可用于重试暂时失败的结果投递。
   */
  async resume_work(): Promise<void> {
    if (this.dispose_promise) throw new Error("Agent is disposing");
    await this.resolve_completions().resume();
    await this.resolve_delegations().resume();
  }

  /** 停止绑定到指定 Workspace 的运行中 Session，并释放后台标题任务。 */
  async release_workspace(workspace_id: string): Promise<void> {
    await this.session_manager.stop_executing_sessions(workspace_id);
    this.session_manager.dispose_title_generation(workspace_id);
  }

  /** 解析指定 Workspace 下一个 Session 当前可见的 system messages。 */
  async resolve_system_messages(
    workspace: WorkspaceRuntime,
    input: {
      /** 目标 Session 稳定标识。 */
      session_id: string;
    },
  ): Promise<SessionSystemMessage[]> {
    const session_id = String(input.session_id || "").trim();
    if (!session_id) {
      throw new Error("resolve_system_messages requires a non-empty session_id");
    }
    const instruction_system_blocks = create_instruction_system_blocks({
      agent_id: this.id,
      agent_name: this.name,
      instruction: [...this.get_instructions()],
    });
    const hooks = this.resolve_hooks();
    const context = this.create_session_call_context({
      session_id,
      workspace,
      instruction_system_blocks,
    });
    const power_system_blocks = await resolve_session_power_system_blocks({
      session_id,
      hooks,
      context,
    });
    const blocks = await build_session_system_blocks({
      agent_id: this.id,
      project_root: workspace.path,
      session_id,
      created_at: Date.now(),
      timezone: resolve_system_timezone(),
      get_instruction_system_blocks: () => instruction_system_blocks,
      get_power_system_blocks: async () => power_system_blocks,
    });
    return blocks.map((block) => ({ role: "system", content: block.content }));
  }

  /** 构造不属任何 Turn 的调用环境；用于 system 查询。 */
  private create_session_call_context(input: {
    /** 目标 Session 稳定标识。 */
    readonly session_id: string;
    /** 当前使用的 Workspace 实例。 */
    readonly workspace: WorkspaceRuntime;
    /** 当前 Agent 指令快照。 */
    readonly instruction_system_blocks: readonly AgentSessionSystemBlock[];
  }): ToolCallContext {
    return Object.freeze({
      agent_id: this.id,
      agent_name: this.name,
      agent_description: this.description,
      agent_instructions: Object.freeze(
        input.instruction_system_blocks.map((block) => block.content),
      ),
      session_id: input.session_id,
      session_origin: { type: SESSION_ORIGIN_TYPE_WORK },
      workspace: input.workspace,
      messages: Object.freeze([]),
      workspace_env: Object.freeze({ ...input.workspace.get_env() }),
    });
  }

  /**
   * 释放 Agent 的 Session 后台任务、存储与运行环境。
   *
   * 关键点（中文）
   * - 已绑定的 Agent 不能自行释放：容器仍持有引用，必须走 `city.agents.remove(id)`。
   * - 这把「已注册主体不能自行释放」变成可检查的不变量，而不是靠时序掩盖。
   */
  async dispose(): Promise<void> {
    if (this.host) {
      throw new Error(
        `Agent "${this.id}" is bound to a container; release it with city.agents.remove(id)`,
      );
    }
    this.dispose_promise ??= (async () => {
      this.delegations?.suspend();
      if (this.agent_storage) this.resolve_completions().suspend();
      const results = await Promise.allSettled([
        this.session_manager.stop_executing_sessions(),
      ]);
      await this.delegations?.settle();
      await this.completions?.settle();
      this.session_manager.dispose_title_generation();
      results.push(...await Promise.allSettled([
        this.agent_storage?.sessions.dispose() ?? Promise.resolve(),
        this.logger.save_all_logs(),
      ]));
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      this.agent_storage = undefined;
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 获取或创建 Agent 唯一的 Session 存储。 */
  private resolve_storage(): AgentStorage {
    if (this.agent_storage) return this.agent_storage;
    const scope = this.storage_provider.open_scope(["agents", this.id]);
    this.logger.bind_storage(scope.files, scope.root_path, { agent_id: this.id });
    this.agent_storage = {
      root_path: scope.root_path,
      files: scope.files,
      database_location: scope.database_location,
      delegations: new LocalSessionDelegationStore(scope.files),
      sessions: new LocalSessionStore({
        files: scope.files,
        storage_root_path: scope.root_path,
        agent_id: this.id,
        database_location: scope.database_location,
      }),
    };
    return this.agent_storage;
  }

  /**
   * 返回当前生效的工具集合：Workspace 工具 + 容器 Power 工具 + Agent 自有工具。
   *
   * 关键点（中文）
   * - 容器 Power 工具从环境句柄实时读取，不缓存；容器增删 Power 后下一次求值即生效。
   * - 静态 Workspace Tool 与 Agent Tool 的命名冲突属于 Session 创建不变量，装配时立即失败。
   */
  private resolve_tools(workspace?: WorkspaceRuntime): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    if (workspace) register_tools(tools, workspace.tools, "WorkspaceTools");
    register_tools(tools, this.host?.power_tools ?? {}, "Power");
    register_tools(tools, this.custom_tools, "AgentOptions.tools");
    return tools;
  }

  /** 向 City 的 Session Power 提供本 Agent 持有的会话工作服务。 */
  get_session_work(): SessionWorkContract {
    return this.resolve_session_work();
  }

  /** 解析协作对象；独立运行时仍能管理自己的工作会话。 */
  private resolve_work_agent(agent_id: string): Agent {
    if (agent_id === this.id) return this;
    if (!this.work_host) throw new Error("Cross-agent Session work requires a host agent resolver");
    return this.work_host.resolve_agent(agent_id);
  }

  /** 目标 Agent 自己持有会话工作端口，不复制其它主体的存储或运行状态。 */
  private resolve_session_work(): SessionWork {
    this.session_work ??= new SessionWork({
      agent_id: this.id,
      list_sessions: async (input) => await this.session_manager.list(input),
      get_session: async (session_id, origin_type) => await this.restore_work_session(session_id, origin_type),
      delegations: this.resolve_delegations(),
    });
    return this.session_work;
  }

  /** 使用会话当前持久化目录恢复上下文，并完成宿主的模型与事件订阅装配。 */
  private async restore_work_session(session_id: string, origin_type: string): Promise<AgentSession> {
    const storage = this.resolve_storage();
    if (!(await storage.sessions.has_session(session_id, origin_type))) {
      throw new Error(`Session is unavailable or archived: ${session_id}`);
    }
    const session_storage = await storage.sessions.open_session(session_id, origin_type);
    const metadata = await session_storage.read_metadata();
    const workspace_id = metadata.workspace_id;
    const workspace = workspace_id
      ? workspace_id === this.workspace?.id ? this.workspace : await this.resolve_project_workspace(workspace_id)
      : undefined;
    const session = await this.session_manager.get(session_id, origin_type, { workspace });
    await this.prepare_work_session?.(session);
    return session;
  }

  /** 项目解析沿用宿主端口；容器提供默认实现供无定制宿主的 SDK 使用。 */
  private async resolve_project_workspace(workspace_id: string): Promise<WorkspaceRuntime> {
    const resolve_workspace = this.resolve_work_workspace ?? this.work_host?.resolve_workspace;
    if (!resolve_workspace) throw new Error("session.start requires a host project Workspace resolver");
    return await resolve_workspace(workspace_id);
  }

  /** 装配当前主体的委派端口，跨主体父会话通过宿主端口恢复。 */
  private resolve_delegations(): SessionDelegations {
    if (this.delegations) return this.delegations;
    const storage = this.resolve_storage();
    const resolve_workspace = async (workspace_id: string): Promise<WorkspaceRuntime> =>
      await this.resolve_project_workspace(workspace_id);
    const prepare_session = async (session: AgentSession, model_id?: string): Promise<void> => {
      await this.prepare_work_session?.(session, model_id);
      if (model_id) {
        if (!this.resolve_work_model) throw new Error("Session model selection is not configured by the host");
        const workspace = session.workspace_id ? await this.resolve_project_workspace(session.workspace_id) : undefined;
        await session.set({ model: await this.resolve_work_model(model_id, workspace) });
      }
    };
    this.delegations = new SessionDelegations({
      agent_id: this.id,
      store: storage.delegations,
      resolve_workspace,
      ensure_work_session: async (session_id, workspace) =>
        await this.session_manager.ensure_work_session(session_id, workspace),
      prepare_session,
      validate_model: async (model_id, workspace) => {
        if (!this.resolve_work_model) throw new Error("Session model selection is not configured by the host");
        await this.resolve_work_model(model_id, workspace);
      },
      get_work_session: async (session_id) => await this.restore_work_session(session_id, SESSION_ORIGIN_TYPE_WORK),
      get_parent_session: async (caller) => await this.resolve_work_agent(caller.agent_id)
        .restore_work_session(caller.session_id, caller.origin.type),
      report_error: (delegation_id, error) => {
        this.logger.error("Session delegation failed; retained for retry", {
          delegation_id,
          error: String(error),
        });
      },
    });
    return this.delegations;
  }

  /** 读取原始处理器；完成日志重放不能再次进入持久化包装器。 */
  private resolve_raw_hooks(): ToolHookSet {
    const power_hooks = this.host?.power_hooks;
    if (!power_hooks) return this.custom_hooks;
    if (this.custom_hooks === EMPTY_TOOL_HOOK_SET) return power_hooks;
    return merge_tool_hook_sets(power_hooks, this.custom_hooks);
  }

  /** Agent 为完成 Hook 提供持久化与恢复；不将 callback 逻辑写进 Session 执行器。 */
  private resolve_completions(): SessionCompletions {
    this.completions ??= new SessionCompletions({
      files: this.resolve_storage().files,
      get_handlers: () => this.resolve_raw_hooks().effect[SESSION_HOOK_POINTS.turn_committed] ?? [],
      restore_context: async (record) => {
        const session = await this.restore_work_session(record.event.session_id, record.origin.type);
        if (record.state === "prepared") {
          const session_store = await this.resolve_storage().sessions.open_session(session.id, record.origin.type);
          record.event.messages = (await session_store.list_messages())
            .filter((message) => message.turn_id === record.event.turn_id);
        }
        const workspace = record.workspace_id
          ? record.workspace_id === this.workspace?.id ? this.workspace : await this.resolve_project_workspace(record.workspace_id)
          : undefined;
        return {
          agent_id: this.id,
          agent_name: this.name,
          agent_description: this.description,
          agent_instructions: [...this.get_instructions()],
          session_id: session.id,
          session_origin: record.origin,
          turn_id: record.event.turn_id,
          ...(workspace ? { workspace } : {}),
          workspace_env: workspace?.get_env() ?? {},
          // canonical 消息在事件值中提供；回调不重新装配历史模型消息。
          messages: [],
        };
      },
      report_error: (error) => this.logger.error("Session completion delivery failed; retained for retry", { error: String(error) }),
    });
    return this.completions;
  }

  /** 合并容器与 Agent hooks；完成事件先落盘，失败由独立队列重试。 */
  private resolve_hooks(): ToolHookSet {
    const hooks = this.resolve_raw_hooks();
    if (!hooks.effect[SESSION_HOOK_POINTS.turn_committed]?.length) return hooks;
    return {
      ...hooks,
      effect: {
        ...hooks.effect,
        [SESSION_HOOK_POINTS.turn_committed]: [async (value, context) => {
          await this.resolve_completions().commit(value as unknown as SessionTurnCommittedHookValue, context);
        }],
      },
    };
  }

}

/** 按检查点合并两组 hooks；同名检查点按容器在前、自有在后的顺序拼接。 */
function merge_tool_hook_sets(base: ToolHookSet, extra: ToolHookSet): ToolHookSet {
  const merge_points = <THandler>(
    left: Readonly<Record<string, readonly THandler[]>>,
    right: Readonly<Record<string, readonly THandler[]>>,
  ): Readonly<Record<string, readonly THandler[]>> => {
    const merged: Record<string, readonly THandler[]> = { ...left };
    for (const [point_name, handlers] of Object.entries(right)) {
      merged[point_name] = [...(merged[point_name] ?? []), ...handlers];
    }
    return merged;
  };
  return {
    pipeline: merge_points(base.pipeline, extra.pipeline),
    guard: merge_points(base.guard, extra.guard),
    effect: merge_points(base.effect, extra.effect),
  };
}

/** 注册 Tool 集合，并拒绝不同来源静默覆盖。 */
function register_tools(
  target: Record<string, Tool>,
  source: Record<string, Tool>,
  source_name: string,
): void {
  for (const [tool_name, tool_definition] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(target, tool_name)) {
      throw new Error(`Agent tool name conflict: "${tool_name}" from ${source_name}`);
    }
    target[tool_name] = tool_definition;
  }
}
