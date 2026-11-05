/**
 * Notification Power 的稳定身份规则。目标身份独立于 Workspace 和任意 JSON 路由；
 * Interaction 始终使用原 Agent、分区、Session、Turn、Interaction 五段引用。
 */
import { z } from "zod";
import type { PowerNotificationTarget } from "@downcity/city/power";
import type { NotificationInteractionItem } from "./types/NotificationRenderer.js";

/** 目标边界只接受当前明确协议，不将任意旧路由解释成 Session 身份。 */
export const notification_target_schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent_session"), agent_id: z.string().min(1), category: z.enum(["chat", "work"]), session_id: z.string().min(1), origin_type: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("group_session"), group_id: z.string().min(1), session_id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("power"), power_id: z.string().min(1), route: z.record(z.string(), z.json()) }).strict(),
]);

/** 业务目标比较只使用已声明的身份字段。Power 路由不承担 Session 身份。 */
export function notification_target_key(target: PowerNotificationTarget): string {
  if (target.kind === "agent_session") return JSON.stringify([target.kind, target.agent_id, target.category, target.session_id]);
  if (target.kind === "group_session") return JSON.stringify([target.kind, target.group_id, target.session_id]);
  return JSON.stringify([target.kind, target.power_id]);
}

/** 原始交互引用是跨消费者去重的唯一依据。 */
export function notification_interaction_key(item: NotificationInteractionItem): string {
  const reference = item.interaction.reference;
  return JSON.stringify([item.agent_id, reference.session_category, reference.session_id, reference.turn_id, reference.interaction_id]);
}

