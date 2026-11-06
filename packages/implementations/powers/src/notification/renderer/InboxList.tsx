/** Inbox 事项列表：公开摘要和状态用于扫描；选择与通知整理使用互相独立的按钮。 */
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { InboxEntry } from "../types/Inbox.js";
import { full_time, relative_time } from "./InboxEntries.js";
import { InboxAvatar } from "./InboxAvatar.js";
import { InboxAttention } from "./InboxAttention.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";

/** 列表不负责已读；只在用户打开具体详情后由详情确认阅读。 */
export function InboxList({ entries, selected_key, busy, choose, update_notifications, props, options }: {
  /** 受信宿主的头像展示能力，与详情共用。 */ options: NotificationRendererOptions;
  /** 当前筛选的稳定事项列表。 */ entries: InboxEntry[];
  /** 当前打开的详情标识，用于行选中样式与辅助技术。 */ selected_key?: string;
  /** 普通通知动作正在进行，防止重复整理。 */ busy: boolean;
  /** 经过草稿离开确认的详情选择动作。 */ choose: (entry: InboxEntry) => Promise<void>;
  /** 由共享 Store 执行的版本化通知动作。 */ update_notifications: (operation: "read" | "clear", entry: InboxEntry) => Promise<void>;
  /** 宿主提供统一菜单和基础控件。 */ props: PowerMainviewComponentProps;
}) {
  const { ItemMenu } = props.ui.components;
  return <ul className="inbox-list" aria-label="收件箱事项">
    {entries.map((entry) => {
      const failure = entry.update?.outcome === "failure";
      return <li key={entry.key} className="inbox-list-row" data-active={selected_key === entry.key}
        data-unread={entry.unread} data-failure={failure}>
        <button type="button" className="inbox-list-select" onClick={() => void choose(entry)}
          aria-current={selected_key === entry.key ? "true" : undefined}>
          <InboxAvatar entry={entry} size="list" options={options} />
          <span className="inbox-list-content">
            <span className="inbox-list-sender">
              <span className="inbox-list-name">{entry.source}</span>
              <time className="inbox-list-time" dateTime={new Date(entry.created_at).toISOString()} title={full_time(entry.created_at)}>{relative_time(entry.created_at)}</time>
            </span>
            <span className="inbox-list-title">{entry.title}</span>
            {entry.summary ? <span className="inbox-list-summary">{entry.summary}</span> : null}
          </span>
          <span className="inbox-list-indicator"><InboxAttention entry={entry} options={options} presentation="dot" /></span>
        </button>
        {entry.update ? <div className="inbox-list-actions">
          <ItemMenu label={`通知操作：${entry.title}`} reveal_on_hover={false} actions={[
            ...(entry.unread ? [{ action_id: "read_update", label: "标为已读", disabled: busy, on_select: () => update_notifications("read", entry) }] : []),
            { action_id: "clear_update", label: "清除此通知", disabled: busy, on_select: () => update_notifications("clear", entry) },
          ]} />
        </div> : null}
      </li>;
    })}
  </ul>;
}
