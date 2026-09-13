/**
 * Chat 行内操作菜单入口按钮。
 *
 * 状态图标、无障碍名称与显隐规则都收在这里：显隐规则来自 chat_row_status，状态名称并入按钮
 * 名称——按钮的 aria-label 会覆盖子树，不并入则读屏用户听不到「等待你的输入」。
 *
 * 必须转发 ref 与其余属性：本组件只渲染 Button 本身，调用方通过
 * `<DropdownMenuTrigger asChild><RowMenuButton /></DropdownMenuTrigger>` 传入，Base UI 会在
 * 这个元素上合并自己的 onClick 与 ref。丢弃它们会让触发器既收不到点击、也拿不到锚点元素，
 * 表现为菜单完全打不开。
 */

import * as React from "react";
import { TbDots } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { ChatStatusIcon } from "@/components/ChatStatusIcon";
import { chat_row_status_label_key, chat_row_trigger_class_name, type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 行内操作入口属性。 */
interface RowMenuButtonProps extends Omit<React.ComponentPropsWithoutRef<typeof Button>, "size" | "title"> {
  /** 菜单动作名称；行状态会作为补充并入无障碍名称。 */
  label: string;
  /** 当前行状态；不表达状态的普通行保持默认 idle。 */
  status?: ChatRowStatus;
}

/**
 * 行内唯一的菜单入口按钮。
 *
 * 点击先交给外部触发器（展开/收起菜单），再阻止冒泡，避免同时触发所在行的选择行为。
 */
export const RowMenuButton = React.forwardRef<HTMLButtonElement, RowMenuButtonProps>(
  function RowMenuButton({ label, status = "idle", className, onClick, ...props }, ref) {
    const translate_chat = use_translation("chat");
    const status_label = status === "idle" ? null : translate_chat(chat_row_status_label_key(status));
    const accessible_label = [label, status_label].filter(Boolean).join(", ");
    return <Button
      {...props}
      ref={ref}
      size="icon"
      className={cn("group/menu", chat_row_trigger_class_name(status), className)}
      title={accessible_label}
      aria-label={accessible_label}
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
      }}
    >
      <ChatStatusIcon status={status} fallback={<TbDots />} />
    </Button>;
  },
);
