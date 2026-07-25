/**
 * CoreEngineLoopDecision：模型/tool-loop 核心循环的纯决策模块。
 *
 * 关键点（中文）
 * - 把 “是否继续下一轮” 的分支优先级从 CoreEngine 主流程中拆出。
 * - 保持纯函数，不依赖模型、持久化或 logger，便于直接测试。
 */

import type {
  SessionLoopDecision,
  SessionLoopDecisionInput,
  SessionTailMergeContinuationInput,
} from "@/executor/types/SessionLoop.js";

/**
 * 评估当前 step 完成后，tool-loop 是否应继续下一轮。
 *
 * 优先级（中文）
 * 1. 不完整响应恢复
 * 2. 已发生的工具调用
 * 3. text-only 自动续跑
 * 4. 停止
 */
export function evaluate_core_engine_loop_decision(
  input: SessionLoopDecisionInput,
): SessionLoopDecision {
  if (
    input.hasIncompleteResponse &&
    input.incompleteRecoveryCount < input.maxIncompleteRecoveries
  ) {
    return {
      kind: "recover_incomplete",
      continueForToolCalls: false,
      continueForTextOnly: false,
      continueForIncompleteRecovery: true,
    };
  }

  if (input.toolCallCount > 0) {
    return {
      kind: "continue_for_tool_calls",
      continueForToolCalls: true,
      continueForTextOnly: false,
      continueForIncompleteRecovery: false,
    };
  }

  if (
    input.textOnlyContinuationReason !== null &&
    input.hasTools &&
    input.textOnlyContinuationCount < input.maxTextOnlyContinuations
  ) {
    return {
      kind: "continue_for_text_only",
      continueForToolCalls: false,
      continueForTextOnly: true,
      continueForIncompleteRecovery: false,
    };
  }

  return {
    kind: "stop",
    continueForToolCalls: false,
    continueForTextOnly: false,
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
