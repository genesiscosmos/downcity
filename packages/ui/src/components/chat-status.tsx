/** ChatPanel 到真实共享 StatusPanel 的适配；队列调度仍由 runtime 独占。 */
import { useState } from "react";
import type { DowncityChatPanelProps, DowncityChatSubmitInput } from "../types/chat";
import type { DowncityChatRuntimeSnapshot } from "../types/chat-runtime";
import type { DowncityChatRuntime } from "../lib/chat-runtime";
import type { PendingInteractionItem } from "../types/status-panel";
import { chat_interaction } from "../lib/chat-activity";
import { create_chat_composer } from "./chat-input/chatComposerCodec";
import { StatusPanel } from "./status-panel/StatusPanel";

/** 当前 ChatPanel 输入区需要的状态与编辑入口。 */
export interface ChatComposerStatusProps {
  /** 当前会话的稳定范围键，变化时释放表单私密值。 */ session_key: string;
  /** 唯一本地队列所有者；受控宿主可省略。 */ runtime?: DowncityChatRuntime;
  /** 与组件相同订阅中取得的不可变 runtime 快照。 */ snapshot?: DowncityChatRuntimeSnapshot;
  /** 真实来源、交互 transport 和子会话导航由宿主提供。 */ status_panel?: DowncityChatPanelProps["status_panel"];
  /** 未提供宿主交互集合时，从当前已加载 canonical 消息读取待处理请求。 */ interactions?: readonly PendingInteractionItem[];
  /** 使用现有 interaction 协议响应当前会话，不改变其状态事实。 */ respond?: DowncityChatPanelProps["on_respond_interaction"];
  /** 原编辑文档由输入区接收，队列条目继续留在 runtime 等待保存。 */ on_edit(input: DowncityChatSubmitInput): void;
}
/** 独立导出的纯投影，历史分页和实时快照都使用相同去重规则。 */
export function message_pending_interactions(messages: NonNullable<DowncityChatPanelProps["messages"]>): PendingInteractionItem[] {
  const by_id = new Map<string, PendingInteractionItem>();
  for (const message of messages) for (const part of message.parts ?? []) {
    if (part.type === "input") continue;
    const interaction = chat_interaction(part);
    if (interaction) by_id.set(interaction.interaction_id, { part: interaction, key: interaction.interaction_id });
    if (part.activity_part?.type === "tool") for (const item of part.activity_part.interactions ?? []) by_id.set(item.interaction_id, { part: item, key: item.interaction_id });
  }
  return [...by_id.values()].filter(item => item.part.status === "pending");
}
/** 渲染唯一的待操作表单与完整队列控件，不在消息内创建第二份表单。 */
export function ChatComposerStatus({ session_key, runtime, snapshot, status_panel, interactions, respond, on_edit }: ChatComposerStatusProps) {
  const [action_error, set_action_error] = useState<string>();
  return <StatusPanel auto_expand_interactions {...status_panel} session_key={status_panel?.session_key ?? session_key}
    error={action_error ?? status_panel?.error}
    interactions={status_panel?.interactions ?? (respond ? { items: interactions ?? [], respond: async (input, private_question) => { if (private_question) throw new Error("Private questions require a host private submission adapter."); await respond(input.interaction_id, input.response); } } : undefined)}
    queue={runtime && snapshot ? {
      queued_messages: snapshot.queued_inputs.map(item => ({ message_id: item.id, input: item.input.document ?? create_chat_composer(item.text), sending: item.sending })),
      queue_paused: snapshot.queue_paused, editing_message_id: snapshot.editing_queue_id,
      remove_queued_message: id => runtime.remove_queued_input(id),
      send_queued_message: async id => { set_action_error(undefined); try { await runtime.send_queued_input(id); } catch (error) { set_action_error(String(error)); } },
      pin_queued_message: id => runtime.pin_queued_input(id),
      set_queue_paused: paused => runtime.set_queue_paused(paused),
      edit_queued_message: id => { const input = runtime.edit_queued_input(id); if (input) on_edit(input); },
    } : undefined} />;
}
