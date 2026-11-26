/**
 * 默认 Group 用户轮的空闲兜底规则。
 *
 * 只在空闲输入要求回应且无人通过双阈值时选择一位。以双因子较低值排序，
 * 同分保持传入的成员配置顺序。选择与审计验证共用此规则，不覆盖原始模型因子。
 */
import type { DispatchMemberDecision } from "@/types/group/DispatchStrategy.js";

/** 返回需要兜底的成员 ID；没有兜底资格或已有阈值达标成员时返回 undefined。 */
export function find_idle_fallback_member(
  decisions: readonly DispatchMemberDecision[],
  require_response: boolean,
): string | undefined {
  if (!require_response || decisions.some((decision) => decision.trigger === "user"
    && decision.relevance.true_probability > 0.5 && decision.response_need.true_probability > 0.5)) return undefined;
  let best_member_id: string | undefined;
  let best_score = -1;
  for (const decision of decisions) {
    if (decision.trigger !== "user") continue;
    const score = Math.min(decision.relevance.true_probability, decision.response_need.true_probability);
    if (score > best_score) {
      best_score = score;
      best_member_id = decision.agent_id;
    }
  }
  return best_member_id;
}
