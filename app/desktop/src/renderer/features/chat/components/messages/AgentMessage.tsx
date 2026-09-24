/** 一条 canonical Agent Message 的身份、内容与操作边界。 */

import { useMemo, useState } from "react";
import type { RespondSessionInteractionInput, SessionAgentMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbCheck, TbChevronRight, TbCopy, TbDots, TbGitBranch, TbLoader2, TbMessageReply } from "react-icons/tb";
import { use_open_agent_config } from "@/features/agent/components/AgentChatDetails";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentMessageContent } from "@/features/chat/components/messages/AgentMessageContent";
import { AgentMessageFrame } from "@/features/chat/components/messages/AgentMessageFrame";
import { AgentFileDiffChip } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { MessageActionButton, message_action_button_class_name } from "@/features/chat/components/messages/MessageActionButton";
import { project_agent_message } from "@/features/chat/lib/message/agent_message_projection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

/**
 * Agent Message 只组合消息级身份、状态、内容和动作，不解释具体 Tool 或 Interaction。
 *
 * 布局（身份在上、正文在下）与 Group 共享消息完全一致，两者共用 `AgentMessageFrame`：
 * 同一条 Agent 输出在两个表面上必须长得一样，几何只能有一个来源。
 *
 * ## 折叠与思考
 *
 * 执行过程（工具调用与中间叙述）可以整段收起，只留最后的结论正文；开关在身份行里，
 * 因为它是这条消息的属性，不是内容里的一个块。
 *
 * 思考不是独立的一行状态：正在输出的推理是一个普通块，位置就是它在 canonical 顺序里的位置，
 * 与工具活动、正文平级（见 `AgentMessageContent`）。它只展示「正在进行」的那一条，
 * 推理收口后连块都不产生，因此历史消息里不会有思考行。
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
  const projection = useMemo(() => project_agent_message(message.parts), [message.parts]);
  const has_process = projection.process_blocks.length > 0;
  const has_content = projection.content_blocks.length > 0;
  /*
   * 没有内容块时不允许收起：那样整条消息只剩身份行，而开关藏在悬停里，
   * 用户会看到一条空消息。生命周期与这个降级都会自然让位给手动选择。
   */
  const process_open = process_override ?? (streaming || !has_content);
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
  const toggle_label = translate_chat(process_open ? "message.collapse_process" : "message.expand_process");
  /*
   * 开关在身份行；方向与过程的位置一致：过程展开在结论**下方**，
   * 因此折叠态是朝右（▸）、展开态转为朝下（▾）。
   * 几何与消息操作按钮一致（24px 目标尺寸）；它常显，不靠悬停，
   * 否则收起后看不出这条消息还有过程可看。
   */
  const process_toggle = has_process
    ? <button
      type="button"
      onClick={() => set_process_override(!process_open)}
      // 折叠态渲染的是另一份内容（过程整段不挂载），因此不声明 aria-controls。
      aria-expanded={process_open}
      title={toggle_label}
      aria-label={toggle_label}
      className={cn(message_action_button_class_name, "shrink-0")}
    ><TbChevronRight className={cn("transition-transform", process_open && "rotate-90")} /></button>
    : null;
  // 流式期间只显示本轮的实时文件改动；完成且有正文时显示操作栏（没有可复制正文时不留空行）。
  // 思考行不在 Footer 里：它是消息里的一个普通块，位置由 canonical 顺序决定。
  const footer = streaming
    ? <AgentFileDiffChip file_diff={file_diff} />
    : projection.text
      ? <div className="message-action-toolbar pointer-events-none ml-auto flex h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
        <MessageActionButton title={translate_chat("message.copy")} on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title={translate_common("actions.more")} aria-label={translate_common("actions.more")}><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "agent", text: projection.text })}><TbMessageReply className="size-3.5" /><span>{translate_chat("message.quote")}</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{translate_chat(forking ? "message.forking" : "message.fork")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      : null;
  return <AgentMessageFrame
    agent={agent}
    created_at={message.created_at}
    identity_action={open_panel}
    identity_title={translate_chat("message.edit_agent")}
    identity_label={translate_chat("message.edit_agent_name", { name: agent.name })}
    identity_trailing={process_toggle}
    busy={streaming}
    footer={footer}
  >
    <AgentMessageContent message_id={message.message_id} process_blocks={projection.process_blocks} content_blocks={projection.content_blocks} thinking={projection.thinking} process_open={process_open} show_reasoning={show_reasoning} streaming={streaming} respond_interaction={respond_interaction} />
  </AgentMessageFrame>;
}
