/** Inbox 事项侧栏：标题菜单固定使用省略号，事项状态由各行菜单与详情展示。 */
import { useEffect, useRef } from "react";
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import type { InboxEntry } from "../types/Inbox.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxList } from "./InboxList.js";
import { InboxIcon } from "./InboxIcon.js";

/** 侧栏与详情借用同一个Store，避免重复轮询及选择分叉。 */
export function InboxSidebar({ store, options, ...props }: PowerSidebarComponentProps & {
  /** Renderer 工厂拥有的临时共享状态。 */ store: InboxStore;
  /** 与详情共用的宿主头像和关注状态适配。 */ options: NotificationRendererOptions;
}) {
  const { state, choose } = use_inbox(store, props);
  const { Sidebar, SidebarSection, SidebarSubText, ItemMenu, EmptyState, LoadingState } = props.ui.components;
  const data = state.data;
  const list_region = useRef<HTMLDivElement>(null);
  const previous_selection = useRef(state.selected?.key);
  useEffect(() => {
    if (!state.selected && previous_selection.current) list_region.current?.focus();
    previous_selection.current = state.selected?.key;
  }, [state.selected?.key]);
  const entries = inbox_entries(data, "all");
  const attention_keys = new Set(inbox_entries(data, "pending").map((entry) => entry.key));
  // 失效请求仍可查看；未读失败只在关注组展示，阅读后自然归入通知组。
  const groups = [
    { key: "pending", label: "需要处理", entries: entries.filter((entry) => entry.pending || attention_keys.has(entry.key)), count: data?.badge_count ?? 0 },
    { key: "updates", label: "通知", entries: entries.filter((entry) => !entry.pending && !attention_keys.has(entry.key)), count: (data?.unread_update_count ?? 0) - (data?.unread_failure_count ?? 0) },
  ];
  const update_notifications = async (operation: "read" | "clear" | "clear_read", entry?: InboxEntry) => {
    await store.update_notifications(operation, entry);
    props.ui.invalidate();
  };
  const busy = !!state.update_action;
  return <Sidebar actions={
    <ItemMenu label="收件箱操作" actions={[
      { action_id: "read_all_updates", label: "全部通知标为已读", disabled: busy || !data?.unread_update_count, on_select: () => update_notifications("read") },
      { action_id: "clear_read_updates", label: "清除已读通知", disabled: busy || !data?.items.some((item) => item.scope === "inbox" && item.read), on_select: () => update_notifications("clear_read") },
    ]} />
  }>
    <div ref={list_region} tabIndex={-1} className="inbox-sidebar-items" role="region" aria-label="收件箱事项">
      {state.update_error ? <SidebarSubText><span className="inbox-inline-error" role="alert" title={state.update_error}>通知整理失败，请重试。</span></SidebarSubText> : null}
      {state.loading || !data || !entries.length ? <div className="inbox-sidebar-placeholder" role="status">
        {state.loading ? <LoadingState label="正在读取收件箱…" />
          : !data ? <EmptyState size="compact" title="暂时无法读取" description="再次点击 Inbox 重试" icon={<span className="inbox-empty-icon"><InboxIcon kind="failure" /></span>} />
            : <EmptyState size="compact" title="暂无通知" icon={<span className="inbox-empty-icon"><InboxIcon kind="inbox" /></span>} />}
      </div> : groups.filter((group) => group.entries.length).map((group) => <SidebarSection key={group.key} spacing="comfortable" label={<span className="inbox-group-label">{group.label}{group.count > 0 ? <span>{group.count}</span> : null}</span>}>
        <InboxList entries={group.entries} selected_key={state.selected?.key} busy={busy} choose={choose} update_notifications={update_notifications} props={props} options={options} />
      </SidebarSection>)}
    </div>
  </Sidebar>;
}
