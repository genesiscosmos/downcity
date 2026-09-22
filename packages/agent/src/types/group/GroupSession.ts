/** GroupSession 的公开领域类型：一次 Group 的独立群聊上下文。 */

import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { GroupMessage } from "@/types/group/Group.js";
import type { Agent } from "@/agent/Agent.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { RespondSessionInteractionInput, SessionInteractionRequest } from "@downcity/type";

/** Group 成员运行态。 */
export interface GroupMemberRuntime {
  /** 成员 Agent 标识。 */
  readonly agent_id: string;
  /** 当前是否正在执行。 */
  readonly running: boolean;
}

/** Group 运行阶段。 */
export type GroupStatusPhase = "idle" | "dispatching" | "dispatched" | "executing" | "stopped" | "failed";

/** GroupSession 的统一实时事件。 */
export type GroupEvent =
  | { /** 事件类型。 */ readonly type: "message"; /** 新增的共享消息。 */ readonly message: GroupMessage }
  | { /** 事件类型。 */ readonly type: "title"; /** 当前 GroupSession 最新的 canonical 标题。 */ readonly title: string }
  | { /** 事件类型。 */ readonly type: "interaction"; /** 发起交互的成员 Agent。 */ readonly agent_id: string; /** 成员 Session 的交互请求。 */ readonly request: SessionInteractionRequest }
  | { /** 事件类型。 */ readonly type: "status"; /** 当前群聊轮次。 */ readonly turn_id?: string; /** 当前轮次对应的消息标识。 */ readonly message_id?: string; /** 当前运行阶段。 */ readonly phase: GroupStatusPhase; /** Dispatch 完成后实际接受消息的成员标识。 */ readonly dispatched_member_ids?: readonly string[]; /** 成员运行态快照。 */ readonly members: readonly GroupMemberRuntime[] };

/** Group 事件订阅回调。 */
export type GroupEventSubscriber = (event: GroupEvent) => void | Promise<void>;

/** 取消 Group 消息订阅。 */
export type GroupEventUnsubscribe = () => void;

/** GroupSession 接收一条用户消息后的异步调度回执。 */
export interface GroupPromptResult {
  /** 当前用户消息对应的 GroupTurn 标识。 */
  readonly turn_id: string;
  /** 用户消息是否已经成功写入并开始调度；不代表成员已经完成回复。 */
  readonly success: boolean;
  /** 回执生成时共享消息总数。 */
  readonly message_count: number;
}

/** 向 GroupSession 发言的输入。 */
export interface GroupPromptInput {
  /** 用户消息正文。 */
  readonly query: string;
}

/** GroupSession 列表使用的轻量摘要，不加载消息历史。 */
export interface GroupSessionSummary {
  /** GroupSession 稳定标识。 */
  readonly id: string;
  /** 所属 Group 稳定标识。 */
  readonly group_id: string;
  /** 首次创建时间戳。 */
  readonly created_at: number;
  /** 最近更新时间戳。 */
  readonly updated_at: number;
  /** 已持久化消息数量。 */
  readonly message_count: number;
  /** 当前 GroupSession 绑定的 Workspace 标识。 */
  readonly workspace_id?: string;
  /** 当前 GroupSession 持久化的用户可见标题。 */
  readonly title?: string;
  /** 最后一条消息的用户可见预览。 */
  readonly preview_text?: string;
}

/** GroupSession 的创建输入；第一阶段不允许调用方指定 session_id。 */
export interface GroupSessionCreateInput {
  /** 当前群聊使用的 Workspace；省略时使用内存执行上下文。 */
  readonly workspace?: WorkspaceRuntime;
}

/** 恢复 GroupSession 时的上下文输入。 */
export interface GroupSessionGetInput {
  /** 当前群聊使用的 Workspace；必须与持久化 metadata 一致。 */
  readonly workspace?: WorkspaceRuntime;
}

/** GroupSession 列表过滤条件。 */
export interface GroupSessionListInput {
  /** 只返回绑定到指定 Workspace 的群聊上下文。 */
  readonly workspace_id?: string;
}

/**
 * 归档一个 GroupSession 的结果。
 *
 * 归档是一次**目录搬迁**（活动区 → 归档区），不是打标记：
 * 它让「活动列表」天然只含活动项，不需要在每次查询里过滤。
 */
export interface GroupSessionArchiveResult {
  /** 被归档的 GroupSession 标识。 */
  readonly session_id: string;
  /** 归档发生的时间戳。 */
  readonly archived_at: number;
}

/** 列出已归档 GroupSession 的过滤条件。 */
export interface GroupSessionArchiveListInput {
  /** 只返回绑定到指定 Workspace 的归档群聊。 */
  readonly workspace_id?: string;
}

/** 清空归档后的结果。 */
export interface GroupSessionCleanArchiveResult {
  /** 被永久删除的归档 GroupSession 标识。 */
  readonly removed_session_ids: readonly string[];
}

