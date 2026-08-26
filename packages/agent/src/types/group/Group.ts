/**
 * Group 与 GroupSession 的公开领域类型。
 *
 * Group 是具有集体主体性的协作主体；GroupSession 保存共享消息，实际模型
 * 与工具执行始终委托给成员自己的 AgentSession。
 */

import type { WorkspaceBase } from "@downcity/workspace";
import type { Agent } from "@/agent/Agent.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";

/** Group 成员及其协作角色。 */
export interface GroupMember {
  /** 成员 Agent 的稳定标识。 */
  readonly agent: Agent;
  /** 成员在 Group 中的展示角色。 */
  readonly role?: string;
}

/** 创建 Group 的参数。 */
export interface GroupOptions {
  /** Group 的稳定标识。 */
  readonly id: string;
  /** Group 的展示名称；省略时使用 id。 */
  readonly name?: string;
  /** Group 面向成员和用户的协作目标。 */
  readonly instruction?: string;
  /** Group 成员列表。 */
  readonly members: readonly GroupMember[];
  /** 未指定执行成员时默认接收任务的 Agent。 */
  readonly coordinator_id?: string;
}

/** 创建 GroupSession 的参数。 */
export interface GroupCreateSessionOptions {
  /** 本次群组协作可选使用的 Workspace。 */
  readonly workspace?: WorkspaceBase;
}

/** GroupSession 中的一条共享消息。 */
export interface GroupMessage {
  /** 消息稳定标识。 */
  readonly id: string;
  /** 消息作者类型。 */
  readonly author_type: "user" | "agent" | "system";
  /** Agent 作者 ID；用户和系统消息没有该字段。 */
  readonly author_id?: string;
  /** 消息文本。 */
  readonly text: string;
  /** 创建时间的 Unix 毫秒时间戳。 */
  readonly created_at: number;
}

/** GroupSession 一次 prompt 的输入。 */
export interface GroupSessionPromptInput extends AgentSessionPromptInput {
  /** 指定本次响应的成员 Agent；省略时使用 coordinator 或首个成员。 */
  readonly agent_id?: string;
}

/** GroupSession 一次执行的结果。 */
export interface GroupSessionTurnResult {
  /** GroupSession turn 稳定标识。 */
  readonly turn_id: string;
  /** 实际执行的成员 Agent ID。 */
  readonly agent_id: string;
  /** 成员 Agent 最终输出文本。 */
  readonly text: string;
  /** 是否成功完成。 */
  readonly success: boolean;
  /** 失败时的错误文本。 */
  readonly error?: string;
}

/** GroupSession 一次 prompt 的等待句柄。 */
export interface GroupSessionTurnHandle {
  /** 当前 GroupSession turn 稳定标识。 */
  readonly id: string;
  /** 已完成时的结果快照；完成前为 null。 */
  readonly result: GroupSessionTurnResult | null;
  /** 等待当前 GroupSession turn 完成。 */
  readonly finished: Promise<GroupSessionTurnResult>;
}

/** GroupSession 未来共享消息订阅回调。 */
export type GroupMessageSubscriber = (message: GroupMessage) => void;

/** GroupSession 共享消息订阅取消函数。 */
export type GroupMessageUnsubscribe = () => void;

/** GroupSession 集合入口。 */
export interface GroupSessions {
  /** 创建一个属于当前 Group 的共享协作 Session。 */
  create(input?: GroupCreateSessionOptions): Promise<GroupSession>;
  /** 获取当前 Group 已创建的 Session。 */
  get(session_id: string): GroupSession | null;
  /** 列出当前 Group 的 Session 快照。 */
  list(): readonly GroupSession[];
}

/** GroupSession 公开能力。 */
export interface GroupSession {
  /** Session 稳定标识。 */
  readonly id: string;
  /** 所属 Group 稳定标识。 */
  readonly group_id: string;
  /** 本次共享协作绑定的 Workspace ID。 */
  readonly workspace_id?: string;
  /** 向 Group 发言并驱动一个成员 Agent 执行。 */
  prompt(input: GroupSessionPromptInput): Promise<GroupSessionTurnHandle>;
  /** 读取共享消息历史快照。 */
  messages(): readonly GroupMessage[];
  /** 订阅未来共享消息。 */
  subscribe(subscriber: GroupMessageSubscriber): GroupMessageUnsubscribe;
  /** 停止当前正在执行的成员 AgentSession。 */
  stop(): Promise<void>;
}
