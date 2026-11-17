/** SessionCommandCompletion 的窄依赖契约；字段只表达命令执行所需能力。 */
import type { SessionCommandCompletion } from "@/types/session/SessionCommand.js";
import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** 完成信息持久化所需的消息与诊断能力。 */
export interface SessionCommandCompletionInput {
  /** 命令声明的完成内容。 */ completion: SessionCommandCompletion;
  /** 当前执行身份；空闲维护命令可以省略。 */ turn_id?: string;
  /** 所属 Session 身份。 */ session_id: string;
  /** canonical 消息唯一拥有者。 */ messages: SessionMessages;
  /** 只记录诊断的日志器。 */ logger: Logger;
}
