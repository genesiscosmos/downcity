/**
 * Power Action 的交互执行面。
 *
 * 关键点（中文）
 * - 所有 Action 入口都必须拿到交互端口：Session 入口传自身端口，其余入口传拒绝式实现。
 * - 无 Session 的入口（定时任务、HTTP、RPC）需要用户参与时得到明确失败，
 *   而不是静默执行或永久挂起。
 * - 审批模式与决定解释不在本模块：它们属于 `ApprovalInteraction`，由 Session 注入。
 */

import type {
  SessionInteractionHandle,
  SessionInteractionPort,
  SessionInteractionRequestInput,
} from "@downcity/type";

/** 无 Session 入口的稳定拒绝原因。 */
function no_session_error(action: string): Error {
  return new Error(
    `Power action "${action}" requires user interaction, but no Session is attached to this call`,
  );
}

/**
 * 创建无 Session 调用的拒绝式交互端口。
 *
 * 关键点（中文）
 * - 这是定时任务、HTTP 与 RPC 入口的默认执行面：无人在场时不提供隐式授权。
 * - 拒绝发生在发起交互之前，因此不会产生无人响应的 pending Interaction。
 * - 不提供 `approval`：需要审批的动作会因此明确失败，而不是被静默放行。
 */
export function create_denied_interaction_port(
  action_label: string,
): SessionInteractionPort {
  return {
    async request(_input: SessionInteractionRequestInput): Promise<SessionInteractionHandle> {
      throw no_session_error(action_label);
    },
  };
}
