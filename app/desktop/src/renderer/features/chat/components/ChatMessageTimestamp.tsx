/** Chat 消息时间的统一展示组件。 */

import { cn } from "@/lib/utils";

/** 按消息所在日期生成紧凑时间文本。 */
export function format_chat_message_time(created_at: number): string {
  if (!Number.isFinite(created_at) || created_at <= 0) return "";
  const date = new Date(created_at);
  const now = new Date();
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const same_day = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (same_day) return time;
  const day = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date).replaceAll("/", "-");
  return `${day} ${time}`;
}

/** 以弱化样式显示消息发送时间。 */
export function ChatMessageTimestamp({ created_at, class_name }: { /** 消息创建时间戳，单位为毫秒。 */ created_at: number; /** 调整布局的附加样式。 */ class_name?: string }) {
  const label = format_chat_message_time(created_at);
  if (!label) return null;
  return <time dateTime={new Date(created_at).toISOString()} className={cn("shrink-0 text-[0.625rem] font-normal tabular-nums text-muted-foreground/60", class_name)}>{label}</time>;
}
