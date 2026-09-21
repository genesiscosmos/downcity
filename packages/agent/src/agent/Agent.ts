/**
 * Agent：身份、模型、指令与 Session 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - 能力与 Transport 由容器持有，Agent 只收下容器在绑定时推送的能力，不持有容器引用。
 * - Session 由 AgentSessions 统一持有；Workspace 只在单个 Session 创建时提供执行资源。
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
import type {
  AgentSessionCollection,
} from "@/types/agent/AgentSessionCollection.js";
import { Logger } from "@/utils/logger/Logger.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { AgentMemoryStorageProvider } from "@/agent/AgentMemoryStorage.js";
import { LocalSessionStore } from "@/session/storage/LocalSessionStore.js";
import { EMPTY_TOOL_HOOK_SET } from "@downcity/type";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import type { SessionSystemMessage } from "@downcity/type";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import {
  build_session_system_blocks,
  resolve_session_power_system_blocks,
} from "@/session/input/SessionSystem.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import { resolve_system_timezone } from "@/session/storage/Metadata.js";

/** SDK Agent 主体。 */
export class Agent {
  /** Agent 的全局稳定标识。 */
  readonly id: string;

  /** Agent 的用户可见名称。 */
  readonly name: string;

  /** Agent 的一句话能力描述，供展示与 Group 调度使用。 */
  readonly description: string;

  /** Agent 默认模型；Session 可以显式覆盖。 */
  readonly model?: ModelClient;

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

  /** 当前生效的扩展工具；键为扩展名，由宿主推送。 */
  private power_tools: Readonly<Record<string, Tool>> = Object.freeze({});

  /** 当前生效的扩展处理器集合，由宿主推送。 */
  private power_hooks: ToolHookSet = EMPTY_TOOL_HOOK_SET;

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 唯一的 Session 集合。 */
  private readonly session_manager: AgentSessions;

  /** 未加入容器时使用的隔离进程内存储。 */
  private storage_provider: StorageProvider = new AgentMemoryStorageProvider();

  /** 当前绑定的容器运行环境；独立运行时为空。 */
  private host?: CityRuntime;

  /** 延迟创建的 Agent 私有持久化视图。 */
  private agent_storage?: AgentStorage;

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    this.name = String(options.name || "").trim() || this.id;
    this.description = String(options.description || "").trim();
    this.model = options.model;
    this.instruction = normalize_instruction_input(options.instruction);
    this.session_class = options.session_class;
    this.session_composer = options.session_composer;
    this.custom_tools = options.tools && typeof options.tools === "object"
      ? { ...options.tools }
      : {};
    this.session_manager = new AgentSessions({
      agent_id: this.id,
      agent_name: this.name,
      agent_description: this.description,
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      get_agent_model: () => this.model,
      session_class: this.session_class,
      session_composer: this.session_composer,
      resolve_session_context: (workspace) => {
        const storage = this.resolve_storage();
        if (!workspace) return {
          workspace_path: ".",
          logger: this.logger,
          get_tools: () => ({ ...this.custom_tools }),
          get_workspace_env: () => ({}),
          get_workspace: () => undefined,
          get_hooks: () => this.power_hooks,
          store: storage.sessions,
        };
        // 静态 Workspace Tool 与 Agent Tool 的命名冲突属于 Session 创建不变量，
        // 在装配时立即失败；执行时仍通过 getter 读取最新宿主扩展。
        this.resolve_tools(workspace);
        return {
          workspace_path: workspace.path,
          workspace_id: workspace.id,
          logger: this.logger,
          get_tools: () => this.resolve_tools(workspace),
          get_workspace_env: () => workspace.get_env(),
          get_workspace: () => workspace,
          get_hooks: () => this.power_hooks,
          store: storage.sessions,
        };
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

  /**
   * 接收宿主编译出的扩展产物。
   *
   * 关键点（中文）
   * - 传入的是普通值，不持有宿主引用，也不存在按 Agent/Workspace 回查。
   * - 工具与处理器一次性替换，保证两者来自同一份编译快照。
   * - 生效时机：工具集在 Session 创建时求值，因此新产物在下一个 Turn 生效。
   */
  apply_powers(input: {
    /** 扩展工具；键为扩展名。 */
    readonly tools: Readonly<Record<string, Tool>>;
    /** 扩展处理器集合。 */
    readonly hooks: ToolHookSet;
  }): void {
    this.power_tools = Object.freeze({ ...input.tools });
    this.power_hooks = input.hooks;
  }

  /** 返回当前生效的扩展工具快照；未加入宿主时为空。 */
  get_power_tools(): Readonly<Record<string, Tool>> {
    return this.power_tools;
  }

  /** 返回当前生效的扩展处理器集合。 */
  get_power_hooks(): ToolHookSet {
    return this.power_hooks;
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
  bind(host: CityRuntime): void {
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
    this.host = undefined;
    this.storage_provider = new AgentMemoryStorageProvider();
    this.agent_storage = undefined;
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
    const hooks = this.power_hooks;
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
      session_origin: { type: "chat" },
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
      const results = await Promise.allSettled([
        this.session_manager.stop_executing_sessions(),
      ]);
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
      sessions: new LocalSessionStore({
        files: scope.files,
        storage_root_path: scope.root_path,
        agent_id: this.id,
        database_location: scope.database_location,
      }),
    };
    return this.agent_storage;
  }

  /** 在明确检查点合并 Workspace、扩展与 Agent Tool。 */
  private resolve_tools(workspace: WorkspaceRuntime): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    register_tools(tools, workspace.tools, "WorkspaceTools");
    register_tools(tools, this.power_tools, "Power");
    register_tools(tools, this.custom_tools, "AgentOptions.tools");
    return tools;
  }

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
