/**
 * Workspace 执行上下文的内部组合对象。
 *
 * 关键点（中文）
 * - City 是 Extension 生命周期的唯一拥有者。
 * - 当前对象只组合 Workspace Tool、宿主扩展、日志与 Session 执行上下文。
 * - Session 的所有权属于 Agent.sessions；本对象只提供内部执行上下文。
 * - 它不是公开领域对象，也不是 AgentWorkspace。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { WorkspaceShell } from "@downcity/type";
import { AgentSessions } from "@/agent/AgentSessions.js";
import type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
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
import type { SessionExtensionRuntime } from "@downcity/type/session";
import { create_empty_session_extensions } from "@downcity/type/session";
import type { AgentHostExtensions } from "@/types/agent/AgentHost.js";

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
  /**
   * 当前 Workspace 的内部 Session 查询视图；实际所有权仍属于 Agent.sessions。
   * 该视图只供 City transport 和内部测试装配使用，不是新的 Session 所有者。
   */
  readonly sessions: AgentSessionCollection;
  /** 当前 Workspace 的 Session、日志和调度数据根路径。 */
  readonly data_path: string;

  private readonly logger: Logger;
  private readonly unsubscribe_env: () => void;
  private readonly unsubscribe_extensions: () => void;
  private readonly storage: AgentStorage;
  private readonly host_extensions?: AgentHostExtensions;
  /** 当前宿主 Extension 注入的 Tool 名称，用于配置变化时精确替换。 */
  private readonly extension_tool_names = new Set<string>();
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
      .catch((error) => this.logger.error("City Extension workspace startup failed", {
        error: error instanceof Error ? error.message : String(error),
      }));

    this.tools = {};
    register_tools(this.tools, this.workspace.tools, "WorkspaceTools");
    this.replace_extension_tools();
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
      workspace: async (session_id) => await this.agent.sessions.workspace(session_id, this.workspace),
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
    this.unsubscribe_extensions = host_extensions?.subscribe((change) => {
      this.replace_extension_tools();
      if (change.initial) return;
      const verb = change.type === "register" ? "registered" : "unregistered";
      (this.agent.sessions as AgentSessions).broadcast_extensions({
        command_id: generate_id(),
        title: `City extension ${change.extension_name} ${verb}`,
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
        () => this.unsubscribe_extensions(),
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

  /** 原子替换宿主 Extension 注入的 Tool 集合。 */
  private replace_extension_tools(): void {
    for (const tool_name of this.extension_tool_names) delete this.tools[tool_name];
    this.extension_tool_names.clear();
    const extension_tools = this.host_extensions?.tools(this.workspace, this.logger) ?? {};
    register_tools(this.tools, extension_tools, "HostExtensions");
    for (const tool_name of Object.keys(extension_tools)) this.extension_tool_names.add(tool_name);
  }
}
