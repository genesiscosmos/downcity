/** 一条 canonical Agent Message 的身份、内容与操作边界。 */

import { useMemo, useState } from "react";
import type { RespondSessionInteractionInput, SessionAgentMessage, SessionTurnFileDiffSummary } from "@downcity/agent";
import { TbCheck, TbCopy, TbDots, TbGitBranch, TbLoader2, TbMessageReply } from "react-icons/tb";
import { AgentAvatar } from "@/components/AgentAvatar";
import { use_open_agent_config } from "@/features/agent/components/AgentChatDetails";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { ChatMessageTimestamp } from "@/features/chat/components/ChatMessageTimestamp";
import { AgentMessageContent } from "@/features/chat/components/messages/AgentMessageContent";
import { AgentRuntimeIndicator } from "@/features/chat/components/messages/AgentRuntimeIndicator";
import { MessageActionButton, message_action_button_class_name } from "@/features/chat/components/messages/MessageActionButton";
import { project_agent_message } from "@/features/chat/lib/message/agent_message_projection";
import { dispatch_chat_reference } from "@/features/chat/composer/editor/chatReferenceEvent";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

/** Agent Message 只组合消息级身份、状态、内容和动作，不解释具体 Tool 或 Interaction。 */
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
  return <article className="group is-agent flex w-full items-start gap-2 py-2 !m-0 !p-0" aria-busy={message.state === "streaming"}>
    <button type="button" onClick={() => open_panel?.()} className="sticky top-2 z-10 shrink-0 rounded-md px-1 pt-0.5 outline-none transition-opacity duration-150 enabled:hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/30" title={translate_chat("message.edit_agent")} aria-label={translate_chat("message.edit_agent_name", { name: agent.name })}>
      <AgentAvatar agent={agent} class_name="size-7 rounded-md" />
    </button>
    <div className="flex min-w-0 flex-1 flex-col gap-0 overflow-visible rounded-none pb-0 pt-0.5 text-sm text-foreground">
      <header className="mb-1 flex min-w-0 items-center gap-2"><button type="button" onClick={() => open_panel?.()} className="min-w-0 truncate rounded-sm text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:ring-ring/30">{agent.name}</button><ChatMessageTimestamp created_at={message.created_at} class_name="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" /></header>
      <div className="min-h-0 w-full"><AgentMessageContent message_id={message.message_id} blocks={projection.blocks} show_reasoning={show_reasoning} respond_interaction={respond_interaction} streaming={message.state === "streaming"} /></div>
      {message.state === "streaming" ? <AgentRuntimeIndicator status="streaming" compact file_diff={file_diff} /> : projection.show_actions ? <div className="agent-message-footer flex h-6 min-h-6 shrink-0 items-center">
        {projection.text ? <div className="message-action-toolbar pointer-events-none flex h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <MessageActionButton title={translate_chat("message.copy")} on_click={() => void copy_message()}>{copied ? <TbCheck /> : <TbCopy />}</MessageActionButton>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={message_action_button_class_name} title={translate_common("actions.more")} aria-label={translate_common("actions.more")}><TbDots className="size-3" /></button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" sideOffset={4}><DropdownMenuItem onClick={() => dispatch_chat_reference({ message_id: message.message_id, role: "agent", text: projection.text })}><TbMessageReply className="size-3.5" /><span>{translate_chat("message.quote")}</span></DropdownMenuItem><DropdownMenuItem disabled={forking} onClick={() => void fork()}>{forking ? <TbLoader2 className="size-3.5 animate-spin" /> : <TbGitBranch className="size-3.5" />}<span>{translate_chat(forking ? "message.forking" : "message.fork")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div> : null}
      </div> : null}
    </div>
  </article>;
}
