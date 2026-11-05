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
  const { Sidebar, SidebarSection, SidebarItem, SidebarSubText, Button, ItemMenu } = props.ui.components;
  const data = state.data;
  const busy = !!state.update_action;
  const update_notifications = async (operation: "read" | "clear" | "clear_read", entry?: Parameters<InboxStore["select"]>[0]) => {
    await store.update_notifications(operation, entry);
    props.ui.invalidate();
  };
  const selected = state.selected[view];
  const groups = [
    { view: "pending" as const, label: "待处理", empty: "暂无待处理事项" },
    { view: "updates" as const, label: "更新", empty: "暂无更新" },
  ];
  return <Sidebar actions={<>
    <Button size="icon" aria_label="刷新收件箱" title="刷新" on_click={() => void store.refresh_sources()}><InboxIcon kind="refresh" /></Button>
    <ItemMenu label="收件箱更新操作" actions={[
      { action_id: "read_updates", label: "全部更新已读", disabled: busy || !data?.unread_update_count, on_select: () => update_notifications("read") },
      { action_id: "clear_read_updates", label: "清除已读更新", disabled: busy || !data?.items.some((item) => item.scope === "inbox" && item.read), on_select: () => update_notifications("clear_read") },
    ]} />
  </>}>
    {data ? <SidebarSubText><span aria-label={`应用角标 ${data.badge_count}，待处理 ${data.pending_request_count}，未读失败 ${data.unread_failure_count}`}>待处理 {data.pending_request_count} · 未读失败 {data.unread_failure_count}</span></SidebarSubText> : null}
    {busy ? <SidebarSubText><span role="status">正在更新通知…</span></SidebarSubText> : null}
    {state.update_error ? <SidebarSubText><span role="alert">操作失败：{state.update_error}，请重试。</span></SidebarSubText> : null}
    {state.error ? <SidebarSubText>暂时无法刷新，保留已有内容。</SidebarSubText> : null}
    {state.loading ? <SidebarSubText>正在读取收件箱…</SidebarSubText> : groups.map((group) => {
      const entries = inbox_entries(state.data, group.view);
      const count = group.view === "pending" ? data?.pending_request_count : data?.unread_update_count;
      return <SidebarSection key={group.view} label={<span className="inbox-section-label"><span>{group.label}</span>{count ? <span>{count}</span> : null}</span>}>
        {!entries.length ? <SidebarSubText>{state.error ? "请重试读取" : group.empty}</SidebarSubText> : entries.map((entry) => <SidebarItem
          key={entry.key}
          label={entry.title}
          description={<span className="inbox-row-meta"><span>{entry.source}</span><time dateTime={new Date(entry.created_at).toISOString()} title={full_time(entry.created_at)}>{relative_time(entry.created_at)}</time></span>}
          leading={<span className="inbox-row-icon"><InboxIcon kind={entry.kind} /></span>}
          trailing={entry.pending && !entry.pending.interaction.can_respond ? <span className="inbox-row-state">已中断</span>
            : entry.view === "updates" && entry.unread ? <span className="inbox-unread-dot" aria-label="未读" /> : undefined}
          actions={entry.update && entry.unread ? <Button size="icon" disabled={busy} aria_label={`标为已读：${entry.title}`} title="标为已读" on_click={() => void update_notifications("read", entry)}><InboxIcon kind="check" /></Button> : undefined}
          menu={entry.update ? <ItemMenu label={`更新操作：${entry.title}`} actions={[
            { action_id: "clear_update", label: "清除此更新", disabled: busy, on_select: () => update_notifications("clear", entry) },
          ]} /> : undefined}
          active={selected?.key === entry.key && view === entry.view}
          on_select={() => void choose(entry)}
        />)}
      </SidebarSection>;
    })}
  </Sidebar>;
}
