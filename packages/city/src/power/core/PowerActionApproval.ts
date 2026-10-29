/**
 * Power Action 的审批执行面。
 *
 * 关键点（中文）
 * - `access` 只描述读写代价，是否真的停下来问由 `PowerAction.approval` 决定。
 * - 审批走调用方注入的 `interactions.approval`，动作实现不读取审批模式，也不自己发起交互。
 * - 所有入口都提供交互端口：无 Session 的入口由 `PowerCall` 注入拒绝式实现，而它不提供
 *   `approval`，因此「无人在场」不需要单独分支：缺少审批端口时一律明确失败，不静默放行。
 * - 审批必须归属到真实的模型工具调用；缺失 `tool_call_id` 时不放行，也不生成 pending Interaction。
 */

import type { PowerActionResult } from "@/power/index.js";
import type { PowerCallSite } from "@/power/index.js";
import type { JsonValue, SessionApprovalRequestInput } from "@downcity/type";
import { redact_public_value } from "./PowerPrivateValues.js";

/** 一次拒绝审批的稳定结果；放行时返回 undefined。 */
export type PowerActionApprovalDenial = PowerActionResult<JsonValue>;

/** 构造拒绝结果；`success: false` 且错误文本同时进入 `error` 与 `message`。 */
function denial(message: string): PowerActionApprovalDenial {
  return { success: false, error: message, message };
}

/**
 * 为一次声明了 `approval` 的 Action 调用请求审批。
 *
 * 关键点（中文）
 * - 返回 `undefined` 表示放行，调用方继续执行。
 * - 返回结果表示拒绝，调用方直接把它当作本次 Action 的最终结果。
 */
export async function request_power_action_approval(input: {
  /** 当前 Power 稳定名称，即模型侧工具名。 */
  readonly power_name: string;
  /** 当前 Action 稳定名称。 */
  readonly action_name: string;
  /** Action 说明，作为审批展示文本。 */
  readonly description?: string;
  /** 已通过 schema 校验的真实调用输入。 */
  readonly payload: JsonValue;
  /** 本次调用的来源身份。 */
  readonly site: PowerCallSite;
}): Promise<PowerActionApprovalDenial | undefined> {
  const action_label = `${input.power_name}.${input.action_name}`;
  // 拒绝式交互端口只有 request、没有 approval，因此这里同时覆盖「无 Session 入口」
  // 与「入口未接入审批」两种情况。
  const approval = input.site.interactions?.approval;
  if (!approval) {
    return denial(
      `Power action "${action_label}" requires approval, but this call provides no approval port.`,
    );
  }
  // 审批归属到真实 Tool Part，因此不能用一个本地合成的标识顶替。
  const tool_call_id = String(input.site.tool_call_id || "").trim();
  if (!tool_call_id) {
    return denial(
      `Power action "${action_label}" requires approval, but this call has no Tool Call identity.`,
    );
  }

  let approved = false;
  try {
    const decision = await approval.request(redact_public_value<SessionApprovalRequestInput>({
      turn_id: input.site.turn_id ?? "",
      tool_call_id,
      tool_name: action_label,
      source_type: "tool",
      ...(input.description ? { description: input.description } : {}),
      payload: { operation: "tool", validated_input: input.payload },
    }, input.site.interactions));
    approved = decision.approved;
  } catch (error) {
    // 交互端口在无人在场或上游失败时会抛错，统一收敛为明确的未获批准。
    return denial(
      `Power action "${action_label}" was not approved: ${
        redact_public_value(error instanceof Error ? error.message : String(error), input.site.interactions)
      }`,
    );
  }

  if (!approved) {
    return denial(`Power action "${action_label}" was not approved by the user.`);
  }
  return undefined;
}
