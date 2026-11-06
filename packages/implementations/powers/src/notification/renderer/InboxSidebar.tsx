/** Inbox 分类导航：只展示关注、通知和全部筛选，具体事项由主区域承载。 */
import type { PowerSidebarComponentProps } from "@downcity/city/power/react";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxIcon } from "./InboxIcon.js";

/** 侧栏与详情借用同一个Store，避免重复轮询及选择分叉。 */
export function InboxSidebar({ store, ...props }: PowerSidebarComponentProps & {
  /** Renderer工厂拥有的临时共享状态。 */ store: InboxStore;
}) {
  const { state, view, change_view } = use_inbox(store, props);
  const { Sidebar, SidebarSection, SidebarItem, SidebarSubText } = props.ui.components;
  const data = state.data;
  const groups = [
    { view: "pending" as const, label: "需要处理", icon: "approval" as const, count: data?.badge_count ?? 0 },
    { view: "updates" as const, label: "通知", icon: "update" as const, count: data?.unread_update_count ?? 0 },
    { view: "all" as const, label: "全部", icon: "inbox" as const, count: inbox_entries(data, "all").length },
  ];
  return <Sidebar>
    <SidebarSection>
      {groups.map((group) => <SidebarItem key={group.view} label={group.label}
        leading={<span className="inbox-nav-icon"><InboxIcon kind={group.icon} /></span>}
        trailing={<span className="inbox-nav-count">{group.count}</span>}
        active={view === group.view} disabled={!!state.busy_key}
        on_select={() => void change_view(group.view)} />)}
    </SidebarSection>
    {data && data.badge_count > 0 ? <SidebarSubText>待处理 {data.pending_request_count} · 未读失败 {data.unread_failure_count}</SidebarSubText> : null}
  </Sidebar>;
}
