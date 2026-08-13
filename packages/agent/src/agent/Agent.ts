/**
 * Agent：本地 Agent 核心入口与 facade。
 *
 * 职责说明（中文）
 * - 对外暴露 `Agent` 这一唯一的本地实例类。
 * - Agent 直接持有自身状态与长期运行时对象，避免额外 Assembly 复制同一批字段。
 * - Session 集合由 `AgentSessions` 管理；长期资源由内部 `AgentRuntime` 管理。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { AgentOptions } from "@/types/agent/AgentOptions.js";
import type { Shell } from "@downcity/shell";
import type { WorkspaceBase } from "@/workspace/WorkspaceBase.js";
import { Logger } from "@/utils/logger/Logger.js";
import { normalize_instruction_input } from "@/agent/AgentInstructions.js";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { AgentRuntime } from "@/agent/AgentRuntime.js";
import { generate_id } from "@/utils/Id.js";
import { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { PluginRegistryUnsubscribe } from "@/types/plugin/PluginRegistry.js";
import type { WorkspaceEnvUnsubscribe } from "@/types/workspace/WorkspaceEnv.js";
import type { Hono } from "hono";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import { list_plugin_states } from "@/plugin/core/PluginStateController.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";
import {
  resolve_session_system_messages,
  type SystemProfile,
} from "@/executor/composer/system/default/SystemDomain.js";
import type { SystemModelMessage } from "ai";

const RESERVED_PLUGIN_TOOL_NAMES = new Set(["plugin_read", "plugin_call"]);

/** 将一个来源明确的 Tool Set 注册到 Agent，并拒绝静默覆盖。 */
function register_agent_tools(
  target: Record<string, Tool>,
  source: Record<string, Tool>,
  source_name: string,
): void {
  for (const [tool_name, tool_definition] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(target, tool_name)) {
      throw new Error(
        `Agent tool name conflict: "${tool_name}" from ${source_name}`,
      );
    }
    target[tool_name] = tool_definition;
  }
}

/**
 * SDK 本地 Agent。
 */
export class Agent {
  /** 当前 Agent 的稳定标识，用于区分 Session 存储目录与运行时归属。 */
  readonly id: string;

  /** 当前 Agent 引用的项目资源与安全边界。 */
  readonly workspace: WorkspaceBase;

  /** 当前 Agent 向所有 Session 提供的工具集合。 */
  readonly tools: Record<string, Tool>;

  /** 当前 Agent 已装配的 Plugin 调用与注册入口。 */
  readonly plugins: PluginRegistry;

  /** 当前 Agent 的本地 Session 创建、恢复、查询与归档入口。 */
  readonly sessions: AgentSessions;

  /**
   * 当前 Agent 持有的默认运行时模型实例。
   *
   * 关键点（中文）
   * - Agent 只持有调用方传入的实例，不负责模型选择、持久化或恢复。
   * - Session 未设置自己的模型时，执行会回退使用该实例。
   */
  readonly model?: AgentModel;

  /** 当前 Agent 独享的运行日志器。 */
  private readonly logger: Logger;

  /** 提供给 Plugin、Session 与宿主集成层共享的 Agent 执行上下文。 */
  private readonly plugin_context: PluginContext;

  /** 调用方提供的自定义 Session 类；省略时使用 SDK 默认实现。 */
  private readonly session_class: AgentOptions["session_class"];

  /** 当前 Agent 长期资源的唯一内部运行时。 */
  private readonly runtime: AgentRuntime;

  /** 当前 Agent configured instruction 的可变有序集合。 */
  private instruction: string[];

  /** 取消 Workspace env 变化订阅的函数。 */
  private readonly unsubscribe_workspace_env: WorkspaceEnvUnsubscribe;

  /** 取消 PluginRegistry 变化订阅的函数。 */
  private readonly unsubscribe_plugin_change: PluginRegistryUnsubscribe;

  /** 当前由 PluginRegistry 注册到 Agent 的 Tool 名称。 */
  private readonly plugin_tool_names = new Set<string>();

