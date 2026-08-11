/**
 * Chat TUI Session 订阅资源的内部类型。
 *
 * 类型只描述订阅初始化所需的快照和依赖，不复制 Session 的持久化协议。
 */

import type {
  AgentSessionSecurityStatus,
  RemoteAgent,
  SessionMessage,
  SessionMutation,
  SessionPendingInteraction,
} from "@downcity/agent";

/** 当前 Session 完成初始化时交给 TUI 的 canonical 快照。 */
export interface ChatSessionSnapshot {
  /** 快照所属 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的可读标题。 */
  title: string;
  /** 当前 Session 已接受的模型可读名称。 */
  model_label?: string;
  /** 当前 Session 的完整可见与内部 Message 快照。 */
  messages: SessionMessage[];
  /** 当前 Session configured 与 effective 审批模式。 */
  security: AgentSessionSecurityStatus;
  /** 读取快照时 Session 是否正在执行 Turn。 */
  is_executing: boolean;
  /** 当前 Session 尚未进入终态的 Interaction。 */
  interactions: SessionPendingInteraction[];
}

/** ChatSessionSubscription 的构造依赖。 */
export interface ChatSessionSubscriptionOptions {
  /** TUI 生命周期内唯一的远程 Agent 客户端。 */
  remote_agent: RemoteAgent;
  /** 完整快照已读取且准备替换 TUI 状态时调用。 */
  on_snapshot: (snapshot: ChatSessionSnapshot) => void;
  /** 快照完成后的实时 Mutation 或初始化期间的缓冲 Mutation。 */
  on_mutation: (mutation: SessionMutation) => void;
}
