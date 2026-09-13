/**
 * Chat 行状态的唯一图标出口。
 *
 * Agent、Group、Session 三种行都通过这里渲染状态，状态与图形的映射因此只存在一处。
 * idle 交给调用方提供常态图标（通常是省略号菜单入口）。
 */

import type { ReactNode } from "react";
import { TbAlertTriangle, TbLoader2, TbMessageQuestion } from "react-icons/tb";
import { attention_visual } from "@/lib/notification/attention";
import { chat_row_status_label_key, type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 注意力状态的图形；「有新结果」没有图形，回退为圆点，因此不依赖颜色也能区分。 */
const attention_icon = {
  action_required: TbMessageQuestion,
  failed: TbAlertTriangle,
  completed: null,
} as const;

/** 渲染一行状态的图标；idle 交给调用方的 fallback。 */
export function ChatStatusIcon({ status, fallback }: {
  /** 当前行状态。 */
  status: ChatRowStatus;
  /** idle 时展示的常态图标。 */
  fallback: ReactNode;
}) {
  const translate_chat = use_translation("chat");
  if (status === "idle") return <>{fallback}</>;

  const label = translate_chat(chat_row_status_label_key(status));
  if (status === "working") {
    return <TbLoader2 aria-label={label} className="animate-spin text-primary motion-reduce:animate-none" />;
  }
  const Icon = attention_icon[status];
  const visual = attention_visual[status];
  return Icon
    ? <Icon role="img" aria-label={label} title={label} className={cn("size-3.5", visual.icon_class)} />
    : <span role="img" aria-label={label} title={label} className={cn("size-1.5 rounded-full", visual.mark_class)} />;
}
