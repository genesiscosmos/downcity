/**
 * Session 构造参数类型。
 *
 * 关键点（中文）
 * - 这里描述 Agent 创建本地 Session 时传入的稳定上下文。
 * - 默认 Session 和自定义 Session 类都应使用这组参数。
 * - Composer 仍然是 Session 级能力，不向 Agent 的执行策略层泄漏。
 */

import type { Tool } from "ai";
import type { AgentModel } from "@/agent/AgentModel.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { AgentPluginExecutionRuntime } from "@/types/plugin/PluginRuntime.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionDataStore } from "@/types/store/SessionDataStore.js";

/**
 * Agent 可管理的本地 Session 实例。
 */
export interface AgentManagedSession extends AgentSession {
  /**
   * 初始化当前 session。
   */
  initialize(): Promise<this>;

  /**
   * 返回供 plugin/runtime 使用的 session 端口。
   */
  get_runtime_port(): SessionPort;

  /** 取消并释放当前 Session 的标题后台任务。 */
  dispose_title_generation?(): void;

  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing(): boolean;

  /** 把 Workspace env 快照加入当前 Session 的有序输入队列。 */
  enqueue_workspace_env(input: {
    /** 当前 Workspace env 修改的稳定标识。 */
    command_id: string;
    /** 下一 Session Step 使用的完整环境变量快照。 */
    env: Record<string, string>;
  }): void;

  /** 把 Agent Plugin 执行视图加入当前 Session 的有序输入队列。 */
  enqueue_agent_plugins(input: {
    /** 当前 Plugin 修改的稳定标识。 */
    command_id: string;
    /** 当前 Plugin 修改的用户可读标题。 */
    title: string;
    /** 下一 Session Step 使用的 Plugin 执行视图。 */
    plugins: AgentPluginExecutionRuntime;
  }): void;
}

/**
 * 本地 Session 构造参数。
 */
export interface SessionOptions {
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /** 当前 Session 所属 Workspace 的绝对根目录。 */
  workspace_path: string;

  /** 当前 Session 独享的领域持久化视图。 */
  store: SessionDataStore;

  /** 为 fork 创建另一个 Session 的领域持久化视图。 */
  get_session_store: (session_id: string) => SessionDataStore;

  /**
   * 当前 session_id。
   */
  session_id: string;

  /**
   * 当前 agent 默认工具集合。
   */
  tools: Record<string, Tool>;

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
   * - Session 创建时用它建立初始 effective env。
   * - 后续 Workspace env 修改通过 Session command 在 step 检查点执行。
   */
  get_workspace_env: () => Record<string, string>;

  /** 创建当前 Agent configured plugin 的 Session step 执行视图。 */
  get_agent_plugins: () => AgentPluginExecutionRuntime;

  /**
   * 读取当前 agent 显式注入的受托管 plugin system blocks。
   */
  get_managed_plugin_system_blocks: () => Promise<AgentSessionSystemBlock[]>;

  /**
   * 在执行前确保当前 session 已完成宿主侧默认配置。
   */
  ensure_configured?: (session: AgentManagedSession) => Promise<void>;

  /** 读取 Agent 当前持有的运行时模型实例。 */
  get_agent_model: () => AgentModel | undefined;

  /** 当前 Session 使用的统一执行策略；省略时使用默认 Composer。 */
  composer?: SessionComposer;
}
