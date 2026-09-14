/** User 与 Agent Message 共用的紧凑图标操作按钮。 */

import type { ReactNode } from "react";

/** Message 操作按钮的统一视觉样式。 */
export const message_action_button_class_name = "group/message-action flex size-6 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]";

/** 消息下方带可访问名称的图标按钮。 */
export function MessageActionButton({ title, disabled, on_click, children }: { /** 操作提示与可访问名称。 */ title: string; /** 是否禁用。 */ disabled?: boolean; /** 执行动作。 */ on_click(): void; /** 操作图标。 */ children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={on_click} className={message_action_button_class_name} title={title} aria-label={title}>{children}</button>;
}
