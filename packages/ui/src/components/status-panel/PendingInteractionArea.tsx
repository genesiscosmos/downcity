"use client";
/**
 * StatusPanel 内的待处理交互内容，单聊与群聊共用。
 * 卡片按交互标识挂载，切换时卸载，确保未提交的私密输入及时释放；
 * 提交成功后立即移出，canonical 消息继续负责记录最终结果。
 */
import { useState } from "react";
import { TbChevronLeft, TbChevronRight } from "react-icons/tb";
import { StatusPanelButton } from "./status-panel-button";
import type { RespondSessionInteractionInput } from "@downcity/type";
import { AgentInteraction } from "./AgentInteraction";
import { StatusPanelHeader } from "./StatusPanelHeader";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";
import type { PendingInteractionAreaProps, PendingInteractionItem } from "../../types/status-panel";

/** 卡片身份覆盖完整来源；群聊和本地消息沿用其会话内交互身份。 */
function interaction_key(item: PendingInteractionItem): string {
  return item.key ?? item.part.interaction_id;
}

/** 由调用方按完整会话标识设置 key，避免会话之间复用表单状态。 */
function PendingInteractionAreaContent({ items, respond }: PendingInteractionAreaProps) {
  const translate_chat = use_translation("chat");
  const [selected_id, set_selected_id] = useState("");
  const pending = items.filter((item) => item.part.status === "pending");
  const active_id = pending.some((item) => interaction_key(item) === selected_id)
    ? selected_id : pending[0] ? interaction_key(pending[0]) : undefined;
  if (!pending.length) return null;
  const active_index = pending.findIndex((item) => interaction_key(item) === active_id);
  const active_item = pending[active_index]!;
  const submit = async (input: RespondSessionInteractionInput, private_question = false) => {
    await respond(input, private_question, active_item);
  };
  const active_label = active_item.label;
  return <section className="pending-interaction-area" aria-label={translate_chat("activity.input_required")}>
    <StatusPanelHeader title={translate_chat("status_panel.interaction")}
      source={active_label ? active_item.open_details
        ? <button type="button" className="pending-interaction-label block max-w-full text-left hover:underline" title={translate_chat("attachment.show_details")} onClick={active_item.open_details}>{active_label}</button>
        : <span title={active_label}>{active_label}</span> : undefined}
      actions={pending.length > 1 ? <nav className="interaction-navigation" aria-label={translate_chat("activity.input_required")}>
        <StatusPanelButton size="icon" aria-label={translate_chat("activity.previous")} disabled={active_index === 0} onClick={() => set_selected_id(interaction_key(pending[active_index - 1]))}><TbChevronLeft /></StatusPanelButton>
        <span className="interaction-page">{active_index + 1} / {pending.length}</span>
        <StatusPanelButton size="icon" aria-label={translate_chat("activity.next")} disabled={active_index === pending.length - 1} onClick={() => set_selected_id(interaction_key(pending[active_index + 1]))}><TbChevronRight /></StatusPanelButton>
      </nav> : undefined}
    />
    <div className="pending-interaction-content">
      <div className="pending-interaction-pane" key={active_id}>
        <AgentInteraction part={active_item.part} respond={submit} />
      </div>
    </div>
  </section>;
}

/** 独用时接收宿主文案；组合时继承上层文案。 */
export function PendingInteractionArea(props: PendingInteractionAreaProps) {
  return <ControlMessagesProvider translate={props.translate}><PendingInteractionAreaContent {...props} /></ControlMessagesProvider>;
}
