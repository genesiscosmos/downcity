/**
 * AgentWorkspace：Agent 进入一个 Workspace 后的执行作用域。
 *
 * 关键点（中文）
 * - Agent 仍是身份、模型、指令与 Plugin 的唯一拥有者。
 * - 当前对象只组合 Workspace Tool、SessionStore、Plugin Context 与后台资源。
 * - 一个 Agent 可以同时持有多个 AgentWorkspace，彼此的 Session 与 Shell 隔离。
 */

import type { Tool, SystemModelMessage } from "ai";
import type { Hono } from "hono";
import type { Shell } from "@downcity/shell";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { AgentWorkspaceLifecycle } from "@/agent/AgentWorkspaceLifecycle.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";
import { list_plugin_states } from "@/plugin/core/PluginStateController.js";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { AgentWorkspaceOptions } from "@/types/agent/AgentWorkspaceOptions.js";
import { Logger } from "@/utils/logger/Logger.js";
import { generate_id } from "@/utils/Id.js";
import {
  resolve_session_system_messages,
  type SystemProfile,
} from "@/executor/composer/system/default/SystemDomain.js";

const RESERVED_PLUGIN_TOOL_NAMES = new Set(["plugin_read", "plugin_call"]);

/** 拒绝普通 Tool 占用 PluginRegistry 的稳定桥接名称。 */
function assert_no_reserved_plugin_tools(
  source: Record<string, Tool>,
  source_name: string,
): void {
  for (const tool_name of Object.keys(source)) {
    if (RESERVED_PLUGIN_TOOL_NAMES.has(tool_name)) {
      throw new Error(`Agent tool name conflict: "${tool_name}" is reserved for PluginRegistry (${source_name})`);
    }
  }
}

/** 注册 Tool Set，并拒绝不同来源静默覆盖。 */
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

/** Agent 在一个 Workspace 中的公开执行入口。 */
export class AgentWorkspace {
  /** 拥有当前作用域的 Agent。 */
  readonly agent: AgentWorkspaceOptions["agent"];
  /** 当前 Workspace。 */
  readonly workspace: AgentWorkspaceOptions["workspace"];
  /** 当前 Workspace ID。 */
  readonly workspace_id: string;
  /** 当前 Workspace 下的 Tool 集合。 */
  readonly tools: Record<string, Tool>;
  /** 当前 Workspace Context 绑定的 Agent Plugin 调用面。 */
  readonly plugins: AgentPlugins;
  /** 当前 Workspace 下的 Session 集合。 */
  readonly sessions: AgentSessions;
  /** 当前 AgentWorkspace 内部数据根路径。 */
  readonly data_path: string;

  private readonly context: PluginContext;
  private readonly logger: Logger;
  private readonly lifecycle: AgentWorkspaceLifecycle;
  private readonly unsubscribe_env: () => void;
  private readonly unsubscribe_plugins: () => void;
  private leave_promise?: Promise<void>;

