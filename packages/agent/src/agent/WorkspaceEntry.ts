/**
 * Workspace 执行上下文的内部组合对象。
 *
 * 关键点（中文）
 * - City 是 Plugin 生命周期与 Registry 的唯一拥有者。
 * - 当前对象只组合 Workspace Tool、City 扩展、日志与 Session 执行上下文。
 * - Session 的所有权属于 Agent.sessions；本对象只提供内部执行上下文。
 * - 它不是公开领域对象，也不是 AgentWorkspace。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { Hono } from "hono";
import type { WorkspaceShell } from "@downcity/workspace";
import { AgentSessions } from "@/agent/AgentSessions.js";
import type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
import type { AgentPluginRuntime } from "@/types/plugin/PluginRuntime.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { WorkspaceEntryOptions } from "@/types/agent/WorkspaceEntryOptions.js";
import { Logger } from "@/utils/logger/Logger.js";
import { generate_id } from "@/utils/Id.js";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import {
  resolve_session_system_messages,
  type SystemProfile,
} from "@/executor/composer/system/default/SystemDomain.js";
import {
  agent_has_host,
  agent_host_extensions,
  get_agent_storage,
  release_workspace_entry,
} from "@/internal/AgentRuntime.js";
import type { SessionExtensionRuntime } from "@/types/session/SessionExtension.js";
import { create_empty_session_extensions } from "@/types/session/SessionExtension.js";
import type { AgentHostExtensions } from "@/types/agent/AgentHost.js";

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

/** Agent 在一个 Workspace 中的内部执行上下文。 */
export class WorkspaceEntry {
  /** 拥有当前作用域的 Agent。 */
  readonly agent: WorkspaceEntryOptions["agent"];
  /** 当前 Workspace。 */
  readonly workspace: WorkspaceEntryOptions["workspace"];
  /** 当前 Workspace ID。 */
  readonly workspace_id: string;
  /** 当前 Workspace 下的 Tool 集合。 */
  readonly tools: Record<string, Tool>;
  /** 当前 Workspace Context 绑定的 Agent Plugin 调用面。 */
  readonly plugins: AgentPluginRuntime;
  /**
   * 当前 Workspace 的内部 Session 查询视图；实际所有权仍属于 Agent.sessions。
   * 该视图只供 City transport 和内部测试装配使用，不是新的 Session 所有者。
   */
  readonly sessions: AgentSessionCollection;
  /** 当前 Workspace 的 Session、日志和调度数据根路径。 */
  readonly data_path: string;

  private readonly logger: Logger;
  private readonly unsubscribe_env: () => void;
  private readonly unsubscribe_plugins: () => void;
  private readonly storage: AgentStorage;
  private readonly host_extensions?: AgentHostExtensions;
  private leave_promise?: Promise<void>;

