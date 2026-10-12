/** Group 的公开领域类型：持续存在的群聊主体与共享消息。 */

import type { Agent } from "@/agent/Agent.js";
import type { DispatchStrategy, GroupDecisionModel } from "@/types/group/DispatchStrategy.js";
import type { GroupSessions } from "@/types/group/GroupSession.js";

/** 创建 Group 的参数。 */
export interface GroupOptions {
  /** Group 的稳定标识。 */
  readonly id: string;
  /** 展示名称；省略时使用 id。 */
  readonly name?: string;
  /** 可选的协作目标。 */
  readonly instruction?: string;
  /** 选择每轮并行回复成员的决策客户端。 */
  readonly model?: GroupDecisionModel;
  /** 参与协作的 Agent 列表。 */
  readonly members: readonly Agent[];
  /** 自定义成员选择策略；省略时使用决策模型。 */
  readonly dispatch_strategy?: DispatchStrategy;
}

/** 群聊中的一条共享消息。 */
export interface GroupMessage {
  /** 消息稳定标识。 */
  readonly id: string;
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 发送者标识；用户使用 user，系统使用 system。 */
  readonly sender_id: string;
  /** 发送者类型。 */
  readonly sender_type: "user" | "agent" | "system";
  /** 消息正文。 */
  readonly text: string;
  /** 被回复的消息标识。 */
  readonly reply_to?: string;
  /** 初始用户请求的运行标识。 */
  readonly turn_id?: string;
  /** 产生本条回复的成员选择运行标识。 */
  readonly dispatch_id?: string;
  /** 创建时间的 Unix 毫秒时间戳。 */
  readonly created_at: number;
}

/** Group 的公开能力。 */
export interface GroupContract {
  /** 群聊稳定标识。 */
  readonly id: string;
  /** 展示名称。 */
  readonly name: string;
  /** 可选协作目标。 */
  readonly instruction?: string;
  /** 选择本轮成员的决策客户端。 */
  readonly model?: GroupDecisionModel;
  /** 当前成员快照。 */
  readonly members: readonly Agent[];
  /** 当前成员选择策略。 */
  readonly dispatch_strategy: DispatchStrategy;
  /** 当前 Group 的独立会话集合。 */
  readonly sessions: GroupSessions;
}
