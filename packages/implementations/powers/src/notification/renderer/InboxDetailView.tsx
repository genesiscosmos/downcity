/** Inbox 阅读工作区：由宿主负责页面滚动，选中事项完整展开，加载、失败与未选择各有明确状态。 */
import { useEffect, useRef, useState } from "react";
import type { PowerViewComponentProps } from "@downcity/city/power/react";
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxEntryDetail } from "./InboxDetail.js";
import { InboxIcon } from "./InboxIcon.js";

/** 主视图只组合公开投影与既有交互；不保存答案或独立业务计数。 */
export function Inbox_detail_view({ store, options, ...props }: PowerViewComponentProps & {
  /** 当前详情 tab 的独立临时状态。 */ store: InboxStore;
  /** 宿主表单、私密提交和来源导航适配。 */ options: NotificationRendererOptions;
}) {
  const { state } = use_inbox(store, props);
  const [initialized, set_initialized] = useState(false);
  useEffect(() => {
    if (initialized || !state.data) return;
    const entry = inbox_entries(state.data, "all").find((item) => item.key === props.input.entry_key);
    if (entry) store.select(entry);
    set_initialized(true);
  }, [state.data, props.input.entry_key, initialized, store]);
  const choose = async (entry: InboxEntry) => props.ui.open_view({
    view_id: "inbox_detail", resource_key: entry.key, title: entry.title, input: { entry_key: entry.key },
  });
  const { Page, EmptyState, LoadingState, Button } = props.ui.components;
  const detail_region = useRef<HTMLDivElement>(null);
  const data = state.data;
  const entries = inbox_entries(data, "all");
  const selected = state.selected;
  useEffect(() => {
    if (!selected || props.visible === false) return;
    detail_region.current?.focus({ preventScroll: true });
    // 切换事项从页首开始阅读；同一事项的后台刷新不改变滚动位置。
    detail_region.current?.querySelector("[data-inbox-content]")?.scrollIntoView({ block: "start", inline: "nearest" });
  }, [selected?.key, props.visible]);
  const next = inbox_entries(data, "pending").find((entry) => entry.key !== selected?.key);
  const unavailable = !!state.error || !!data?.unavailable_agents.includes(selected?.pending?.agent_id ?? "");
  const loading_failed = !data && !!state.error;
  return <div ref={detail_region} tabIndex={-1} className="inbox-workspace" role="region" aria-label="收件箱主页面">
      {selected ? <InboxEntryDetail key={selected.key} entry={selected} current={entries.find((entry) => entry.key === selected.key)}
        handled={state.handled.has(selected.key)} store={store} options={options} props={props}
        unavailable={unavailable} next={next} choose={choose} can_read={props.visible !== false} />
        : <><Page layout="detail"><div className="inbox-workspace-placeholder" role="status">
          {state.loading ? <LoadingState label="正在读取收件箱…" /> : <EmptyState
            icon={<InboxIcon kind={loading_failed ? "failure" : entries.length ? "inbox" : "check"} />}
            title={loading_failed ? "暂时无法读取收件箱" : entries.length ? "事项已不可用" : "收件箱已清空"}
            description={entries.length ? "返回 Inbox 页面选择其它事项。" : undefined}
            action={loading_failed ? <Button on_click={() => void store.refresh()}>重试</Button> : undefined}
          />}
        </div></Page></>}
    </div>;
}
