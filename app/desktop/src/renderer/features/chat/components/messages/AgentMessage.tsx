/** 一条 canonical Agent Message 的身份、内容与操作边界。 */

import { useMemo, useState } from "react";
import type { RespondSessionInteractionInput, SessionAgentMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbCheck, TbCopy, TbDots, TbGitBranch, TbLoader2, TbMessageReply } from "react-icons/tb";
import { use_open_agent_config } from "@/features/agent/components/AgentChatDetails";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AgentMessageContent } from "@/features/chat/components/messages/AgentMessageContent";
import { AgentMessageFrame } from "@/features/chat/components/messages/AgentMessageFrame";
import { AgentRuntimeIndicator } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { MessageActionButton, message_action_button_class_name } from "@/features/chat/components/messages/MessageActionButton";
import { project_agent_message } from "@/features/chat/lib/message/agent_message_projection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

/**
 * Agent Message 只组合消息级身份、状态、内容和动作，不解释具体 Tool 或 Interaction。
 *
 * 布局（身份在上、正文在下）与 Group 共享消息完全一致，两者共用 `AgentMessageFrame`：
 * 同一条 Agent 输出在两个表面上必须长得一样，几何只能有一个来源。
 * 这里只提供 Session 特有的三件事——打开 Agent 配置的动作、Copy/Quote/Fork 操作栏、
 * 以及流式状态行。
 */
export function AgentMessage({ message, agent, show_reasoning, respond_interaction, fork_message, file_diff }: { /** canonical Agent Message。 */ message: SessionAgentMessage; /** 当前 Agent。 */ agent: DesktopAgentSummary; /** 是否显示推理。 */ show_reasoning: boolean; /** 响应审批或问题。 */ respond_interaction(input: RespondSessionInteractionInput): Promise<void>; /** 从当前消息创建分支 Session。 */ fork_message(message_id: string): Promise<void>; /** 当前 Session 最新实时文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary }) {
  // Agent 编辑面板由当前 MainView 注册，消息内只需按标识打开。
  const open_panel = use_open_agent_config();
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const [copied, set_copied] = useState(false);
  const [forking, set_forking] = useState(false);
  const projection = useMemo(() => project_agent_message(message.parts), [message.parts]);
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
  // 流式期间显示运行状态，完成且有正文时显示操作栏。
  // `show_actions` 为真时 `text` 必然非空（投影只在文本非空白时才推入），因此不需要占位空行。
  const footer = message.state === "streaming"
    ? <AgentRuntimeIndicator status="streaming" compact file_diff={file_diff} />
    : projection.text
      ? <div className="message-action-toolbar pointer-events-none flex h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
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
    busy={message.state === "streaming"}
    footer={footer}
  >
    <AgentMessageContent message_id={message.message_id} blocks={projection.blocks} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.state === "streaming"} />
  </AgentMessageFrame>;
}
