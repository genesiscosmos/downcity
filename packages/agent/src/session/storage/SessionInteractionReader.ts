/**
 * canonical Tool 交互的纯投影。
 * 从调用方提供的消息筛选 pending 项，构造带 Agent 路由的独立引用快照；
 * 不打开数据库、不恢复执行器，也不依赖物理存储布局。
 */
import type { SessionAgentInteraction, SessionMessage, SessionDescriptor } from "@downcity/type";
import type { AgentInteraction } from "@/types/agent/AgentInteractions.js";
import { normalize_session_descriptor } from "@downcity/type";

/** 为原交互构造当前 Agent 内可验证的公开引用，返回独立快照。 */
export function project_agent_interaction(
  session_id: string,
  session_type: string,
  interaction: SessionAgentInteraction,
  can_respond = false,
  descriptor?: SessionDescriptor,
): AgentInteraction {
  return {
    ...(descriptor ? normalize_session_descriptor(descriptor) : {}),
    reference: {
      session_type,
      session_id,
      turn_id: interaction.request.turn_id,
      interaction_id: interaction.interaction_id,
    },
    interaction: structuredClone(interaction),
    can_respond,
  };
}

/** 只投影 canonical Tool 中真正 pending 的 Interaction。 */
export function collect_pending_interactions(
  messages: readonly SessionMessage[],
): SessionAgentInteraction[] {
  return messages.flatMap((message) => message.role === "agent"
    ? message.parts.flatMap((part) => part.type === "tool"
      ? (part.interactions ?? []).filter((interaction) => interaction.status === "pending")
      : []) : []);
}
