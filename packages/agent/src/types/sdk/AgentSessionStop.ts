/**
 * Agent Session stop 类型定义。
 *
 * 关键点（中文）
 * - `session.stop()` 用于停止当前正在执行的 turn。
 * - 尚未被当前 turn 吸收的排队 prompt 会被取消，不会自动开启下一轮。
 */

/**
 * Session stop 的最终结果。
 */
export interface AgentSessionStopResult {
  /**
   * 本次调用是否实际停止了活跃 turn 或取消了排队 prompt。
   */
  stopped: boolean;

  /**
   * 被停止的当前 turn 标识。
   *
   * 说明（中文）
   * - 当前没有活跃 turn 时不会返回该字段。
   * - 如果只是清空尚未启动的队列，也不会返回该字段。
   */
  turn_id?: string;

  /**
   * 本次 stop 取消的未绑定 prompt 数量。
   *
   * 说明（中文）
   * - 已经被当前 turn 吸收的 prompt 不计入这里，它们会随当前 turn 一起结束。
   */
  cancelled_queued_prompts: number;

  /**
   * 本次 stop 的归因。
   */
  reason: "stopped" | "idle";
}
