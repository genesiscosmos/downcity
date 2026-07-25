/**
 * AgentContext：本地 Agent 的统一执行上下文。
 *
 * 职责说明（中文）
 * - 同一 Agent 实例全程共享同一个 Context。
 * - 向 Plugin、Session 与宿主投影当前 Agent 的稳定运行时能力。
 * - Context 不复制 Agent 状态，env 与 systems 始终从唯一状态源读取。
 */

import type { AgentSessions } from "@/agent/AgentSessions.js";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { Shell } from "@downcity/shell";
import type { FileSystem } from "@/types/workspace/FileSystem.js";

/**
 * AgentContext 构造参数。
 */
interface AgentContextOptions {
  /** 当前 Agent 显式挂载的 Shell；未启用时为空。 */
  shell?: Shell;
  /** 当前 Agent 稳定标识。 */
  agent_id: string;

  /** 当前项目根目录。 */
  rootPath: string;

  /** 当前 Workspace 的统一文件能力。 */
  files: FileSystem;

  /** 当前 Agent 统一日志器。 */
  logger: Logger;

  /** 读取当前 Agent configured env。 */
  get_env: () => Readonly<Record<string, string>>;

  /** 读取当前 Agent configured systems。 */
  get_systems: () => readonly string[];

  /** 当前 Agent 直接持有的 Session 集合。 */
  sessions: AgentSessions;

  /** 当前 Agent 唯一的 Plugin 调用入口。 */
  plugins: AgentPlugins;
}

/**
 * 本地 Agent 的统一执行上下文。
 */
export class AgentContext {
  /** 当前 Agent 显式挂载的 Shell；plugin 可复用其已注入的平台 adapter。 */
  readonly shell?: Shell;
  /** 当前 Agent 稳定标识。 */
  readonly agent_id: string;

  /** 当前项目根目录。 */
  readonly rootPath: string;

  /** 当前 Workspace 的统一文件能力。 */
  readonly files: FileSystem;

  /** 当前 Agent 统一日志器。 */
  readonly logger: Logger;

  /** 当前 Agent configured env 读取器。 */
  private readonly get_env: AgentContextOptions["get_env"];

  /** 当前 Agent configured systems 读取器。 */
  private readonly get_systems: AgentContextOptions["get_systems"];

  /** 当前 Agent 直接持有的 Session 集合。 */
  readonly sessions: AgentSessions;

  /** 当前 Agent 唯一的 Plugin 调用入口。 */
  readonly plugins: AgentPlugins;

  constructor(options: AgentContextOptions) {
    this.shell = options.shell;
    this.agent_id = options.agent_id;
    this.rootPath = options.rootPath;
    this.files = options.files;
    this.logger = options.logger;
    this.get_env = options.get_env;
    this.get_systems = options.get_systems;
    this.sessions = options.sessions;
    this.plugins = options.plugins;
  }

  /**
   * 读取 Agent 已配置的 env。
   *
   * 关键点（中文）
   * - Session step 的 effective env 由 Plugin action 参数 `run_context.agentEnv` 显式提供。
   * - 该 getter 不根据异步调用链隐式切换结果。
   */
  get env(): Readonly<Record<string, string>> {
    return this.get_env();
  }

  /**
   * 读取 Agent 已配置的 instruction。
   */
  get systems(): readonly string[] {
    return this.get_systems();
  }
}
