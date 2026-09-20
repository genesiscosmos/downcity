/**
 * Session 构造参数类型。
 *
 * 关键点（中文）
 * - 这里描述 Agent 创建本地 Session 时传入的稳定上下文。
 * - 默认 Session 和自定义 Session 类都应使用这组参数。
 * - Composer 仍然是 Session 级能力，不向 Agent 的执行策略层泄漏。
 */

import type { ModelClient, AgentTool as Tool, ToolHookSet, WorkspaceRuntime } from "@downcity/type";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionOrigin } from "@downcity/type";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";

/**
 * Agent 可管理的本地 Session 实例。
 */
export interface AgentManagedSession extends AgentSession {
  /**
   * 初始化当前 session。
   */
  initialize(): Promise<this>;

  /**
   * 返回供宿主运行时使用的 Session 端口。
   */
  get_runtime_port(): SessionPort;

  /** 取消并释放当前 Session 的标题后台任务。 */
  dispose_title_generation?(): void;

  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing(): boolean;

}

/**
 * 本地 Session 构造参数。
 */
export interface SessionOptions {
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /** 当前 Agent 用户可见名称；进入工具与扩展的调用环境。 */
  agent_name: string;

  /** 当前 Agent 一句话能力描述；进入工具与扩展的调用环境。 */
  agent_description: string;

  /** 当前 Session 所属 Workspace 的绝对根目录。 */
  workspace_path: string;

  /** 当前 Session 创建时绑定的 Workspace 稳定标识；未传 Workspace 时为空。 */
  workspace_id?: string;

  /** 当前 Session 的创建来源与物理存储分区。 */
  origin: SessionOrigin;

  /** 当前 Session 独享的领域持久化视图。 */
  store: SessionStorage;

  /** 为 fork 创建另一个 Session 的领域持久化视图。 */
  create_session_store: (session_id: string) => SessionStorage;

  /**
   * 将 fork 创建的子 Session 交回 AgentSessions 登记。
   *
   * 关键点（中文）
   * - Session 只负责创建子实例，AgentSessions 仍是运行时实例的唯一所有者。
   * - 登记后再通过 `sessions.get()` 读取时，必须返回同一实例。
   */
  register_forked_session: (session: AgentManagedSession) => void;

  /**
   * 当前 session_id。
   */
  session_id: string;

  /** 在每个 Step 检查点读取当前可用 Tool 集合。 */
  get_tools: () => Record<string, Tool>;

  /**
   * 统一日志器。
   */
  logger: Logger;

  /**
   * 当前 Session 创建时绑定的 instruction system blocks。
   *
   * 关键点（中文）
   * - Session 创建后不再动态读取 Agent instruction。
   * - `session.snapshot()` 会把首次生成后固定的完整 system 显式写入本地文件。
   */
  instruction_system_blocks: AgentSessionSystemBlock[];

  /**
   * 读取当前 Agent configured instruction system blocks。
   *
   * 关键点（中文）
   * - 仅供 `session.syncshot()` 显式重新生成 system 使用。
   * - 普通 Session 执行仍使用首次生成后固定的 system snapshot。
   */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];

  /**
   * 读取当前 Workspace configured env。
   *
   * 关键点（中文）
   * - 每个 Step 在检查点读取一次并形成不可变快照。
   */
  get_workspace_env: () => Record<string, string>;

  /** 读取当前 Session 绑定的 Workspace 实例；未绑定时返回 undefined。 */
  get_workspace: () => WorkspaceRuntime | undefined;

  /** 在每个 Step 检查点读取当前生效的扩展处理器集合。 */
  get_hooks: () => ToolHookSet;


  /** 读取 Agent 当前持有的运行时模型实例。 */
  get_agent_model: () => ModelClient | undefined;

  /**
   * 当前 Session 使用的 Composer。
   *
   * 关键点（中文）：由 Agent 传入并在其所有 Session 间共享，因此实现必须无状态。
   */
  composer?: SessionComposer;
}
