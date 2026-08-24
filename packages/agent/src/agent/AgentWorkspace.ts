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
import type { WorkspaceShell } from "@downcity/workspace";
import { AgentSessions } from "@/agent/AgentSessions.js";
import { create_plugin_context } from "@/plugin/core/PluginContext.js";
import { register_plugin_http_routes } from "@/plugin/core/PluginHttpRoutes.js";
import { list_plugin_states } from "@/plugin/core/PluginStateController.js";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { AgentWorkspaceOptions } from "@/types/agent/AgentWorkspaceOptions.js";
import { Logger } from "@/utils/logger/Logger.js";
import { generate_id } from "@/utils/Id.js";
import { MemoryFileSystem } from "@/workspace/store/MemoryFileSystem.js";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import {
  resolve_session_system_messages,
  type SystemProfile,
} from "@/executor/composer/system/default/SystemDomain.js";
import { agent_city, agent_is_in_city, get_agent_storage, agent_storage_scope, release_agent_workspace } from "@/internal/AgentRuntime.js";

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
  /** 当前 Workspace 的 Session、日志和调度数据根路径。 */
  readonly data_path: string;

  private readonly context: PluginContext;
  private readonly logger: Logger;
  private readonly unsubscribe_env: () => void;
  private readonly unsubscribe_plugins: () => void;
  private readonly storage: AgentStorage;
  private readonly plugin_contexts = new Map<string, PluginContext>();
  private leave_promise?: Promise<void>;

  constructor(options: AgentWorkspaceOptions) {
    this.agent = options.agent;
    this.workspace = options.workspace;
    this.workspace_id = options.workspace.id;
    const storage: AgentStorage = get_agent_storage(this.agent);
    this.storage = storage;
    this.data_path = storage.root_path;
    if (!agent_is_in_city(this.agent)) {
      this.workspace.shell?.bind({
        root_path: this.workspace.path,
        // 无 City 时内部状态仍在内存；Shell 的审批/临时文件必须落在真实项目根目录。
        data_path: this.workspace.path,
      });
    }
    this.logger = new Logger();
    this.logger.bind_storage(storage.files, storage.root_path, {
      agent_id: this.agent.id,
      workspace_id: this.workspace_id,
    });

    let contextual_plugins: AgentPlugins | undefined;
    let contextual_sessions: AgentSessions | undefined;
    const context_input = {
      agent_id: this.agent.id,
      workspace_id: this.workspace_id,
      workspace_path: this.workspace.path,
      data_path: this.data_path,
      files: this.workspace.files,
      data_files: storage.files,
      ...(this.workspace.shell ? { shell: this.workspace.shell } : {}),
      logger: this.logger,
      city: agent_city(this.agent),
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
    } satisfies Parameters<typeof create_plugin_context>[0];
    this.context = create_plugin_context(context_input);
    this.agent.plugin_registry.bind_workspace_context(
      this.context,
      (plugin_name) => this.get_plugin_context(plugin_name, context_input),
    );
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
      workspace_id: this.workspace_id,
      on_session_routed: (session_id, sessions) => this.agent.register_session_route(session_id, sessions),
      ensure_agent_ready: async () => await this.agent.ensure_ready(),
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
  }

  /** 当前 Agent ID。 */
  get id(): string {
    return this.agent.id;
  }

  /** 返回当前 Workspace 的 Shell。 */
  get_shell(): WorkspaceShell | undefined {
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
      get_context: (plugin_name) => this.agent.plugin_registry.plugin_context(this.context, plugin_name),
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

  /** 离开当前 Workspace 并释放 Agent 独享的执行资源。 */
  async leave(): Promise<void> {
    this.leave_promise ??= (async () => {
      const errors: unknown[] = [];
      const cleanup_steps: Array<() => void | Promise<void>> = [
        () => this.unsubscribe_env(),
        () => this.unsubscribe_plugins(),
        async () => await this.sessions.stop_executing_sessions(),
        () => this.sessions.dispose_title_generation(),
        async () => await this.logger.save_all_logs(),
        ...(agent_is_in_city(this.agent) ? [] : [async () => await this.workspace.dispose()]),
      ];
      for (const cleanup of cleanup_steps) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      this.agent.unregister_session_routes(this.sessions);
      release_agent_workspace(this.agent, this.workspace_id, this);
      this.agent.plugin_registry.unbind_workspace_context(this.context);
      if (errors.length > 0) {
        throw new AggregateError(errors, `AgentWorkspace cleanup failed: ${this.workspace_id}`);
      }
    })();
    await this.leave_promise;
  }

  /** 返回当前 Workspace 的 PluginContext，供 Agent 级调度器解析执行上下文。 */
  get_context(): PluginContext {
    return this.context;
  }

  /** 返回指定 Plugin 的 Agent 级运行时 Context。 */
  private get_plugin_context(
    plugin_name: string,
    input: Parameters<typeof create_plugin_context>[0],
  ): PluginContext {
    const key = String(plugin_name || "").trim();
    const existing = this.plugin_contexts.get(key);
    if (existing) return existing;
    const agent_scope = agent_storage_scope(this.agent);
    const plugin_scope = agent_scope
      ? this.agent.city!.storage.open_scope(["agents", this.agent.id, "plugins", key])
      : MemoryFileSystem.shared(`/memory/agents/${this.agent.id}/plugins/${key}`);
    const plugin_files = "files" in plugin_scope ? plugin_scope.files : plugin_scope;
    const context = create_plugin_context({
      ...input,
      data_path: plugin_scope.root_path,
      data_files: plugin_files,
    });
    this.plugin_contexts.set(key, context);
    return context;
  }
}
