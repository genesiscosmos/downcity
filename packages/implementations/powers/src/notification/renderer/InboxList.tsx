/** Inbox 侧栏列表：复用宿主双行条目，状态统一显示在每项菜单按钮内部。 */
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { InboxEntry } from "../types/Inbox.js";
import { full_time, relative_time } from "./InboxEntries.js";
import { InboxAvatar } from "./InboxAvatar.js";
import { InboxAttention, inbox_attention_label } from "./InboxAttention.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";

/** 列表不负责已读；只在用户打开具体详情后由详情确认阅读。 */
export function InboxList({ entries, selected_key, busy, choose, update_notifications, props, options }: {
  /** 受信宿主的头像展示能力，与详情共用。 */ options: NotificationRendererOptions;
  /** 当前筛选的稳定事项列表。 */ entries: InboxEntry[];
  /** 当前打开的详情标识，用于行选中样式与辅助技术。 */ selected_key?: string;
  /** 普通通知动作正在进行，防止重复整理。 */ busy: boolean;
  /** 经过草稿离开确认的详情选择动作。 */ choose: (entry: InboxEntry) => Promise<void>;
  /** 由共享 Store 执行的版本化通知动作。 */ update_notifications: (operation: "read" | "clear", entry: InboxEntry) => Promise<void>;
  /** 宿主提供统一侧栏行、菜单和基础控件。 */ props: PowerSidebarComponentProps;
}) {
  const { SidebarItem, ItemMenu } = props.ui.components;
  return <>{entries.map((entry) => {
    const needs_attention = entry.unread && (!entry.pending || entry.pending.interaction.can_respond);
    return <SidebarItem key={entry.key}
    label={entry.title}
    description={<span className="inbox-list-meta"><span>{entry.source}</span><span aria-hidden="true">·</span><time dateTime={new Date(entry.created_at).toISOString()} title={full_time(entry.created_at)}>{relative_time(entry.created_at)}</time></span>}
    leading={<InboxAvatar entry={entry} size="list" options={options} />}
    active={selected_key === entry.key}
    on_select={() => void choose(entry)}
    menu={<ItemMenu label={`事项操作：${entry.title}${needs_attention ? `，${inbox_attention_label(entry)}` : ""}`} reveal_on_hover
      indicator={needs_attention ? <InboxAttention entry={entry} options={options} presentation="dot" /> : undefined} actions={[
        { action_id: "view_detail", label: "查看详情", on_select: () => choose(entry) },
        ...(entry.update ? [
          ...(entry.unread ? [{ action_id: "read_update", label: "标为已读", separator_before: true, disabled: busy, on_select: () => update_notifications("read", entry) }] : []),
          { action_id: "clear_update", label: "清除此通知", separator_before: !entry.unread, disabled: busy, on_select: () => update_notifications("clear", entry) },
        ] : []),
      ]} />}
    />;
  })}</>;
}
