/** 一条 canonical Agent Message 的身份、内容与操作边界。 */

import { useMemo, useRef, useState } from "react";
import type { RespondSessionInteractionInput, SessionAgentMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbCheck, TbChevronRight, TbCopy, TbDots, TbGitBranch, TbLoader2, TbMessageReply } from "react-icons/tb";
import { use_open_agent_config } from "@/features/agent/components/AgentChatDetails";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentMessageContent } from "@/features/chat/components/messages/AgentMessageContent";
import { AgentMessageFrame } from "@/features/chat/components/messages/AgentMessageFrame";
import { AgentFileDiffChip } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { MessageActionButton, message_action_button_class_name } from "@/features/chat/components/messages/MessageActionButton";
import { agent_message_actions_class_name } from "@/features/chat/components/messages/message_layout";
import { use_chat_scroll_anchor } from "@/features/chat/components/messages/ChatScrollAnchor";
import { cn } from "@/lib/utils";
import { project_agent_message } from "@/features/chat/lib/message/agent_message_projection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

/**
 * Agent Message 只组合消息级身份、状态、内容和动作，不解释具体 Tool 或 Interaction。
 *
 * 布局（左侧头像与折叠按钮、右侧信息与正文）与 Group 共享消息完全一致，两者共用 `AgentMessageFrame`：
 * 同一条 Agent 输出在两个表面上必须长得一样，几何只能有一个来源。
 *
 * ## 折叠与思考
 *
 * 执行过程（工具调用与中间叙述）由头像下方的箭头展开或收起。
 * 收起后隐藏过程，最终结论始终可见；仅有过程时仍保留箭头入口。
 *
 * 推理与工具共用 activity 展示，按 canonical 顺序参与过程折叠。
 * 生成中和完成后的记录都可展开，显示推理的偏好在投影入口统一过滤。
 *
 * 折叠状态跟随消息生命周期：流式期间展开（用户看得见它在做什么），收口后自动收起。
 * 用户手动切换后以手动值为准，不再被生命周期覆盖。
 */
export function AgentMessage({ message, agent, show_reasoning, respond_interaction, fork_message, file_diff }: { /** canonical Agent Message。 */ message: SessionAgentMessage; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 从当前消息创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 当前 Session 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary }) {
  // Agent 编辑面板由当前 MainView 注册，消息内只需按标识打开。
  const open_panel = use_open_agent_config();
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const [copied, set_copied] = useState(false);
  const [forking, set_forking] = useState(false);
  /*
   * 存的是「用户是否手动切换过」而不是「过程是否展开」：
   * 未切换时为 undefined，展开状态直接跟随流式生命周期，收口那一下自动收起，
   * 不需要一个只在状态迁移时生效的同步 effect。
   */
  const [process_override, set_process_override] = useState<boolean>();
  const streaming = message.state === "streaming";
  const projection = useMemo(() => project_agent_message(message.parts, show_reasoning), [message.parts, show_reasoning]);
  // 流式期间默认展开；完成后收起，左侧箭头始终提供重新展开的入口。
  const process_open = process_override ?? streaming;
  const process_toggle_ref = useRef<HTMLButtonElement>(null);
  const preserve_element_position = use_chat_scroll_anchor();
  const toggle_label = translate_chat(process_open ? "message.collapse_process" : "message.expand_process");
  const toggle_process = () => {
    if (process_toggle_ref.current) preserve_element_position(process_toggle_ref.current);
    set_process_override(!process_open);
  };
  const process_toggle = projection.process_blocks.length > 0 ? <button
    ref={process_toggle_ref}
    type="button"
    onClick={toggle_process}
    aria-expanded={process_open}
    aria-label={toggle_label}
    title={toggle_label}
    className="flex size-6 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  ><TbChevronRight aria-hidden className={cn("size-3.5 transition-transform", process_open && "rotate-90")} /></button> : null;
  const copy_message = async () => {
    if (!projection.text) return;
    await navigator.clipboard.writeText(projection.text);
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  const fork = async () => {
    if (forking) return;
    set_forking(true);
    try { await fork_message(message.message_id); } finally { set_forking(false); }
  };
  // 流式期间只显示本轮的实时文件改动；完成后显示动作栏。
  // 动作栏在全部正文与文件改动之后展示（见 `AgentMessageContent`），靠左对齐。
  const actions = streaming || !projection.text
    ? undefined
    : <div className={agent_message_actions_class_name}>
      <MessageActionButton title={translate_chat("message.copy")} on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
      <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title={translate_common("actions.more")} aria-label={translate_common("actions.more")}><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "agent", text: projection.text })}><TbMessageReply className="size-3.5" /><span>{translate_chat("message.quote")}</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{translate_chat(forking ? "message.forking" : "message.fork")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>;
  return <AgentMessageFrame
    agent={agent}
    created_at={message.created_at}
    identity_action={open_panel}
    identity_title={translate_chat("message.edit_agent")}
    identity_label={translate_chat("message.edit_agent_name", { name: agent.name })}
    rail_action={process_toggle}
    busy={streaming}
    footer={streaming ? <AgentFileDiffChip file_diff={file_diff} /> : null}
  >
    <AgentMessageContent message_id={message.message_id} process_blocks={projection.process_blocks} content_blocks={projection.content_blocks} process_open={process_open} streaming={streaming} respond_interaction={respond_interaction} actions={actions} />
  </AgentMessageFrame>;
}
