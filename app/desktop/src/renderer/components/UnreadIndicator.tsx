/**
 * Sidebar 未读注意力指示器。
 *
 * 「需要处理」和「执行失败」用图形表达，「有新结果」保持圆点：颜色之外还有形状差异，
 * 因此不依赖颜色也能区分，并且都带有可读的无障碍标签。
 */

import { TbAlertTriangle, TbMessageQuestion } from "react-icons/tb";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import { unread_attention_visual, type UnreadAttention } from "@/lib/notification/unread_attention";

/** 注意力等级对应的图形；「有新结果」没有图形，回退为圆点。 */
const attention_icon = {
  action_required: TbMessageQuestion,
  failed: TbAlertTriangle,
  completed: null,
} as const;

/** 行内未读指示器，用于 Session 行与主体行的操作按钮位置。 */
export function UnreadIndicator({ attention }: {
  /** 需要表达的注意力等级。 */
  attention: UnreadAttention;
}) {
  const translate_chat = use_translation("chat");
  const visual = unread_attention_visual[attention];
  const label = translate_chat(visual.label_key);
  const Icon = attention_icon[attention];
  if (!Icon) {
    return <span role="img" aria-label={label} title={label} className={cn("size-1.5 rounded-full", visual.dot_class)} />;
  }
  return <Icon role="img" aria-label={label} title={label} className={cn("size-3.5", visual.icon_class)} />;
}

/** Rail 一级导航上的未读圆点；由调用方负责绝对定位与描边。 */
export function UnreadRailDot({ attention, class_name }: {
  /** 需要表达的注意力等级。 */
  attention: UnreadAttention;
  /** 调用方提供的定位与描边类名。 */
  class_name?: string;
}) {
  const translate_chat = use_translation("chat");
  const visual = unread_attention_visual[attention];
  const label = translate_chat(visual.label_key);
  return <span role="img" aria-label={label} title={label} className={cn("absolute size-1.5 rounded-full", visual.dot_class, class_name)} />;
}
