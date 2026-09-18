/**
 * SessionExecutorLoopDecision：模型/tool-loop 循环的纯决策模块。
 *
 * 关键点（中文）
 * - 把“是否继续下一轮”的分支优先级从执行器主流程中拆出。
 * - 保持纯函数，不依赖模型、持久化或 logger，便于直接测试。
 */

/**
 * 单轮 loop 决策输入。
 */
export interface SessionLoopDecisionInput {
  /** 当前 step 是否检测到了不完整响应。 */
  hasIncompleteResponse: boolean;
  /** 当前已经执行过多少次不完整响应恢复。 */
  incompleteRecoveryCount: number;
  /** 允许执行的不完整响应恢复上限。 */
  maxIncompleteRecoveries: number;
  /** 当前 step 实际产出的工具调用数量。 */
  toolCallCount: number;
}

/**
 * 单轮 loop 决策结果。
 */
export interface SessionLoopDecision {
  /** 本轮命中的主决策类型。 */
  kind:
    | "recover_incomplete"
    | "continue_for_tool_calls"
    | "stop";
  /** 是否因为工具调用而继续下一轮。 */
  continueForToolCalls: boolean;
  /** 是否因为不完整响应恢复而继续下一轮。 */
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
  /** stop 前最后一次 tail merge 实际合并到的 user message 数量。 */
  mergedUserMessageCount: number;
}

/**
 * 评估当前 step 完成后，tool-loop 是否应继续下一轮。
 *
 * 优先级（中文）
 * 1. 不完整响应恢复
 * 2. 已发生的工具调用
 * 3. 停止
 */
export function evaluate_executor_loop_decision(
  input: SessionLoopDecisionInput,
): SessionLoopDecision {
  if (
    input.hasIncompleteResponse &&
    input.incompleteRecoveryCount < input.maxIncompleteRecoveries
  ) {
    return {
      kind: "recover_incomplete",
      continueForToolCalls: false,
      continueForIncompleteRecovery: true,
    };
  }

  if (input.toolCallCount > 0) {
    return {
      kind: "continue_for_tool_calls",
      continueForToolCalls: true,
      continueForIncompleteRecovery: false,
    };
  }

  return {
    kind: "stop",
    continueForToolCalls: false,
    continueForIncompleteRecovery: false,
  };
}

/**
 * 评估 stop 前的尾部合并是否应该继续下一轮。
 *
 * 关键点（中文）
 * - 只要最后一次 tail merge 真正并入了新的 user 消息，就必须续跑。
 * - 这样可以覆盖“最后一个 step 结束后，新消息才到达”的收尾窗口。
 */
export function should_continue_for_tail_merged_user_messages(
  input: SessionTailMergeContinuationInput,
): boolean {
  return input.mergedUserMessageCount > 0;
}