/** GroupSession 公开能力。 */
export interface GroupSessionContract {
  /** 当前群聊上下文的稳定标识。 */
  readonly id: string;
  /** 所属 Group 的稳定标识。 */
  readonly group_id: string;
  /** 当前 GroupSession 绑定的 Workspace ID；未绑定时为空。 */
  readonly workspace_id?: string;
  /** 修改当前 GroupSession 的 canonical 用户可见标题。 */
  rename(title: string): Promise<string>;
  /** 立即追加用户消息并开始异步群聊调度。 */
  prompt(input: GroupPromptInput): Promise<GroupPromptResult>;
  /** 读取共享消息事实快照。 */
  messages(): Promise<readonly GroupMessage[]>;
  /** 订阅共享消息。 */
  subscribe(subscriber: GroupEventSubscriber): GroupEventUnsubscribe;
  /** 响应成员 Agent Session 当前等待的 Interaction。 */
  respond_interaction(input: RespondSessionInteractionInput): Promise<void>;
  /** 停止当前传播和成员执行；停止完成后可再次 prompt。 */
  stop(): Promise<void>;
  /** 释放当前上下文，不再接受新的 prompt。 */
  dispose(): Promise<void>;
}

/** GroupSession 的公开实例类型。 */
export interface GroupSession extends GroupSessionContract {}

/** GroupSession 集合公开能力。 */
export interface GroupSessions {
  /** 创建一个新的群聊上下文，标识由集合内部生成。 */
  create(input?: GroupSessionCreateInput): Promise<GroupSession>;
  /** 从 Storage 恢复当前 Group 的一个群聊上下文。 */
  get(session_id: string, input?: GroupSessionGetInput): Promise<GroupSession | null>;
  /** 从 Storage 恢复当前 Group 的全部群聊上下文（不含已归档）。 */
  list(input?: GroupSessionListInput): Promise<readonly GroupSessionSummary[]>;
  /** 释放并移除指定群聊上下文。 */
  remove(session_id: string, input?: GroupSessionGetInput): Promise<GroupSession | null>;
  /**
   * 归档指定群聊上下文：从活动区迁入归档区。
   *
   * 与 `remove` 的区别是**可逆性**：归档只是收起来，数据仍在归档区；
   * 而 `remove` 是永久删除。因此正在执行的群聊不能归档（先停再归档）。
   */
  archive(session_id: string): Promise<GroupSessionArchiveResult>;
  /** 列出已归档的群聊上下文摘要。 */
  archived(input?: GroupSessionArchiveListInput): Promise<readonly GroupSessionSummary[]>;
  /** 永久清空当前 Group 的全部归档。 */
  clean_archive(): Promise<GroupSessionCleanArchiveResult>;
  /**
   * 永久删除当前 Group 的全部群聊数据（活动区 + 归档区）。
   *
   * 它服务于「Group 被删除」：Group 是群聊的**所有者**，所有者消失时它拥有的数据
   * 不该继续存在。与 `dispose` 的区别：那个只释放运行时实例，数据仍在磁盘上。
   */
  purge(): Promise<void>;
}

/** GroupSession 的内部依赖快照。 */
export interface GroupSessionRuntimeContext {
  /** 当前 Group 的成员。 */
  readonly members: readonly Agent[];
  /** 当前 Group 的协作说明。 */
  readonly instruction?: string;
  /** 当前 Group 的消息调度策略。 */
  readonly dispatch_strategy: import("@/types/group/DispatchStrategy.js").DispatchStrategy;
  /** 当前 Group 的稳定标识。 */
  readonly group_id: string;
  /** 当前 Group 的展示名称。 */
  readonly group_name: string;
}

/** 当前群聊上下文中由 Agent 持有的成员 Session。 */
export type GroupMemberSession = AgentSession;

/** GroupSession 内部维护的一次用户请求运行记录。 */
export interface GroupTurnRuntime {
  /** 用户请求对应的 GroupTurn 标识。 */
  readonly turn_id: string;
  /** 用户根消息标识。 */
  readonly root_message_id: string;
  /** 用户消息写入时冻结的上下文消息标识。 */
  readonly context_message_ids: readonly string[];
  /** 当前 Turn 位于初始用户调度还是自动传播阶段。 */
  dispatch_stage: "user" | "auto";
  /** 当前 GroupTurn 的异步 user dispatch。 */
  user_dispatch?: Promise<void>;
  /** 当前 GroupTurn 是否等待 GroupSession 的 auto dispatch。 */
  auto_pending: boolean;
  /** 当前 GroupTurn 是否已经停止或失败。 */
  stopped: boolean;
  /** 当前 GroupTurn 是否由持久化检查点恢复，只等待统一 auto dispatch 收口。 */
  readonly recovered?: boolean;
}
