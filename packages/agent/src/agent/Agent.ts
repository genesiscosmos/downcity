/**
 * Agent：身份、模型、指令与 Session 的主体对象。
 *
 * 职责说明（中文）
 * - Agent 不绑定 Workspace；调用方通过 `agent.sessions.create({ workspace })` 选择本次执行环境。
 * - Power 与 Transport 由 City 持有，Agent 只通过 CityRuntime 使用最小执行能力。
 * - Session 由 AgentSessions 统一持有；Workspace 只在单个 Session 创建时提供执行资源。
 */

import type {
  CityRuntime,
  ModelClient,
  RuntimeTool as Tool,
  StorageProvider,
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
import { EMPTY_SESSION_HOOKS } from "@/session/SessionHooks.js";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import type { SessionSystemMessage } from "@/model/types/SessionPrompts.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import {
  build_session_system_blocks,
  resolve_session_power_system_blocks,
} from "@/session/SessionSystem.js";
import { create_session_hook_context } from "@/session/runtime/SessionTurnContext.js";
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

  /** 为每个 Session 创建独立 Composer 的工厂。 */
  readonly session_composer?: () => SessionComposer;

  /** Agent 级日志器，不绑定任何 Workspace。 */
  private readonly logger = new Logger();

  /** 当前 Agent configured instruction。 */
  private readonly instruction: string[];

  /** Agent 释放状态。 */
  private dispose_promise?: Promise<void>;

  /** Agent 唯一的 Session 集合。 */
  private readonly session_manager: AgentSessions;

  /** 未加入宿主时使用的隔离进程内存储。 */
  private storage_provider: StorageProvider = new AgentMemoryStorageProvider();

  /** Agent 当前所属的唯一 City；独立运行时为空。 */
  private city?: CityRuntime;

  /** 延迟创建的 Agent 私有持久化视图。 */
  private agent_storage?: AgentStorage;

  /** 是否已经在无宿主存储中创建或恢复过 Session。 */
  private memory_session_started = false;

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
      logger: this.logger,
      get_instruction: () => [...this.get_instructions()],
      ensure_agent_ready: async () => await this.ensure_ready(),
      get_agent_model: () => this.model,
      session_class: this.session_class,
      create_session_composer: this.session_composer,
      on_session_routed: () => {
        if (!this.city) this.memory_session_started = true;
      },
      resolve_session_context: (workspace) => {
        const storage = this.resolve_storage();
        if (!workspace) return {
          workspace_path: ".",
          logger: this.logger,
          get_tools: () => ({ ...this.custom_tools }),
          get_workspace_env: () => ({}),
          get_hooks: () => EMPTY_SESSION_HOOKS,
          store: storage.sessions,
        };
        this.assert_workspace(workspace);
        // 静态 Workspace Tool 与 Agent Tool 的命名冲突属于 Session 创建不变量，
        // 在装配时立即失败；执行时仍通过 getter 读取最新宿主扩展。
        this.resolve_tools(workspace);
        return {
          workspace_path: workspace.path,
          workspace_id: workspace.id,
          logger: this.logger,
          get_tools: () => this.resolve_tools(workspace),
          get_workspace_env: () => workspace.get_env(),
          get_hooks: () => this.city?.get_session_hooks(this.id, workspace)
            ?? EMPTY_SESSION_HOOKS,
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

  /** 返回 Agent 级日志器。 */
  get_logger(): Logger {
    return this.logger;
  }

  /** 将 Agent 加入 City；必须在创建或恢复 Session 前完成。 */
  attach(city: CityRuntime): void {
    if (this.dispose_promise) throw new Error(`Agent "${this.id}" is disposing`);
    if (this.city) {
      if (this.city === city) return;
      throw new Error(`Agent "${this.id}" already belongs to another City`);
    }
    if (this.memory_session_started || this.agent_storage) {
      throw new Error(
        `Agent "${this.id}" already used standalone storage; attach it before using Sessions`,
      );
    }
    this.city = city;
    this.storage_provider = city.storage;
  }

  /** 解除指定 City 关系；其他 City 不能解除当前绑定。 */
  detach(city: CityRuntime): void {
    if (this.city === city) this.city = undefined;
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
    this.assert_workspace(workspace);
    const session_id = String(input.session_id || "").trim();
    if (!session_id) {
      throw new Error("resolve_system_messages requires a non-empty session_id");
    }
    const instruction_system_blocks = create_instruction_system_blocks(
      [...this.get_instructions()],
      workspace.path,
    );
    const hooks = this.city?.get_session_hooks(this.id, workspace)
      ?? EMPTY_SESSION_HOOKS;
    const hook_context = create_session_hook_context({
      session_id,
      session_origin: { type: "chat" },
      project_root: workspace.path,
      workspace_env: Object.freeze({ ...workspace.get_env() }),
      agent_systems: instruction_system_blocks.map((block) => block.content),
    });
    const power_system_blocks = await resolve_session_power_system_blocks({
      session_id,
      hooks,
      context: hook_context,
    });
    const blocks = await build_session_system_blocks({
      agent_id: this.id,
      project_root: workspace.path,
      session_id,
      created_at: Date.now(),
      timezone: resolve_system_timezone(),
      get_instruction_system_blocks: () => instruction_system_blocks,
      get_managed_power_system_blocks: async () => [],
      get_power_system_blocks: async () => power_system_blocks,
    });
    return blocks.map((block) => ({ role: "system", content: block.content }));
  }

  /** 释放 Agent 的 Session 后台任务、存储与宿主引用。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const results = await Promise.allSettled([
        this.session_manager.stop_executing_sessions(),
      ]);
      this.session_manager.dispose_title_generation();
      const city = this.city;
      results.push(...await Promise.allSettled([
        city?.release_agent(this) ?? Promise.resolve(),
        this.agent_storage?.sessions.dispose() ?? Promise.resolve(),
        this.logger.save_all_logs(),
      ]));
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      this.city = undefined;
      this.agent_storage = undefined;
      if (errors.length > 0) throw new AggregateError(errors, "Agent dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 等待 Agent 自身运行时 ready，供内部运行时使用。 */
  async ensure_ready(): Promise<void> {
    await this.city?.ensure_ready();
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

  /** 校验宿主模式下使用的 Workspace 来自当前宿主事实源。 */
  private assert_workspace(workspace: WorkspaceRuntime): void {
    const workspace_id = String(workspace?.id || "").trim();
    if (!workspace_id) throw new Error("Agent sessions require a Workspace with a stable id");
    if (this.city && this.city.workspaces.get(workspace_id) !== workspace) {
      throw new Error(`Workspace "${workspace_id}" does not belong to the Agent City`);
    }
  }

  /** 在明确检查点合并 Workspace、宿主扩展和 Agent Tool。 */
  private resolve_tools(workspace: WorkspaceRuntime): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    register_tools(tools, workspace.tools, "WorkspaceTools");
    register_tools(
      tools,
      this.city?.get_session_tools(this.id, workspace) ?? {},
      "City",
    );
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
