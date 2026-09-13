/**
 * Desktop 需要用户关注的状态词表。
 *
 * 未读通知与实时运行态共用同一套取值：一个 Turn 正阻塞等待输入（实时）和一条「等待你的输入」
 * 未读通知，对用户是同一件事。共用取值让两者可以直接合并、比较，而不需要翻译表。
 */

import type { DesktopNotificationKind } from "@common/types/DesktopNotification";

/** 用户需要关注的状态，按需要处理的程度递增。 */
export type ChatAttention = "completed" | "failed" | "action_required";

/** 注意力等级的稳定优先顺序；数值越大越需要优先展示。 */
const attention_rank: Record<ChatAttention, number> = {
  completed: 0,
  failed: 1,
  action_required: 2,
};

/**
 * 各状态的文案 key 与语义配色。
 *
 * 标记统一为实心圆，只通过颜色区分；行内标记与 Rail 圆点共用同一套取值，
 * 保证同一含义只有一种外观。可读文案始终存在并会并入 Rail 按钮名称。
 */
export const attention_visual: Record<ChatAttention, {
  /** chat 命名空间下的可读文案 key。 */
  label_key: string;
  /** 标记颜色；形状由调用方统一为实心圆。 */
  mark_class: string;
  /** 行内图标前景色。 */
  icon_class: string;
}> = {
  action_required: { label_key: "attention.needs_input", mark_class: "bg-amber-500", icon_class: "text-amber-600 dark:text-amber-400" },
  failed: { label_key: "attention.failed", mark_class: "bg-red-500", icon_class: "text-red-500 dark:text-red-400" },
  completed: { label_key: "attention.completed", mark_class: "bg-blue-500", icon_class: "text-blue-500 dark:text-blue-400" },
};

/** 把通知类型投影为注意力等级；不表达注意力的通知返回 null。 */
export function attention_from_notification_kind(kind: DesktopNotificationKind): ChatAttention | null {
  if (kind === "session_turn_waiting_input" || kind === "group_interaction_pending") return "action_required";
  if (kind === "session_turn_failed" || kind === "group_turn_failed") return "failed";
  if (kind === "session_turn_completed") return "completed";
  return null;
}

/** 在若干注意力等级中选出需要优先展示的一个；全为空时返回 null。 */
export function highest_attention(attentions: readonly (ChatAttention | null)[]): ChatAttention | null {
  let highest: ChatAttention | null = null;
  for (const attention of attentions) {
    if (attention && (!highest || attention_rank[attention] > attention_rank[highest])) highest = attention;
  }
  return highest;
}
