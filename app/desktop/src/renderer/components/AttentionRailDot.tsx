/**
 * Rail 一级导航上的未读圆点；由调用方负责绝对定位与描边。
 *
 * 只通过颜色区分注意力等级；可读文案会并入 Rail 按钮名称，是颜色之外的信息来源。
 */

import { attention_visual, type ChatAttention } from "@/lib/notification/attention";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 只表达存在未读的圆点，不承载行内状态图形。 */
export function AttentionRailDot({ attention, class_name }: {
  /** 需要表达的注意力等级。 */
  attention: ChatAttention;
  /** 调用方提供的定位与描边类名。 */
  class_name?: string;
}) {
  const translate_chat = use_translation("chat");
  const visual = attention_visual[attention];
  const label = translate_chat(visual.label_key);
  return <span role="img" aria-label={label} title={label} className={cn("absolute size-1.5 rounded-full", visual.mark_class, class_name)} />;
}
