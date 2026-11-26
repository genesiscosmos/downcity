/** Inbox 阅读工作区：由宿主负责页面滚动，选中事项完整展开，加载、失败与未选择各有明确状态。 */
import { useEffect, useRef } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { inbox_entries } from "./InboxEntries.js";
import { InboxEntryDetail } from "./InboxDetail.js";
import { InboxIcon } from "./InboxIcon.js";
import { InboxMainviewHeader } from "./InboxMainviewHeader.js";

/** 主视图只组合公开投影与既有交互；不保存答案或独立业务计数。 */
export function InboxMainview({ store, options, ...props }: PowerMainviewComponentProps & {
  /** 两个 Renderer 插槽共用的临时状态。 */ store: InboxStore;
  /** 宿主表单、私密提交和来源导航适配。 */ options: NotificationRendererOptions;
}) {
  const { state, choose, close } = use_inbox(store, props);
  const { Page, EmptyState, LoadingState, Button } = props.ui.components;
  const detail_region = useRef<HTMLDivElement>(null);
  const data = state.data;
  const entries = inbox_entries(data, "all");
  const selected = state.selected;
  useEffect(() => {
    if (!selected) return;
    detail_region.current?.focus({ preventScroll: true });
    // 切换事项从页首开始阅读；同一事项的后台刷新不改变滚动位置。
    detail_region.current?.querySelector("[data-inbox-content]")?.scrollIntoView({ block: "start", inline: "nearest" });
  }, [selected?.key]);
  const next = inbox_entries(data, "pending").find((entry) => entry.key !== selected?.key);
  const unavailable = !!state.error || !!data?.unavailable_agents.includes(selected?.pending?.agent_id ?? "");
  const loading_failed = !data && !!state.error;
  return <div ref={detail_region} tabIndex={-1} className="inbox-workspace" role="region" aria-label="收件箱主页面">
      {selected ? <InboxEntryDetail key={selected.key} entry={selected} current={entries.find((entry) => entry.key === selected.key)}
        handled={state.handled.has(selected.key)} store={store} options={options} props={props}
        unavailable={unavailable} next={next} choose={choose} on_close={close} can_read={true} />
        : <><InboxMainviewHeader options={options} /><Page layout="detail"><div className="inbox-workspace-placeholder" role="status">
          {state.loading ? <LoadingState label="正在读取收件箱…" /> : <EmptyState
            icon={<InboxIcon kind={loading_failed ? "failure" : entries.length ? "inbox" : "check"} />}
            title={loading_failed ? "暂时无法读取收件箱" : entries.length ? "选择一个事项" : "收件箱已清空"}
            description={entries.length ? "查看通知，或回应 Agent 的请求。" : undefined}
            action={loading_failed ? <Button on_click={() => void store.refresh()}>重试</Button> : undefined}
          />}
        </div></Page></>}
    </div>;
}
