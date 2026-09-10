/** User 与 Agent Message 共用的紧凑图标操作按钮。 */

import type { ReactNode } from "react";

/** Message 操作按钮的统一视觉样式。 */
export const message_action_button_class_name = "group/message-action flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]";

/** 消息下方带可访问名称的图标按钮。 */
export function MessageActionButton({ title, disabled, on_click, children }: { /** 操作提示与可访问名称。 */ title: string; /** 是否禁用。 */ disabled?: boolean; /** 执行动作。 */ on_click(): void; /** 操作图标。 */ children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={on_click} className={message_action_button_class_name} title={title} aria-label={title}>{children}</button>;
}
