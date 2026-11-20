/**
 * Session 构造参数类型。
 *
 * 关键点（中文）
 * - 这里描述 Agent 创建本地 Session 时传入的稳定上下文。
 * - 默认 Session 和自定义 Session 类都应使用这组参数。
 * - Composer 仍然是 Session 级能力，不向 Agent 的执行策略层泄漏。
 */

import type { ModelClient, AgentTool as Tool, ToolHookSet, WorkspaceRuntime, SessionDescriptor } from "@downcity/type";
import type { SessionChildWork } from "./SessionChildWork.js";
import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
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

  /** 仅供集合恢复同 ID 的执行资源；不改变或持久化会话归属。 */
  restore_workspace(workspace: WorkspaceRuntime): void;

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
  /** 原 Turn、接收或收尾仍需保护；包含交互等待及尚未结束的收尾，供停止和资源生命周期使用。 */
  has_live_execution(): boolean;

  /** 只读检查原 Turn 的交互运行 waiter 是否仍存在，不恢复执行器。 */
  can_respond_interaction(interaction_id: string, turn_id: string): boolean;

  /** 同步封闭新输入并校验无占用，归档期间不得再次 prompt。 */
  begin_archive(): void;
  /** 归档失败时恢复输入，成功时保持实例不可执行。 */
  finish_archive(success: boolean): void;

}

/**
 * 本地 Session 构造参数。
 */
export interface SessionOptions extends SessionDescriptor {
  /** 在任何输入初始化 await 前同步取得租约，完整 Turn 结算后释放；读取不调用。 */
  acquire_execution?: () => () => void;
  /** 当前 Agent 已授权会话的只读访问；包含归档，不恢复执行器。 */
  read_result_session?: (session_id: string, type: string) => Promise<import("@/types/store/SessionReadView.js").SessionReadView>;
  /** 专用配置存活校验；存在时禁止修改模型、Workspace、Prompt Powers 和分叉执行。 */
  assert_execution_profile?: () => void;
  /** Agent 的完成事件写前日志；在 canonical Turn 终态之前必须提交成功。 */
  completions?: SessionCompletionPort;
  /** 父 Turn 收尾前等待或取消子工作，跟随 Agent 持有的委派运行时。 */
  child_work?: SessionChildWork;
  /** 由拥有者归档 Session，并负责集合索引和存储清理。 */
  archive_session?: (session_id: string) => Promise<import("@/types/agent/SessionTypes.js").AgentArchiveSessionResult>;
  /**
   * 当前 agent 稳定标识。
   */
  agent_id: string;

  /** 当前 Agent 用户可见名称；实时读取，使重配后的身份立即进入工具与扩展调用环境。 */
  get_agent_name: () => string;

  /** 当前 Agent 一句话能力描述；实时读取，与 system 身份保持一致。 */
  get_agent_description: () => string;

  /** 创建时确定的 Workspace 归属；恢复时沿用持久化值，与资源是否装配无关。 */
  workspace_id?: string;

  /** 与归属 ID 相同的 Workspace 执行资源；省略时只恢复历史与配置。 */
  workspace?: WorkspaceRuntime;

  /** 没有 Workspace 时用于 system 快照与项目根展示的回退路径。 */
  workspace_path: string;

  /** 当前 Session 独享的领域持久化视图。 */
  store: SessionStorage;

  /** 为 fork 创建另一个 Session 的领域持久化视图。 */
  create_session_store: (session_id: string) => SessionStorage;

  /** 宿主为 fork 分配未占用的小写短 ID；独立 Session 可省略并使用随机 ID。 */
  allocate_session_id?: () => Promise<string>;

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

  /** 按当前已装配 Workspace 在每个 Step 检查点读取可用 Tool 集合；未装配时不继承默认资源。 */
  get_tools: (workspace?: WorkspaceRuntime) => Record<string, Tool>;
  /**
   * 统一日志器。
   */
  logger: Logger;

  /**
   * 当前 Session 创建时绑定的 instruction system blocks。
   *
   * 关键点（中文）
   * - Session 创建后不再动态读取 Agent instruction。
   * - `session.snapshot()` 显式持久化基础 system 快照，Composer 动态摘要不参与保存。
   */
  instruction_system_blocks: AgentSessionSystemBlock[];

  /**
   * 读取当前 Agent configured instruction system blocks。
   *
   * 关键点（中文）
   * - 仅供 `session.syncshot()` 显式重新生成 system 使用。
   * - 普通 Session 执行沿用基础 system snapshot，动态上下文由 Composer 逐步生成。
   */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];

  /** 读取当前 Session 的当前目录；未绑定时返回 undefined。 */
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
