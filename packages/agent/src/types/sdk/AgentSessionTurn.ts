/**
 * Agent Session turn 句柄与结果类型定义。
 *
 * 关键点（中文）
 * - `session.prompt()` 返回的是“已绑定到某个 turn”的句柄，而不是一次性文本结果。
 * - 同一个 turn 可以吸收多条 prompt，因此多个 prompt 可能返回相同 `id` 的 turn handle。
 * - 增量过程继续通过 `session.subscribe()` 观察；turn handle 只负责等待最终完成结果。
 */

/**
 * 单个 Session turn 的最终结果。
 */
export interface AgentSessionTurnResult {
  /**
   * 当前已完成 turn 的稳定标识。
   */
  turn_id: string;

  /**
   * 当前 turn 最终可见文本。
   */
  text: string;

  /**
   * 当前 turn 是否成功结束。
   */
  success: boolean;

  /**
   * 当前 turn 失败时的错误文本。
   */
  error?: string;
}

/**
 * 单个 Session turn 的等待句柄。
 */
export interface AgentSessionTurnHandle {
  /**
   * 当前句柄绑定到的 turn_id。
   *
   * 说明（中文）
   * - `prompt()` 只有在确定当前输入被并入哪个 turn 后才会返回。
   * - 因此这里总是最终可用的 turn_id，而不是临时 receipt id。
   */
  id: string;

  /**
   * 当前 turn 已完成后的最终结果快照。
   *
   * 说明（中文）
   * - 在 `finished` 兑现之前这里为 `null`。
   * - 兑现之后会变成与 `finished` 相同的最终结果对象。
   */
  result: AgentSessionTurnResult | null;

  /**
   * 等待当前 turn 完成的 Promise。
   *
   * 关键点（中文）
   * - 这里无论 turn 成功还是失败都会 resolve。
   * - 调用方应读取返回结果中的 `success` / `error` 判断最终状态。
   */
  finished: Promise<AgentSessionTurnResult>;
}
