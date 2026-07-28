/**
 * Session 显式压缩句柄与结果类型。
 *
 * `session.compact()` 返回句柄表示请求已进入有序队列；压缩真正结束后由
 * `finished` 兑现最终结果，调用方不需要从 Action Message 反推完成状态。
 */

/** Session 显式压缩的稳定结束原因。 */
export type AgentSessionCompactReason =
  | "compacted"
  | "nothing_to_compact"
  | "compact_failed";

/** 一次显式 Session 压缩的最终结果。 */
export interface AgentSessionCompactResult {
  /** 当前压缩请求的稳定标识。 */
  compact_id: string;
  /** 压缩请求是否成功完成；没有可压缩内容同样视为成功。 */
  success: boolean;
  /** 是否实际生成并提交了压缩计划。 */
  compacted: boolean;
  /** 当前请求结束的稳定原因。 */
  reason: AgentSessionCompactReason;
  /** 压缩失败时的错误文本。 */
  error?: string;
}

/** 一次显式 Session 压缩的等待句柄。 */
export interface AgentSessionCompactHandle {
  /** 当前句柄绑定的压缩请求标识。 */
  id: string;
  /** 已完成后的最终结果；`finished` 兑现前为 null。 */
  result: AgentSessionCompactResult | null;
  /** 等待压缩 Command 真正完成的 Promise。 */
  finished: Promise<AgentSessionCompactResult>;
}