  constructor(options: WorkspaceEntryOptions) {
    this.agent = options.agent;
    this.workspace = options.workspace;
    this.workspace_id = options.workspace.id;
    const storage: AgentStorage = get_agent_storage(this.agent);
    this.storage = storage;
    this.data_path = storage.root_path;
    if (!agent_has_host(this.agent)) {
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

    const host_extensions = agent_host_extensions(this.agent);
    this.host_extensions = host_extensions;
    void host_extensions?.ensure_workspace_ready(this.workspace, this.logger)
      .catch((error) => this.logger.error("City Plugin workspace startup failed", {
        error: error instanceof Error ? error.message : String(error),
      }));
    this.plugins = host_extensions?.plugins(this.workspace, this.logger)
      ?? create_empty_agent_plugins();

    this.tools = {};
    assert_no_reserved_plugin_tools(this.workspace.tools, "WorkspaceTools");
    assert_no_reserved_plugin_tools(this.agent.custom_tools, "AgentOptions.tools");
    register_tools(this.tools, this.workspace.tools, "WorkspaceTools");
    register_tools(
      this.tools,
      host_extensions?.tools(this.workspace, this.logger) ?? {},
      "CityPlugins",
    );
    register_tools(this.tools, this.agent.custom_tools, "AgentOptions.tools");

    this.sessions = {
      create: async (input) => await this.agent.sessions.create({ ...(input || {}), workspace: this.workspace }),
      get: async (session_id, origin_type, input) => await this.agent.sessions.get(
        session_id,
        origin_type,
        { ...(input || {}), workspace: this.workspace },
      ),
      list: async (input) => await this.agent.sessions.list({ ...(input || {}), workspace_id: this.workspace_id }),
      archive: async (input) => {
        await this.agent.sessions.get(input.id, input.origin_type, { workspace: this.workspace });
        return await this.agent.sessions.archive(input);
      },
      archived: async (input) => await this.agent.sessions.archived({ ...(input || {}), workspace_id: this.workspace_id }),
      clean_archive: async () => await this.agent.sessions.clean_archive(),
      runtime: (session_id, origin_type) => this.agent.sessions.runtime(session_id, origin_type),
      list_executing_session_ids: () => (this.agent.sessions as AgentSessions).list_executing_session_ids(this.workspace_id),
      remove: async (session_id, origin_type) => {
        await this.agent.sessions.get(session_id, origin_type, { workspace: this.workspace });
        return await this.agent.sessions.remove(session_id, origin_type);
      },
      clear_messages: async (session_id, origin_type) => {
        await this.agent.sessions.get(session_id, origin_type, { workspace: this.workspace });
        return await this.agent.sessions.clear_messages(session_id, origin_type);
      },
    };

    this.unsubscribe_env = this.workspace.subscribe_env((env) => {
      (this.agent.sessions as AgentSessions).broadcast_env(
        { ...env },
        generate_id(),
        this.workspace_id,
      );
    });
    this.unsubscribe_plugins = host_extensions?.subscribe((change) => {
      for (const tool_name of RESERVED_PLUGIN_TOOL_NAMES) delete this.tools[tool_name];
      register_tools(
        this.tools,
        host_extensions.tools(this.workspace, this.logger),
        "CityPlugins",
      );
      if (change.initial) return;
      const verb = change.type === "register" ? "registered" : "unregistered";
      (this.agent.sessions as AgentSessions).broadcast_extensions({
        command_id: generate_id(),
        title: `City plugin ${change.plugin_name} ${verb}`,
        extensions: host_extensions.execution_runtime(this.workspace, this.logger),
        workspace_id: this.workspace_id,
      });
    }) ?? (() => {});
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
    return agent_host_extensions(this.agent)?.snapshots() ?? [];
  }

  /** 将 Plugin HTTP 路由绑定到当前 Workspace Context。 */
  register_plugin_http_routes(app: Hono): void {
    agent_host_extensions(this.agent)?.register_http_routes(app, this.workspace, this.logger);
  }

  /** 解析指定 Session 当前可见的完整 system messages。 */
  async resolve_system_messages(input: {
    session_id: string;
    profile?: SystemProfile;
  }): Promise<SessionSystemMessage[]> {
    return await resolve_session_system_messages({
      project_root: this.workspace.path,
      session_id: input.session_id,
      profile: input.profile || "chat",
      static_system_prompts: [...this.agent.get_instructions()],
      extensions: this.get_extensions(),
    });
  }

  /** 离开当前 Workspace 并释放 Agent 独享的执行资源。 */
  async leave(): Promise<void> {
    this.leave_promise ??= (async () => {
      const errors: unknown[] = [];
      const cleanup_steps: Array<() => void | Promise<void>> = [
        () => this.unsubscribe_env(),
        () => this.unsubscribe_plugins(),
        async () => await (this.agent.sessions as AgentSessions).stop_executing_sessions(this.workspace_id),
        () => (this.agent.sessions as AgentSessions).dispose_title_generation(this.workspace_id),
        async () => await this.logger.save_all_logs(),
        async () => await this.host_extensions?.release_workspace(this.workspace_id),
        ...(agent_has_host(this.agent) ? [] : [async () => await this.workspace.dispose()]),
      ];
      for (const cleanup of cleanup_steps) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      release_workspace_entry(this.agent, this.workspace_id, this);
      if (errors.length > 0) {
        throw new AggregateError(errors, `WorkspaceEntry cleanup failed: ${this.workspace_id}`);
      }
    })();
    await this.leave_promise;
  }

  /** 返回单个 Session 创建所需的 Workspace 执行上下文。 */
  get_session_context(): {
    workspace_path: string;
    workspace_id: string;
    logger: Logger;
    tools: Record<string, Tool>;
    get_workspace_env: () => Record<string, string>;
    get_extensions: () => SessionExtensionRuntime;
    store: AgentStorage["sessions"];
  } {
    return {
      workspace_path: this.workspace.path,
      workspace_id: this.workspace_id,
      logger: this.logger,
      tools: this.tools,
      get_workspace_env: () => this.workspace.get_env(),
      get_extensions: () => this.get_extensions(),
      store: this.storage.sessions,
    };
  }

  /** 返回当前 Workspace 在 City 检查点上的最新扩展运行时。 */
  private get_extensions(): SessionExtensionRuntime {
    return this.host_extensions?.execution_runtime(this.workspace, this.logger)
      ?? create_empty_session_extensions();
  }
}

/** 创建没有 City Plugin 的只读空调用面。 */
function create_empty_agent_plugins(): AgentPluginRuntime {
  const runtime = create_empty_session_extensions();
  return {
    has: () => false,
    get: () => null,
    status: () => null,
    snapshots: () => [],
    list: () => [],
    read: () => ({ plugins: [] }),
    availability: async () => ({ enabled: false, available: false, reasons: ["Plugin is not available without City"] }),
    run_action: async () => ({ success: false, error: "Plugin is not available without City" }),
    system_blocks: runtime.system_blocks,
    pipeline: runtime.pipeline,
    guard: async () => {},
    effect: runtime.effect,
    resolve: async () => { throw new Error("Plugin resolve is not available without City"); },
  };
}
