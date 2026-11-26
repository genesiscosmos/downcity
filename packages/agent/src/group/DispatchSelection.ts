/**
 * Group 默认调度的确定性空闲兜底规则。
 *
 * 只在所有用户因子均未通过双门槛时比较较弱因子，平分保留成员配置顺序。
 * 策略和审计校验共用此规则；本模块不生成、修改或补造模型因子。
 */
import type { DispatchMemberDecision, DispatchMemberProfile } from "@/types/group/DispatchStrategy.js";

/** 返回无人过门槛时的最佳成员；调用方负责确认本批次具备空闲兜底资格。 */
export function select_idle_fallback_member(
  decisions: readonly DispatchMemberDecision[],
  members: readonly DispatchMemberProfile[],
): string | undefined {
  const by_id = new Map(decisions.map((decision) => [decision.agent_id, decision]));
  let best_id: string | undefined;
  let best_score = -Infinity;
  for (const member of members) {
    const decision = by_id.get(member.agent_id);
    if (!decision || decision.trigger !== "user") continue;
    const score = Math.min(decision.relevance.true_probability, decision.response_need.true_probability);
    if (score > 0.5) return undefined;
    if (score > best_score) {
      best_id = member.agent_id;
      best_score = score;
    }
  }
  return best_id;
}
