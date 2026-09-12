/**
 * Desktop 未读通知在 Renderer 中的注意力等级投影。
 *
 * 未读本身只说明「有变化」，注意力等级说明「为什么需要你」。Sidebar 各层级据此选择
 * 图形与颜色，聚合时始终取最需要处理的一个，避免把「等待输入」淹没在「已完成」里。
 */

import type { DesktopNotificationKind } from "@common/types/DesktopNotification";

/** 未读通知表达的用户注意力等级，按需要处理的程度递增。 */
export type UnreadAttention = "completed" | "failed" | "action_required";

/** 注意力等级的稳定优先顺序；数值越大越需要优先展示。 */
const attention_rank: Record<UnreadAttention, number> = {
  completed: 0,
  failed: 1,
  action_required: 2,
};

/** 各注意力等级在 Sidebar 中使用的文案 key 与语义配色。 */
export const unread_attention_visual: Record<UnreadAttention, {
  /** chat 命名空间下的可读文案 key。 */
  label_key: string;
  /** 圆点背景色。 */
  dot_class: string;
  /** 图标前景色。 */
  icon_class: string;
}> = {
  action_required: { label_key: "conversation.unread_action_required", dot_class: "bg-amber-500", icon_class: "text-amber-600 dark:text-amber-400" },
  failed: { label_key: "conversation.unread_failed", dot_class: "bg-red-500", icon_class: "text-red-500 dark:text-red-400" },
  completed: { label_key: "conversation.unread_result", dot_class: "bg-blue-500", icon_class: "text-blue-500 dark:text-blue-400" },
};

/** 把通知类型投影为注意力等级；不表达注意力的通知返回 null。 */
export function attention_from_notification_kind(kind: DesktopNotificationKind): UnreadAttention | null {
  if (kind === "session_turn_waiting_input" || kind === "group_interaction_pending") return "action_required";
  if (kind === "session_turn_failed" || kind === "group_turn_failed") return "failed";
  if (kind === "session_turn_completed") return "completed";
  return null;
}

/** 在若干注意力等级中选出需要优先展示的一个；全为空时返回 null。 */
export function highest_attention(attentions: readonly (UnreadAttention | null)[]): UnreadAttention | null {
  let highest: UnreadAttention | null = null;
  for (const attention of attentions) {
    if (attention && (!highest || attention_rank[attention] > attention_rank[highest])) highest = attention;
  }
  return highest;
}
