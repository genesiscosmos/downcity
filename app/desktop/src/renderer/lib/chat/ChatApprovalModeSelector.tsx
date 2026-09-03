/** ChatInput 使用的 Session 审批模式选择器。 */

import { useState } from "react";
import { TbCheck, TbLock, TbShieldCheck } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DesktopSessionConfiguration } from "@common/types/DesktopApi";

/** 审批模式选择器属性。 */
interface ChatApprovalModeSelectorProps {
  /** 当前 Session 配置。 */
  configuration?: DesktopSessionConfiguration;
  /** 切换审批模式。 */
  set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
}

const approval_modes = [
  { mode: "ask", icon: TbLock, label: "询问", description: "执行敏感操作前请求确认" },
  { mode: "always-allow", icon: TbShieldCheck, label: "会话内允许", description: "当前 Session 内自动允许" },
] as const;

/** 以 Duobox 的 Popover 和全宽菜单按钮切换审批模式。 */
export function ChatApprovalModeSelector({ configuration, set_approval_mode }: ChatApprovalModeSelectorProps) {
  const [open, set_open] = useState(false);
  const mode = configuration?.approval_mode || "ask";
  const current_option = approval_modes.find((option) => option.mode === mode) ?? approval_modes[0];
  const CurrentIcon = current_option.icon;
  const select_mode = (next_mode: DesktopSessionConfiguration["approval_mode"]) => {
    set_open(false);
    if (next_mode !== mode) void set_approval_mode(next_mode);
  };
  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger asChild>
      <Button className="min-w-0 shrink rounded-full" title="Shell 请求" aria-label="Shell 请求" disabled={!configuration}>
        <CurrentIcon className="size-4" />
        <span className="min-w-0 truncate">{current_option.label}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" side="top" sideOffset={4} className="w-64 max-w-[calc(100vw-1rem)] p-1">
      <div className="flex flex-col gap-0.5">
        {approval_modes.map((option) => {
          const Icon = option.icon;
          const selected = option.mode === mode;
          return <button key={option.mode} type="button" className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-floating-item px-2.5 text-left transition-colors duration-150 hover:bg-interaction-hover", selected && "bg-interaction-selected")} onClick={() => select_mode(option.mode)}>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground/90">{option.label}</span><span className="block text-[10px] leading-4 text-muted-foreground/75">{option.description}</span></span>
            {selected ? <TbCheck className="size-3.5 shrink-0 text-primary" /> : null}
          </button>;
        })}
      </div>
    </PopoverContent>
  </Popover>;
}
