/**
 * Session 的只读持久化视图，供跨会话观察使用。
 * 不暴露写入、执行恢复或生命周期变更能力。
 */
import type { ListSessionMessagesInput, SessionInteractionRequest, SessionMessagePage } from "@downcity/type";
import type { SessionHistoryMeta } from "./SessionHistoryMeta.js";

/** 当前 Agent 已有会话的历史读取能力。 */
export interface SessionReadView {
  /** 此视图精确引用的不可变记录 UUID，与同逻辑 ID 的新活动记录不混用。 */
  session_id: string;
  /** 已校验 Agent、分类和 Session 身份的元信息快照。 */
  metadata: SessionHistoryMeta;
  /** 目标是否位于归档区，读取不会恢复为活动会话。 */
  archived: boolean;
  /** 独立读取该记录的持久化配置，不恢复执行器。 */
  configuration(): Promise<import("./SessionReadConfiguration.js").SessionReadConfiguration>;
  /** 按 canonical sequence 分页读取消息，不受上下文压缩影响。 */
  messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage>;
  /** 读取尚未处理的持久化交互，仅提供信息，不授予答复权限。 */
  interactions(): Promise<SessionInteractionRequest[]>;
}
