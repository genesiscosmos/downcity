/** ChatInput 使用的 Session 审批模式选择器。 */

import { TbCheck, TbLock, TbShieldCheck } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import type { DesktopSessionConfiguration } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** 审批模式选择器属性。 */
interface ChatApprovalModeSelectorProps {
  /** 当前 Session 配置。 */
  configuration?: DesktopSessionConfiguration;
  /** 切换审批模式。 */
  set_approval_mode(approval_mode: DesktopSessionConfiguration["approval_mode"]): Promise<void>;
}

/** 使用与附件菜单一致的紧凑 Dropdown 列表切换审批模式。 */
export function ChatApprovalModeSelector({ configuration, set_approval_mode }: ChatApprovalModeSelectorProps) {
  const translate = use_translation("chat");
  const approval_modes = [
    { mode: "ask", icon: TbLock, label: translate("approval.ask") },
    { mode: "always-allow", icon: TbShieldCheck, label: translate("approval.always") },
  ] as const;
  const mode = configuration?.approval_mode || "ask";
  const current_option = approval_modes.find((option) => option.mode === mode) ?? approval_modes[0];
  const CurrentIcon = current_option.icon;
  const select_mode = (next_mode: DesktopSessionConfiguration["approval_mode"]) => {
    if (next_mode !== mode) void set_approval_mode(next_mode);
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button className="min-w-0 shrink rounded-full" title={translate("approval.title")} aria-label={translate("approval.title")} disabled={!configuration}>
        <CurrentIcon className="size-4" />
        <span className="min-w-0 truncate">{current_option.label}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" sideOffset={4}>
      {approval_modes.map((option) => {
        const Icon = option.icon;
        return <DropdownMenuItem key={option.mode} onClick={() => select_mode(option.mode)}>
          <Icon className="size-4" />
          <span className="min-w-0 flex-1">{option.label}</span>
          {option.mode === mode ? <TbCheck className="size-3.5 text-primary" /> : null}
        </DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}
