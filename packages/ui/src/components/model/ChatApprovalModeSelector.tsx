"use client";
/** ChatInput 使用的 Session 审批模式选择器。 */

import { TbCheck, TbLock, TbShieldCheck } from "react-icons/tb";
import { Button } from "../button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu";
import type { SessionApprovalMode } from "@downcity/type";
import type { ChatApprovalModeSelectorProps } from "../../types/model-controls";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";

/** 使用与附件菜单一致的紧凑 Dropdown 列表切换审批模式。 */
function ChatApprovalModeSelectorContent({ configuration, set_approval_mode }: ChatApprovalModeSelectorProps) {
  const translate = use_translation("chat");
  const approval_modes = [
    { mode: "ask", icon: TbLock, label: translate("approval.ask") },
    { mode: "always-allow", icon: TbShieldCheck, label: translate("approval.always") },
  ] as const;
  const mode = configuration?.approval_mode || "ask";
  const current_option = approval_modes.find((option) => option.mode === mode) ?? approval_modes[0];
  const CurrentIcon = current_option.icon;
  const select_mode = (next_mode: SessionApprovalMode) => {
    if (next_mode !== mode) void set_approval_mode(next_mode);
  };
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="min-w-0 shrink rounded-full" title={translate("approval.title")} aria-label={translate("approval.title")} disabled={!configuration}>
        <CurrentIcon className="size-4" />
        <span className="min-w-0 truncate">{current_option.label}</span>
      </Button>} />
    <DropdownMenuContent align="start" side="top" sideOffset={4} className="max-h-none overflow-hidden p-0"><div role="presentation" className="max-h-[min(20rem,var(--available-height,100vh))] overflow-y-auto overscroll-contain p-1">
      {approval_modes.map((option) => {
        const Icon = option.icon;
        return <DropdownMenuItem key={option.mode} onClick={() => select_mode(option.mode)}>
          <Icon className="size-4" />
          <span className="min-w-0 flex-1">{option.label}</span>
          {option.mode === mode ? <TbCheck className="size-3.5 text-primary" /> : null}
        </DropdownMenuItem>;
      })}
    </div></DropdownMenuContent>
  </DropdownMenu>;
}

/** 由宿主保存审批配置。 */
export function ChatApprovalModeSelector(props: ChatApprovalModeSelectorProps) {
  return <ControlMessagesProvider translate={props.translate}><ChatApprovalModeSelectorContent {...props} /></ControlMessagesProvider>;
}
