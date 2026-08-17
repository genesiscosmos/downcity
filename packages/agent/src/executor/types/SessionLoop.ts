/**
 * Session tool-loop 决策相关类型。
 *
 * 关键点（中文）
 * - 这里只描述“是否继续下一轮”的纯决策输入/输出。
 * - 不携带 runtime 实例，方便在测试中直接做纯函数验证。
 */

/**
 * 单轮 loop 决策输入。
 */
export interface SessionLoopDecisionInput {
  /**
   * 当前 step 是否检测到了不完整响应。
   */
  hasIncompleteResponse: boolean;

  /**
   * 当前已经执行过多少次不完整响应恢复。
   */
  incompleteRecoveryCount: number;

  /**
   * 允许执行的不完整响应恢复上限。
   */
  maxIncompleteRecoveries: number;

  /**
   * 当前 step 实际产出的工具调用数量。
   */
  toolCallCount: number;
}

/**
 * 单轮 loop 决策结果。
 */
export interface SessionLoopDecision {
  /**
   * 本轮命中的主决策类型。
   */
  kind:
    | "recover_incomplete"
    | "continue_for_tool_calls"
    | "stop";

  /**
   * 是否因为工具调用而继续下一轮。
   */
  continueForToolCalls: boolean;

  /**
   * 是否因为不完整响应恢复而继续下一轮。
   */
  continueForIncompleteRecovery: boolean;
}

/**
 * stop 分支上的尾部消息续跑判定输入。
 *
 * 关键点（中文）
 * - 用于处理“最后一个 step 结束后，恰好又有新的 user 消息写入”的窗口。
 * - 这里只关心是否真的合并到了新增 user message，不关心消息内容细节。
 */
export interface SessionTailMergeContinuationInput {
  /**
   * stop 前最后一次 tail merge 实际合并到的 user message 数量。
   */
  mergedUserMessageCount: number;
}