  constructor(options: AgentWorkspaceOptions) {
    this.agent = options.agent;
    this.workspace = options.workspace;
    this.workspace_id = options.workspace.id;
    const storage = this.workspace.create_agent_workspace_storage(this.agent.id);
    this.data_path = storage.root_path;
    this.logger = new Logger();
    this.logger.bind_storage(storage.files, storage.root_path);

    let contextual_plugins: AgentPlugins | undefined;
    let contextual_sessions: AgentSessions | undefined;
    this.context = create_plugin_context({
      agent_id: this.agent.id,
      workspace_id: this.workspace_id,
      workspace_path: this.workspace.path,
      data_path: this.data_path,
      files: this.workspace.files,
      data_files: storage.files,
      ...(this.workspace.shell ? { shell: this.workspace.shell } : {}),
      logger: this.logger,
      get_workspace_env: () => this.workspace.get_env(),
      get_instructions: () => this.agent.get_instructions(),
      get_plugins: () => {
        if (!contextual_plugins) throw new Error("AgentWorkspace plugins are not initialized");
        return contextual_plugins;
      },
      get_sessions: () => {
        if (!contextual_sessions) throw new Error("AgentWorkspace sessions are not initialized");
        return contextual_sessions;
      },
    });
    contextual_plugins = this.agent.plugin_registry.contextual(this.context);
    this.plugins = contextual_plugins;

    this.tools = {};
    assert_no_reserved_plugin_tools(this.workspace.tools, "WorkspaceTools");
    assert_no_reserved_plugin_tools(this.agent.custom_tools, "AgentOptions.tools");
    register_tools(this.tools, this.workspace.tools, "WorkspaceTools");
    register_tools(this.tools, this.agent.plugin_registry.tools(this.context), "PluginRegistry");
    register_tools(this.tools, this.agent.custom_tools, "AgentOptions.tools");

    this.sessions = new AgentSessions({
      agent_id: this.agent.id,
      workspace_path: this.workspace.path,
      store: storage.sessions,
      tools: this.tools,
      logger: this.logger,
      get_instruction: () => [...this.agent.get_instructions()],
      get_workspace_env: () => this.workspace.get_env(),
      get_agent_plugins: () => this.agent.plugin_registry.execution_view(this.context),
      ensure_agent_ready: async () => await this.lifecycle.ensure_ready(),
      get_agent_model: () => this.agent.model,
      session_class: this.agent.session_class,
    });
    contextual_sessions = this.sessions;

    this.unsubscribe_env = this.workspace.subscribe_env((env) => {
      this.sessions.broadcast_env({ ...env }, generate_id());
    });
    this.unsubscribe_plugins = this.agent.plugin_registry.subscribe_change((change) => {
      for (const tool_name of RESERVED_PLUGIN_TOOL_NAMES) delete this.tools[tool_name];
      register_tools(
        this.tools,
        this.agent.plugin_registry.tools(this.context),
        "PluginRegistry",
      );
      const verb = change.type === "register" ? "registered" : "unregistered";
      this.sessions.broadcast_plugins({
        command_id: generate_id(),
        title: `Agent plugin ${change.plugin_name} ${verb}`,
        plugins: this.agent.plugin_registry.execution_view(this.context),
      });
    });
    this.lifecycle = new AgentWorkspaceLifecycle(
      this.context,
      this.agent.plugin_registry,
      storage,
    );
  }

  /** 当前 Agent ID。 */
  get id(): string {
    return this.agent.id;
  }

  /** 返回当前 Workspace 的 Shell。 */
  get_shell(): Shell | undefined {
    return this.workspace.shell;
  }

  /** 返回当前 Workspace 的日志器。 */
  get_logger(): Logger {
    return this.logger;
  }

  /** 列出当前 Agent 注册的 Plugin 状态。 */
  list_plugin_states(): PluginSnapshot[] {
    return list_plugin_states({ context: this.context });
  }

  /** 将 Plugin HTTP 路由绑定到当前 Workspace Context。 */
  register_plugin_http_routes(app: Hono): void {
    register_plugin_http_routes({
      app,
      get_context: () => this.context,
      plugins: this.agent.plugin_registry.snapshots()
        .map((snapshot) => this.agent.plugin_registry.get(snapshot.name))
        .filter((plugin) => plugin !== null),
    });
  }

  /** 解析指定 Session 当前可见的完整 system messages。 */
  async resolve_system_messages(input: {
    session_id: string;
    profile?: SystemProfile;
  }): Promise<SystemModelMessage[]> {
    return await resolve_session_system_messages({
      project_root: this.workspace.path,
      session_id: input.session_id,
      profile: input.profile || "chat",
      static_system_prompts: [...this.agent.get_instructions()],
      context: this.context,
    });
  }

  /** 离开当前 Workspace 并释放其独享资源。 */
  async leave(): Promise<void> {
    this.leave_promise ??= (async () => {
      const errors: unknown[] = [];
      const cleanup_steps: Array<() => void | Promise<void>> = [
        () => this.unsubscribe_env(),
        () => this.unsubscribe_plugins(),
        () => this.sessions.dispose_title_generation(),
        async () => await this.lifecycle.dispose(),
        async () => await this.logger.save_all_logs(),
        async () => await this.workspace.dispose(),
      ];
      for (const cleanup of cleanup_steps) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      this.agent.release_workspace(this.workspace_id, this);
      if (errors.length > 0) {
        throw new AggregateError(errors, `AgentWorkspace cleanup failed: ${this.workspace_id}`);
      }
    })();
    await this.leave_promise;
  }
}
