/** Inbox 主工作区：沿用宿主正文与滚动布局，仅展示当前事项详情或统一空态。 */
import { useEffect, useRef } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxEntryDetail } from "./InboxDetail.js";
import { InboxIcon } from "./InboxIcon.js";

/** 主视图只组合公开投影与既有交互；不保存答案或独立业务计数。 */
export function InboxMainview({ store, options, ...props }: PowerMainviewComponentProps & {
  /** 两个 Renderer 插槽共用的临时状态。 */ store: InboxStore;
  /** 宿主表单、私密提交和来源导航适配。 */ options: NotificationRendererOptions;
}) {
  const { state, choose, close } = use_inbox(store, props);
  const { Page, Activity, EmptyState } = props.ui.components;
  const detail_region = useRef<HTMLDivElement>(null);
  const data = state.data;
  const entries = inbox_entries(data, "all");
  const selected = state.selected;
  useEffect(() => {
    if (selected) detail_region.current?.focus();
  }, [selected?.key]);
  const next = inbox_entries(data, "pending").find((entry) => entry.key !== selected?.key);
  const unavailable = !!state.error || !!data?.unavailable_agents.includes(selected?.pending?.agent_id ?? "");
  const loading_failed = !data && !!state.error;
  return <Page layout="detail">
    <div ref={detail_region} tabIndex={-1} className="inbox-workspace" role="region" aria-label="事项详情">
      {selected ? <Activity><InboxEntryDetail key={selected.key} entry={selected} current={entries.find((entry) => entry.key === selected.key)}
        handled={state.handled.has(selected.key)} store={store} options={options} props={props}
        unavailable={unavailable} next={next} choose={choose} on_close={close} can_read={true} /></Activity>
        : <EmptyState
          icon={<InboxIcon kind={!state.loading && data && !entries.length ? "check" : "inbox"} />}
          title={state.loading ? "正在读取收件箱…" : loading_failed ? "暂时无法读取收件箱" : entries.length ? "选择一个事项" : "暂无事项"}
          description={entries.length ? "从侧栏选择事项，查看详情或完成处理。" : undefined}
        />}
    </div>
  </Page>;
}
