/** ActivityItem 持有条目身份、展开状态及详情生命周期；头部和详情面板没有第二份状态。 */
import { createContext, useContext, useId, useState } from "react";
import type { ActivityItemProps, ActivityItemState } from "../types/activity-components";
import { cn } from "../lib/utils";
import { ActivityDetailPanel } from "./activity-detail-panel";

const activity_item_context = createContext<ActivityItemState | null>(null);

/** Header 必须位于 Item 中，避免生成脱离展开事实的独立按钮。 */
export function use_activity_item(): ActivityItemState {
  const item = useContext(activity_item_context);
  if (!item) throw new Error("ActivityHeader must be composed inside ActivityItem");
  return item;
}

/** 业务正文进入详情面板，活动分组直接展开条目；两者均收起即卸载并共享展开状态。 */
export function ActivityItem({ item_id, header, render_detail, render_items, open: controlled_open, default_open = false, on_open_change, detail_label, class_name }: ActivityItemProps) {
  const [local_open, set_local_open] = useState(default_open);
  const open = controlled_open ?? local_open;
  const instance_id = useId();
  const has_detail = Boolean(render_detail || render_items);
  const region_attributes = {
    id: `${instance_id}-detail`, role: "region", tabIndex: 0,
    "aria-label": detail_label, "aria-labelledby": detail_label ? undefined : `${instance_id}-header`,
  };
  const state: ActivityItemState = {
    item_id, has_detail, open, header_id: `${instance_id}-header`, detail_id: `${instance_id}-detail`, detail_label,
    toggle: () => {
      const next = !open;
      if (controlled_open === undefined) set_local_open(next);
      on_open_change?.(next);
    },
  };
  const content = <activity_item_context.Provider value={state}>
    {header}
    {has_detail && open ? render_items
      ? <div {...region_attributes}>{render_items()}</div>
      : <ActivityDetailPanel {...region_attributes}>{render_detail!()}</ActivityDetailPanel> : null}
  </activity_item_context.Provider>;
  return has_detail
    ? <details className={cn("activity-item", class_name)} data-activity-id={item_id} open={open}>{content}</details>
    : <div className={cn("activity-item", class_name)} data-activity-id={item_id}>{content}</div>;
}
