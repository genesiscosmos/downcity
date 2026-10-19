/**
 * Agent 会话安排与观察其他会话的运行时协议。
 *
 * 职责说明（中文）
 * - Agent 自己的会话需要「开一条活、看进展、代答、收回」，这些动作依赖 Session 集合与运行态。
 * - 工具实现只依赖本协议，不接触 AgentSessions 或 Session 内部结构。
 * - 它描述的是「一件活的完整动作」，而不是对 Session 方法逐一转发。
 *
 * 关键点（中文）
 * - 这组能力只注入 Agent 主会话和 Channel 会话，工作会话不会递归派发。
 */

import type { ListSessionMessagesInput, SessionMessagePage } from "@downcity/type";
import type { AgentArchiveSessionResult } from "./SessionTypes.js";
import type { SessionInteractionResponse } from "@downcity/type";
import type { SessionDelegationCaller, SessionDelegationInput, SessionDelegationMessage, SessionDelegationReceipt } from "./SessionDelegation.js";
import type {
  SessionCheckDetailToolOutput,
  SessionToolSummary,
} from "@/types/tools/session/SessionTools.js";

/** Agent 会话可用的会话工作运行时。 */
export interface SessionWorkContract {
  /** 开一条工作会话并立刻把任务交给它；返回时该会话可能仍在执行。 */
  spawn(input: SessionDelegationInput, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt>;

  /** 向已有工作会话追加指令；执行结果自动回传给本次调用方。 */
  send(input: SessionDelegationMessage, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt>;

  /** 列出当前 Agent 的全部工作会话摘要，按最近更新倒序。 */
  list(input?: { limit?: number }): Promise<SessionToolSummary[]>;

  /** 读取单条会话的摘要、最近消息与待响应的 Interaction。 */
  read(input: {
    /** 目标会话稳定标识。 */
    session_id: string;
    /** 返回的最近消息条数上限。 */
    limit?: number;
  }): Promise<SessionCheckDetailToolOutput>;

  /** 读取完整 canonical 历史，不受 Composer compact 检查点截断。 */
  messages(input: ListSessionMessagesInput & {
    /** 目标会话稳定标识。 */
    session_id: string;
  }): Promise<SessionMessagePage>;

  /** 归档空闲会话，由 Session 集合拥有者管理存储与索引。 */
  archive(input: {
    /** 目标会话稳定标识。 */
    session_id: string;
  }): Promise<AgentArchiveSessionResult>;

  /** 代答某条会话正在等待的用户响应。 */
  reply(input: {
    /** 目标会话稳定标识。 */
    session_id: string;
    /** 待响应的 Interaction 标识。 */
    interaction_id: string;
    /** 与原请求一致的完整结构化响应。 */
    response: SessionInteractionResponse;
  }): Promise<void>;

  /** 停止某条会话当前正在执行的 Turn。 */
  stop(input: {
    /** 目标会话稳定标识。 */
    session_id: string;
  }): Promise<void>;
}
