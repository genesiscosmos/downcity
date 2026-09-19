/**
 * Session Turn 收口领域函数的依赖类型。
 *
 * 这些依赖只覆盖 canonical Message、Mutation、Hook 与资源释放，不包含 Queue 或
 * Executor，避免 Turn 结果提交反向理解调度过程。
 */

import type { SessionEventHub } from "@/session/messages/SessionEventHub.js";
import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** Turn 收口函数的稳定依赖。 */
export interface SessionTurnCompletionOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的 canonical Message 入口。 */
  messages: SessionMessages;
  /** 当前 Session 的 Mutation 发布入口。 */
  events: SessionEventHub;
  /** 当前 Session 的统一日志器。 */
  logger: Logger;
  /** Turn 停止时对外使用的稳定错误文本。 */
  stopped_message: string;
}
