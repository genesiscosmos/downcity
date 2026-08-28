/** Group 的公开领域类型：Group 是持续存在的群聊主体。 */

import type { Agent } from "@/agent/Agent.js";
import type { AgentModel } from "@/agent/AgentModel.js";
import type { DispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { GroupSessions } from "@/types/group/GroupSession.js";

/** 创建 Group 的参数。 */
export interface GroupOptions {
  /** Group 的稳定标识。 */
  readonly id: string;
  /** Group 的展示名称；省略时使用 id。 */
  readonly name?: string;
  /** Group 的可选协作说明。 */
  readonly instruction?: string;
  /** Group 用于理解群聊意图并选择投递成员的模型。 */
  readonly model?: AgentModel;
  /** Group 成员列表。 */
  readonly members: readonly Agent[];
  /** Group 的消息调度策略；省略时使用 Group.model 驱动的 AI 调度。 */
  readonly dispatch_strategy?: DispatchStrategy;
}

/** Group 中的一条共享消息。 */
export interface GroupMessage {
  /** 消息稳定标识。 */
  readonly id: string;
  /** 所属 Group 标识。 */
  readonly group_id: string;
  /** 消息发送者标识；用户消息使用 user，系统消息使用 system。 */
  readonly sender_id: string;
  /** 消息发送者类型。 */
  readonly sender_type: "user" | "agent" | "system";
  /** 消息正文。 */
  readonly text: string;
  /** 可选的被回复消息标识。 */
  readonly reply_to?: string;
  /** 可选的用户 GroupTurn 标识；同一用户请求产生的消息共享此标识。 */
  readonly turn_id?: string;
  /** 可选的自动调度运行标识；自动调度产生的消息使用此标识。 */
  readonly dispatch_id?: string;
  /** 可选的响应图节点标识。 */
  readonly dispatch_node_id?: string;
  /** 创建时间的 Unix 毫秒时间戳。 */
  readonly created_at: number;
}

/** Group 公开能力。 */
export interface GroupContract {
  /** Group 的稳定标识。 */
  readonly id: string;
  /** Group 的展示名称。 */
  readonly name: string;
  /** Group 的协作说明。 */
  readonly instruction?: string;
  /** Group 用于理解群聊意图并生成成员投递图的模型；未提供时首次调度会失败。 */
  readonly model?: AgentModel;
  /** Group 成员快照。 */
  readonly members: readonly Agent[];
  /** Group 使用的消息调度策略。 */
  readonly dispatch_strategy: DispatchStrategy;
  /** 当前 Group 创建的独立群聊上下文集合。 */
  readonly sessions: GroupSessions;
}
