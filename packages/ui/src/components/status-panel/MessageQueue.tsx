"use client";
/**
 * StatusPanel 的队列内容：顶部 Header 承载整队操作，下方滚动区仅展示消息条目。
 * 分类计数和折叠由宿主统一管理，Header 不随列表滚动。
 * 编辑由 ChatInput 接管，列表只展示已确认内容；摘要沿用正文的 87.5%，资源保持正文排版。
 * 行几何与子会话共享 StatusPanel 样式，编辑态只突出整行，不叠加图标底块。
 * 每条消息常驻立即发送入口，编辑、置顶与删除收进更多菜单；置顶不越过正在提交的消息。
 */

import { TbCornerDownRight, TbDots, TbLoader2, TbPencil, TbPinned, TbPlayerPause, TbPlayerPlay, TbTrash } from "react-icons/tb";
import { StatusPanelButton } from "./status-panel-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu";
import { count_chat_composer_atoms, read_chat_composer_visible_text } from "../chat-input/chatComposerCodec";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";
import type { MessageQueueProps } from "../../types/status-panel";
import { QueuedMessageResources } from "./QueuedMessageResources";
import { StatusPanelHeader } from "./StatusPanelHeader";

/** 渲染顶部整队操作与独立滚动列表；空队列不占用布局。 */
function MessageQueueContent(props: MessageQueueProps) {
  const translate = use_translation("chat");
  const editing = Boolean(props.editing_message_id);
  const first_pending_index = props.queued_messages.reduce((first_index, message, index) => message.sending ? index + 1 : first_index, 0);
  if (!props.queued_messages.length) return null;
  return <div className="status-panel-list-area flex flex-col gap-0.5">
    <StatusPanelHeader title={translate("status_panel.queue")} actions={
      <StatusPanelButton disabled={editing} className="rounded-full" title={translate(props.queue_paused ? "queue.resume_all" : "queue.pause_all")}
        onClick={() => props.set_queue_paused(!props.queue_paused)}>
        {props.queue_paused ? <TbPlayerPlay /> : <TbPlayerPause />}
        {translate(props.queue_paused ? "queue.resume" : "queue.pause")}
      </StatusPanelButton>
    } />
    <div className="chat-queued-message-list status-panel-list">{props.queued_messages.map((message, index) => {
      const is_editing = message.message_id === props.editing_message_id;
      const text = read_chat_composer_visible_text(message.input);
      const atom_count = count_chat_composer_atoms(message.input);
      return <div key={message.message_id} aria-current={is_editing ? "true" : undefined} className="status-panel-item text-muted-foreground">
        {/* 状态图标共用固定占位，进入编辑或发送状态时正文保持对齐。 */}
        <span role={is_editing ? "img" : undefined} aria-label={is_editing ? translate("queue.editing") : undefined} title={is_editing ? translate("queue.editing") : undefined} className="flex size-4 shrink-0 items-center justify-center">
          {is_editing ? <TbPencil className="size-3" aria-hidden="true" /> : message.sending ? <TbLoader2 className="size-3 animate-spin text-muted-foreground" /> : <TbCornerDownRight className="size-3 text-subtle-foreground" />}
        </span>
          <div className="downcity-writing-text chat-text-size-content min-w-0 flex-1"><span className="chat-queued-message-text block whitespace-pre-wrap break-words">{text || translate("queue.contents", { count: atom_count })}</span>{atom_count ? (props.render_resources?.(message.input) ?? <QueuedMessageResources input={message.input} />) : null}</div>
          <StatusPanelButton size="inline-icon" aria-label={translate("queue.send_now")} title={translate("queue.send_now")} disabled={message.sending || editing} onClick={() => void props.send_queued_message(message.message_id)}><TbCornerDownRight /></StatusPanelButton>
          <DropdownMenu>
            <DropdownMenuTrigger render={<StatusPanelButton size="inline-icon" aria-label={translate("queue.more")} title={translate("queue.more")} disabled={message.sending || editing}><TbDots /></StatusPanelButton>} />
            <DropdownMenuContent align="end" className="max-h-none overflow-hidden p-0"><div role="presentation" className="max-h-[min(20rem,var(--available-height,100vh))] overflow-y-auto overscroll-contain p-1">
              <DropdownMenuItem disabled={message.sending || editing} onClick={() => props.edit_queued_message(message.message_id)}><TbPencil /><span>{translate("queue.edit")}</span></DropdownMenuItem>
              <DropdownMenuItem disabled={editing || message.sending || index <= first_pending_index} onClick={() => props.pin_queued_message(message.message_id)}><TbPinned /><span>{translate("queue.pin")}</span></DropdownMenuItem>
              <DropdownMenuItem disabled={editing || message.sending} onClick={() => props.remove_queued_message(message.message_id)}><TbTrash /><span>{translate("queue.delete")}</span></DropdownMenuItem>
            </div></DropdownMenuContent>
          </DropdownMenu>
      </div>;
    })}</div>
  </div>;
}

/** 独用时接收宿主文案；组合时继承上层文案。 */
export function MessageQueue(props: MessageQueueProps) {
  return <ControlMessagesProvider translate={props.translate}><MessageQueueContent {...props} /></ControlMessagesProvider>;
}