  constructor(options: AgentOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Agent requires a non-empty id");
    if (!options.workspace) throw new Error("Agent requires a Workspace");
    this.workspace = options.workspace;

    this.session_class = options.session_class;
    this.model = options.model;
    this.plugins = new PluginRegistry(options.plugins || []);
    this.tools = {};
    for (const tool_name of Object.keys(this.workspace.tools)) {
      if (RESERVED_PLUGIN_TOOL_NAMES.has(tool_name)) {
        throw new Error(
          `Agent tool name conflict: "${tool_name}" is reserved for PluginRegistry`,
        );
      }
    }
    register_agent_tools(this.tools, this.workspace.tools, "WorkspaceTools");
    this.sync_plugin_tools();
    const custom_tools = options.tools && typeof options.tools === "object"
      ? options.tools
      : {};
    for (const tool_name of Object.keys(custom_tools)) {
      if (RESERVED_PLUGIN_TOOL_NAMES.has(tool_name)) {
        throw new Error(
          `Agent tool name conflict: "${tool_name}" is reserved for PluginRegistry`,
        );
      }
    }
    register_agent_tools(this.tools, custom_tools, "AgentOptions.tools");
    this.logger = new Logger();
    this.logger.bind_workspace(this.workspace.files);
    this.instruction = normalize_instruction_input(options.instruction);
    const store = this.workspace.create_session_store(this.id);

    this.sessions = new AgentSessions({
      agent_id: this.id,
      workspace_path: this.workspace.path,
      store,
      tools: this.tools,
      logger: this.logger,
      get_instruction: () => this.instruction,
      get_workspace_env: () => this.workspace.get_env(),
      get_agent_plugins: () => this.plugins.execution_view(),
      ensure_agent_ready: async () => {
        await this.runtime.ensure_initial();
      },
      get_agent_model: () => this.model,
      session_class: this.session_class,
    });
    this.plugin_context = create_plugin_context({
      ...(this.workspace.shell ? { shell: this.workspace.shell } : {}),
      agent_id: this.id,
      workspace_path: this.workspace.path,
      files: this.workspace.files,
      logger: this.logger,
      get_workspace_env: () => this.workspace.get_env(),
      get_instructions: () => this.instruction,
      sessions: this.sessions,
      plugins: this.plugins,
    });

    this.unsubscribe_workspace_env = this.workspace.subscribe_env((env) => {
      this.sessions.broadcast_env({ ...env }, generate_id());
    });
    this.unsubscribe_plugin_change = this.plugins.subscribe_change((change) => {
      this.sync_plugin_tools();
      const verb = change.type === "register" ? "registered" : "unregistered";
      this.sessions.broadcast_plugins({
        command_id: generate_id(),
        title: `Agent plugin ${change.plugin_name} ${verb}`,
        plugins: this.plugins.execution_view(),
      });
    });

    // 关键点（中文）：装配完成后立即初始化唯一运行时，执行入口只等待内部屏障。
    this.runtime = new AgentRuntime({
      context: this.plugin_context,
      plugins: this.plugins,
    });
  }

  /**
   * 释放当前 Agent 持有的长期运行时对象。
   *
   * 关键点（中文）
   * - 关闭 plugin lifecycle 与 ActionSchedule 等 Agent 自有资源。
   * - Workspace 与 Agent 一对一绑定，因此这里同时关闭 Shell 与 Sandbox。
   * - 不负责任何 transport（RPC / HTTP）；transport 由 `@downcity/city` 宿主管理。
   */
  async dispose(): Promise<void> {
    this.unsubscribe_workspace_env();
    this.unsubscribe_plugin_change();
    this.sessions.dispose_title_generation();
    try {
      await this.runtime.dispose();
    } finally {
      try {
        await this.logger.save_all_logs();
      } finally {
        await this.workspace.dispose();
      }
    }
  }

  /**
   * 更新当前 SDK Agent 的静态基础指令。
   */
  set_instruction(input: string | string[]): void {
    const next_instruction = normalize_instruction_input(input);
    this.instruction.splice(0, this.instruction.length, ...next_instruction);
  }

  /**
   * 返回当前 agent 绑定的统一日志器。
   */
  get_logger(): Logger {
    return this.logger;
  }

  /**
   * 返回当前 agent 挂载的 Shell。
   */
  get_shell(): Shell | undefined {
    return this.workspace.shell;
  }

  /** 返回当前 Agent 已配置的静态指令快照。 */
  get_instructions(): readonly string[] {
    return [...this.instruction];
  }

  /** 列出当前 Agent 已注册的 Plugin 状态。 */
  list_plugin_states(): PluginSnapshot[] {
    return list_plugin_states({ context: this.plugin_context });
  }

  /** 把当前 Agent 已注册 Plugin 的 HTTP 路由装配到宿主应用。 */
  register_plugin_http_routes(app: Hono): void {
    register_plugin_http_routes({
      app,
      get_context: () => this.plugin_context,
      plugins: this.plugins.snapshots()
        .map((snapshot) => this.plugins.get(snapshot.name))
        .filter((plugin) => plugin !== null),
    });
  }

  /** 解析指定 Session 当前可见的完整 system messages。 */
  async resolve_system_messages(input: {
    /** 需要解析 system 的 Session 标识。 */
    session_id: string;
    /** system 组合档位；省略时使用 chat。 */
    profile?: SystemProfile;
  }): Promise<SystemModelMessage[]> {
    return await resolve_session_system_messages({
      project_root: this.workspace.path,
      session_id: input.session_id,
      profile: input.profile || "chat",
      static_system_prompts: [...this.instruction],
      context: this.plugin_context,
    });
  }

  /** 将 PluginRegistry 当前 Tool Set 同步到 Agent 持有的工具集合。 */
  private sync_plugin_tools(): void {
    for (const tool_name of this.plugin_tool_names) {
      delete this.tools[tool_name];
    }
    this.plugin_tool_names.clear();
    const plugin_tools = this.plugins.tools();
    register_agent_tools(this.tools, plugin_tools, "PluginRegistry");
    for (const tool_name of Object.keys(plugin_tools)) {
      this.plugin_tool_names.add(tool_name);
    }
  }
}
