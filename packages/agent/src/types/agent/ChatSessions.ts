/**
 * 主对话安排与观察其他会话的运行时协议。
 *
 * 职责说明（中文）
 * - 主对话需要「开一条活、看进展、代答、收回」，这些动作需要 Agent 集合与运行态。
 * - 工具实现只依赖本协议，不接触 AgentSessions 或 Session 内部结构。
 *
 * 关键点（中文）
 * - 协议按「一件活的完整动作」定义，而不是按 Session 方法逐一转发。
 */

import type { SessionInteractionResponse, WorkspaceRuntime } from "@downcity/type";
import type {
  SessionCheckDetailToolOutput,
  SessionToolSummary,
} from "@/types/tools/chat/SessionTools.js";

/** 主对话可用的会话工作运行时。 */
export interface ChatSessionWorkContract {
  /** 开一条会话并立刻把任务交给它；返回时该会话可能仍在执行。 */
  spawn(input: {
    /** 交给新会话的完整任务文本。 */
    query: string;
    /** 可选短标题，用于清单展示。 */
    title?: string;
    /** 新会话的初始目录；省略时使用 Agent 默认目录。 */
    workspace?: WorkspaceRuntime;
  }): Promise<{ session_id: string }>;

  /** 列出当前 Agent 除主对话外的全部会话摘要，按最近更新倒序。 */
  list(input?: { limit?: number }): Promise<SessionToolSummary[]>;

  /** 读取单条会话的摘要、最近消息与待响应的 Interaction。 */
  read(input: {
    /** 目标会话稳定标识。 */
    session_id: string;
    /** 返回的最近消息条数上限。 */
    limit?: number;
  }): Promise<SessionCheckDetailToolOutput>;

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
