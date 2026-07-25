/**
 * contact 核心类型。
 *
 * 关键点（中文）
 * - 一个 contact 表示一个已确认的点对点 agent 关系。
 * - 每个 contact 固定拥有一条长期 chat history，不额外暴露 session 管理概念。
 */

/**
 * contact 当前关系状态。
 */
export type ContactStatus = "trusted" | "blocked";

/**
 * contact 当前可达方向。
 */
export type ContactReachability = "inbound" | "outbound" | "bidirectional";

/**
 * agent contact 记录。
 */
export interface AgentContact {
  /**
   * contact 稳定标识。
   */
  id: string;
  /**
   * 对方 agent 的展示名称。
   */
  name: string;
  /**
   * 对方 agent 的 HTTP endpoint；仅 inbound contact 可以为空。
   */
  endpoint: string | null;
  /**
   * 当前 agent 与对方 agent 的可达方向。
   */
  reachability: ContactReachability;
  /**
   * 当前关系状态。
   */
  status: ContactStatus;
  /**
   * 本 agent 调用对方时携带的 token；仅 inbound contact 可以为空。
   */
  outboundToken: string | null;
  /**
   * 对方调用本 agent 时必须携带的 token hash；仅 outbound contact 可以为空。
   */
  inboundTokenHash: string | null;
  /**
   * contact 创建时间戳。
   */
  created_at: number;
  /**
   * 最近一次成功通信时间戳。
   */
  lastSeenAt?: number;
}

/**
 * contact chat 消息角色。
 */
export type ContactChatMessageRole = "local" | "remote";

/**
 * contact 长期对话历史中的单条消息。
 */
export interface ContactChatMessage {
  /**
   * 消息角色。
   */
  role: ContactChatMessageRole;
  /**
   * 消息正文。
   */
  text: string;
  /**
   * 消息创建时间戳。
   */
  created_at: number;
}
