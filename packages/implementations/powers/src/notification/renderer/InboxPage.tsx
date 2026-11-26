/** Inbox 完整资源页：按关注与通知组织内容预览，统一承载整理操作、读取重试和列表焦点。 */
import { useState } from "react";
import type { PowerPageComponentProps } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import type { InboxEntry } from "../types/Inbox.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxList } from "./InboxList.js";
import { InboxIcon } from "./InboxIcon.js";

/** 列表只打开独立详情视图，不挂载交互表单。 */
export function Inbox_page({ store, options, ...props }: PowerPageComponentProps & {
  /** Renderer 工厂拥有的临时共享状态。 */ store: InboxStore;
  /** 与详情共用的宿主头像和关注状态适配。 */ options: NotificationRendererOptions;
}) {
  const { state } = use_inbox(store, props);
  const [query, set_query] = useState("");
  const [filter, set_filter] = useState("all");
  const choose = async (entry: InboxEntry) => props.ui.open_view({
    view_id: "inbox_detail", resource_key: entry.key, title: entry.title, input: { entry_key: entry.key },
  });
  const { Page, Inline, List, Input, Tabs, ListSection, ListHint, ItemMenu, EmptyState, LoadingState, Button } = props.ui.components;
  const data = state.data;
  const entries = inbox_entries(data, "all").filter((entry) => `${entry.title} ${entry.summary ?? ""} ${entry.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  const attention_keys = new Set(inbox_entries(data, "pending").map((entry) => entry.key));
  // 失效请求仍可查看；未读失败只在关注组展示，阅读后自然归入通知组。
  const groups = [
    { key: "pending", label: "需要处理", entries: entries.filter((entry) => entry.pending || attention_keys.has(entry.key)), count: data?.badge_count ?? 0 },
    { key: "updates", label: "通知", entries: entries.filter((entry) => !entry.pending && !attention_keys.has(entry.key)), count: (data?.unread_update_count ?? 0) - (data?.unread_failure_count ?? 0) },
  ];
  const visible_groups = groups.filter((group) => group.entries.length > 0 && (filter === "all" || filter === group.key));
  const has_visible_entries = visible_groups.length > 0;
  const update_notifications = async (operation: "read" | "clear" | "clear_read", entry?: InboxEntry) => {
    await store.update_notifications(operation, entry);
    props.ui.invalidate();
  };
  const busy = !!state.update_action;
  return <Page><List toolbar={<Inline><Input type="search" value={query} placeholder="搜索事项…" on_value_change={set_query} /><Tabs value={filter} label="事项分类" items={[{ value: "all", label: "全部" }, { value: "pending", label: "需要处理" }, { value: "updates", label: "通知" }]} on_value_change={set_filter} /></Inline>} actions={
    <ItemMenu label="收件箱操作" actions={[
      { action_id: "read_all_updates", label: "全部通知标为已读", disabled: busy || !data?.unread_update_count, on_select: () => update_notifications("read") },
      { action_id: "clear_read_updates", label: "清除已读通知", disabled: busy || !data?.items.some((item) => item.scope === "inbox" && item.read), on_select: () => update_notifications("clear_read") },
    ]} />
  }>
    <div className="inbox-resource-items" role="region" aria-label="收件箱事项">
      {state.error && data ? <ListHint><span className="inbox-refresh-notice" role="status">内容暂未更新<Button on_click={() => void store.refresh()}>重试</Button></span></ListHint> : null}
      {state.update_error ? <ListHint><span className="inbox-inline-error" role="alert" title={state.update_error}>通知整理失败，请重试。</span></ListHint> : null}
      {state.loading || !data || !has_visible_entries ? <div className="inbox-resource-placeholder" role="status">
        {state.loading ? <LoadingState label="正在读取收件箱…" />
          : !data ? <EmptyState size="compact" title="暂时无法读取" action={<Button on_click={() => void store.refresh()}>重试</Button>} icon={<span className="inbox-empty-icon"><InboxIcon kind="failure" /></span>} />
            : <EmptyState size="compact" title="暂无事项" icon={<span className="inbox-empty-icon"><InboxIcon kind="inbox" /></span>} />}
      </div> : visible_groups.map((group) => <ListSection key={group.key} spacing="comfortable" label={<span className="inbox-group-label">{group.label}{group.count > 0 ? <span>{group.count}</span> : null}</span>}>
        <InboxList entries={group.entries} busy={busy} choose={choose} update_notifications={update_notifications} props={props} options={options} />
      </ListSection>)}
    </div>
  </List></Page>;
}
