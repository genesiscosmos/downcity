/** Inbox 主工作区：固定列表面板包含标题、整理与滚动内容；右侧仅承载主动选择的事项。 */
import { useEffect, useRef } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxEntryDetail } from "./InboxDetail.js";
import { InboxList } from "./InboxList.js";
import { InboxIcon } from "./InboxIcon.js";

/** 主视图只组合公开投影与既有交互；不保存答案或独立业务计数。 */
export function InboxMainview({ store, options, ...props }: PowerMainviewComponentProps & {
  /** 两个 Renderer 插槽共用的临时状态。 */ store: InboxStore;
  /** 宿主表单、私密提交和来源导航适配。 */ options: NotificationRendererOptions;
}) {
  const { state, view, choose, close } = use_inbox(store, props);
  const { ItemMenu } = props.ui.components;
  const list_region = useRef<HTMLElement>(null);
  const detail_region = useRef<HTMLDivElement>(null);
  const data = state.data;
  const entries = inbox_entries(data, view);
  const selected = state.selected[view];
  const previous_selection = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selected) detail_region.current?.focus();
    else if (previous_selection.current) list_region.current?.focus();
    previous_selection.current = selected?.key;
  }, [selected?.key]);
  const all_entries = inbox_entries(data, "all");
  const busy = !!state.update_action;
  const title = { pending: "需要处理", updates: "通知", all: "全部事项" }[view];
  const connection_error = state.error || (data && (data.unavailable_agents.length || data.unavailable_groups.length)
    ? "部分来源暂时不可达，已保留当前内容。" : "");
  const update_notifications = async (operation: "read" | "clear" | "clear_read", entry?: InboxEntry) => {
    await store.update_notifications(operation, entry);
    props.ui.invalidate();
    if (selected && !store.get_snapshot().selected[view]) list_region.current?.focus();
  };
  const open_detail = async (entry: InboxEntry) => {
    await choose(entry);
    if (store.get_snapshot().selected[view]?.key === entry.key) detail_region.current?.focus();
  };
  const close_detail = async () => {
    await close();
    if (!store.get_snapshot().selected[view]) list_region.current?.focus();
  };
  return <div className="inbox-workspace">
    <div className="inbox-workspace-layout" data-detail-open={!!selected}>
      <div className="inbox-panes">
        <section ref={list_region} tabIndex={-1} className="inbox-list-pane" aria-label={title}>
          <header className="inbox-toolbar">
            <div className="inbox-toolbar-heading"><h1>{title}<span className="inbox-total">{entries.length}</span></h1></div>
            <div className="inbox-toolbar-actions">
              <button type="button" className="inbox-icon-button" aria-label="刷新收件箱" title="刷新" onClick={() => void store.refresh_sources()}><InboxIcon kind="refresh" /></button>
              <ItemMenu label="收件箱通知操作" reveal_on_hover={false} actions={[
                { action_id: "read_all_updates", label: "全部通知标为已读", disabled: busy || !data?.unread_update_count, on_select: () => update_notifications("read") },
                { action_id: "clear_read_updates", label: "清除已读通知", disabled: busy || !data?.items.some((item) => item.scope === "inbox" && item.read), on_select: () => update_notifications("clear_read") },
              ]} />
            </div>
          </header>
          {connection_error || state.update_error || busy ? <div className="inbox-notices">
            {connection_error ? <div className="inbox-connection" role="status"><span>暂时无法刷新全部来源，已有内容仍可查看。</span><button type="button" onClick={() => void store.refresh_sources()}>重试</button></div> : null}
            {state.update_error ? <p className="inbox-inline-error" role="alert">操作失败：{state.update_error}，请重试。</p> : null}
            {busy ? <span className="inbox-action-status" role="status">正在处理通知…</span> : null}
          </div> : null}
          <div className="inbox-list-scroll">
            {state.loading ? <div className="inbox-list-skeleton" role="status" aria-label="正在读取收件箱"><i /><i /><i /></div>
              : entries.length ? <InboxList entries={entries} selected_key={selected?.key} busy={busy} choose={open_detail} update_notifications={update_notifications} props={props} options={options} />
                : <div className="inbox-empty"><InboxIcon kind={view === "pending" ? "check" : "inbox"} />
                  <h2>{!data && state.error ? "暂时无法读取收件箱" : view === "pending" ? "当前没有需要处理的事项" : view === "all" ? "收件箱已清空" : "还没有通知"}</h2>
                  <p>{!data && state.error ? "请重试连接，恢复后会显示已有事项。" : view === "pending" ? "需要你回应的请求和未读失败会显示在这里。" : "Agent 的工作进展和结果会出现在这里。"}</p>
                </div>}
          </div>
        </section>
        <div ref={detail_region} tabIndex={selected ? -1 : undefined} className="inbox-detail-pane" role={selected ? "region" : undefined} aria-label={selected ? "事项详情" : undefined}>
          {selected ? <InboxEntryDetail key={selected.key} entry={selected} current={all_entries.find((entry) => entry.key === selected.key)}
            handled={state.handled.has(selected.key)} store={store} options={options} props={props}
            unavailable={!!state.error || !!data?.unavailable_agents.includes(selected.pending?.agent_id ?? "")}
            next={entries.find((entry) => entry.key !== selected.key)} choose={open_detail} on_close={close_detail} can_read={true} /> : null}
        </div>
      </div>
    </div>
  </div>;
}
