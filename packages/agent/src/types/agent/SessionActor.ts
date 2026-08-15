/**
 * Agent session actor 接口类型。
 *
 * 关键点（中文）
 * - 这里只描述 session 的可调用能力。
 * - session 的数据结构、history/system payload 放在 `SessionTypes.ts`。
 */

import type {
  AgentCreateSessionInput,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionConfigSnapshot,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionSetInput,
  AgentSessionSetOptions,
  AgentSessionStatus,
  AgentSessionSummaryPage,
  AgentSessionSystemSnapshot,
  RemoteSessionSetInput,
} from "@/types/agent/SessionTypes.js";
import type {
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
} from "@/types/session/SessionMutation.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionResult,
  SessionPendingInteraction,
} from "@/types/session/SessionInteraction.js";
import type {
  ListSessionMessagesInput,
  SessionMessagePage,
} from "@/types/session/SessionMessage.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionCompactHandle } from "@/types/sdk/AgentSessionCompact.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";

/**
 * SDK Session 集合入口。
 */
export interface AgentSessions<TSession extends AgentSessionActor = AgentSession> {
  /** 新建一个 session。 */
  create(input?: AgentCreateSessionInput): Promise<TSession>;

  /** 获取一个已存在的 session。 */
  get(session_id: string): Promise<TSession>;

  /** 列出当前 agent 的 session 摘要页。 */
  list(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage>;

  /** 归档单个 session。 */
  archive(input: AgentArchiveSessionInput): Promise<AgentArchiveSessionResult>;

  /** 列出已归档的 session 摘要页。 */
  archived(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult>;

  /** 永久清空已归档 session。 */
  clean_archive(): Promise<AgentCleanArchiveResult>;
}

/**
 * Session actor 公共能力。
 */
export interface AgentSessionActor {
  /** 当前 session 稳定标识。 */
  readonly id: string;

  /** 读取当前 session 详情。 */
  get_info(): Promise<AgentSessionInfo>;

  /** 追加一条新的 prompt。 */
  prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle>;

  /** 停止当前 turn，并取消尚未被吸收的排队 prompt。 */
  stop(): Promise<AgentSessionStopResult>;

  /**
   * 把一次显式历史压缩加入当前 Session 的有序输入队列。
   *
   * 关键点（中文）
   * - 返回句柄表示 Command 已成功入队。
   * - `handle.finished` 在压缩真正完成或失败后兑现。
   */
  compact(): Promise<AgentSessionCompactHandle>;

  /** 订阅当前 session 的未来事件。 */
  subscribe(
    subscriber: SessionMutationSubscriber,
  ): SessionMutationUnsubscribe;

  /** 读取当前 session messages 分页。 */
  messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage>;

  /** 读取当前 session 生效的 system 快照。 */
  system(): Promise<AgentSessionSystemSnapshot>;

  /** 列出当前 Session 正在等待用户响应的 Interaction。 */
  interactions(): Promise<SessionPendingInteraction[]>;

  /** 读取当前 Session 的运行与安全状态。 */
  status(): Promise<AgentSessionStatus>;

  /** 提交当前 Session 的 Interaction 用户响应。 */
  respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult>;
}

/**
 * 本地 Agent 返回的公开 session 接口。
 */
export interface AgentSession extends AgentSessionActor {
  /** 当前 session 所属 agent_id。 */
  readonly agent_id: string;

  /** 当前 session 配置快照。 */
  readonly config: AgentSessionConfigSnapshot;

  /** 写入当前 session 默认配置。 */
  set(input: AgentSessionSetInput, options?: AgentSessionSetOptions): Promise<void>;

  /** 修改当前 Session 的用户可见标题并发布 canonical mutation。 */
  rename(title: string): Promise<string>;

  /** 把当前 Session 首次生成后固定的完整 system 显式固化到 instruction.md。 */
  snapshot(): Promise<void>;

  /** 使用 Agent 当前 instruction 与 plugin 显式重新生成 Session system。 */
  syncshot(): Promise<void>;

  /** 从当前 session 创建一个分叉会话。 */
  fork(input?: AgentSessionForkInput | string): Promise<AgentSession>;
}

/**
 * 远程 Agent 返回的公开 session 接口。
 */
export interface RemoteAgentSession extends AgentSessionActor {
  /** 写入当前远程 Session 的可序列化动态配置。 */
  set(input: RemoteSessionSetInput, options?: AgentSessionSetOptions): Promise<void>;

  /** 从当前远程 session 创建一个分叉会话。 */
  fork(input?: AgentSessionForkInput | string): Promise<RemoteAgentSession>;
}
