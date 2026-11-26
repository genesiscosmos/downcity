/**
 * Session runtime 端口类型。
 *
 * 职责说明（中文）
 * - 定义宿主 transport 与 Agent 内部运行时访问单个 Session 的稳定协议。
 * - 不暴露具体 Session class，也不包含 Session 集合管理能力。
 */

import type { SessionAgentContent, SessionUserContent, SessionMessage, SessionMutationSubscriber, SessionMutationUnsubscribe, SessionDescriptor } from "@downcity/type";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";

/**
 * 单个 Session 实例端口。
 */
export interface SessionPort extends SessionDescriptor {
  /** 当前 Session 稳定标识。 */
  readonly id: string;

  /** 当前执行项目标识；切换工作区后读取最新值。 */
  readonly workspace_id?: string;

  /** 读取全部 canonical Session Message。 */
  messages(): Promise<SessionMessage[]>;

  /** 向当前 Session actor 追加一条新的 prompt。 */
  prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle>;

  /** 停止当前 turn，并取消尚未被吸收的排队 prompt。 */
  stop(expected_turn_id?: string, expected_message?: import("@downcity/type").SessionMessageCheckpoint): Promise<AgentSessionStopResult>;

  /** 订阅当前 Session 后续产生的 future 事件。 */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe;

  /**
   * 追加一条 user 消息。
   */
  append_user_message(params: {
    /** 已构造好的 User 内容。 */
    parts?: SessionUserContent[];
    /** 未传入结构化内容时使用的文本。 */
    text?: string;
  }): Promise<void>;

  /**
   * 追加一条 Agent 消息。
   */
  append_agent_message(params: {
    /** 已构造好的 Agent 内容。 */
    parts?: SessionAgentContent[];
    /** 未传入结构化内容时使用的文本。 */
    text?: string;
  }): Promise<void>;

  /** 返回当前 Session 是否正在执行。 */
  is_executing(): boolean;
}
