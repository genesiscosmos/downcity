/** Chat Composer 的键盘可操作 Slash 命令菜单。 */

import { useEffect, useState } from "react";
import { TbAdjustments, TbFile, TbPhoto, TbTrash } from "react-icons/tb";
import { MenuItemShell } from "@/components/ui/item";
import type { ChatSlashCommand } from "@/types/ChatComposer";

/** Slash 菜单属性。 */
interface ChatSlashMenuProps {
  /** 当前查询命中的命令。 */
  commands: ChatSlashCommand[];
  /** 执行一个命令。 */
  select_command(command: ChatSlashCommand): void;
}

/** 浮在输入区上方的 Slash 命令列表。 */
export function ChatSlashMenu({ commands, select_command }: ChatSlashMenuProps) {
  const [active_index, set_active_index] = useState(0);
  useEffect(() => set_active_index(0), [commands]);
  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (commands.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        set_active_index((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        select_command(commands[active_index] ?? commands[0]);
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, [active_index, commands, select_command]);
  if (commands.length === 0) return null;
  return <div className="absolute bottom-full left-1 z-30 mb-2 w-56 overflow-hidden rounded-floating-surface border border-border bg-background p-1 text-popover-foreground outline-none">
    {commands.map((command, index) => {
      const Icon = command.command_id === "attach" ? TbFile : command.command_id === "image" ? TbPhoto : command.command_id === "clear" ? TbTrash : TbAdjustments;
      return <MenuItemShell key={command.command_id} is_selected={index === active_index} role="button" onMouseDown={(event) => event.preventDefault()} onClick={() => select_command(command)}>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{command.title}</span>
      </MenuItemShell>;
    })}
  </div>;
}
