/** Inbox侧栏：待处理与更新直接分组，行样式复用宿主SidebarItem。 */
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { full_time, inbox_entries, relative_time } from "./InboxEntries.js";
import { InboxIcon } from "./InboxIcon.js";

/** 侧栏与详情借用同一个Store，避免重复轮询及选择分叉。 */
export function InboxSidebar({ store, ...props }: PowerSidebarComponentProps & {
  /** Renderer工厂拥有的临时共享状态。 */ store: InboxStore;
}) {
  const { state, view, choose } = use_inbox(store, props);
  const { Sidebar, SidebarSection, SidebarItem, SidebarSubText } = props.ui.components;
  const selected = state.selected[view];
  const groups = [
    { view: "pending" as const, label: "待处理", empty: "暂无待处理事项" },
    { view: "updates" as const, label: "更新", empty: "暂无更新" },
  ];
  return <Sidebar actions={<button type="button" className="inbox-icon-button" aria-label="刷新收件箱" title="刷新" onClick={() => void store.refresh()}><InboxIcon kind="refresh" /></button>}>
    {state.error ? <SidebarSubText>暂时无法刷新，保留已有内容。</SidebarSubText> : null}
    {state.loading ? <SidebarSubText>正在读取收件箱…</SidebarSubText> : groups.map((group) => {
      const entries = inbox_entries(state.data, group.view);
      const count = entries.filter((entry) => group.view === "pending" ? entry.pending?.interaction.can_respond : entry.unread).length;
      return <SidebarSection key={group.view} label={<span className="inbox-section-label"><span>{group.label}</span>{count ? <span>{count}</span> : null}</span>}>
        {!entries.length ? <SidebarSubText>{state.error ? "请重试读取" : group.empty}</SidebarSubText> : entries.map((entry) => <SidebarItem
          key={entry.key}
          label={entry.title}
          description={<span className="inbox-row-meta"><span>{entry.source}</span><time dateTime={new Date(entry.created_at).toISOString()} title={full_time(entry.created_at)}>{relative_time(entry.created_at)}</time></span>}
          leading={<span className="inbox-row-icon"><InboxIcon kind={entry.kind} /></span>}
          trailing={entry.pending && !entry.pending.interaction.can_respond ? <span className="inbox-row-state">已中断</span>
            : entry.view === "updates" && entry.unread ? <span className="inbox-unread-dot" aria-label="未读" /> : undefined}
          active={selected?.key === entry.key && view === entry.view}
          on_select={() => void choose(entry)}
        />)}
      </SidebarSection>;
    })}
  </Sidebar>;
}
