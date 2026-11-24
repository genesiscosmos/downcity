/** Desktop 活动的共享分组：推理切断分组，等待优先于失败，收起时不挂载日志。 */
import { Fragment } from "react";
import type { AgentActivityPart } from "../types/chat-blocks";
import type { ActivityFlowProps } from "../types/activity-flow";
import type { ActivityRowProps } from "../types/activity-row";
import { ActivityRow } from "./activity-row";
import { Activity } from "./activity";

/** 单条原位展示，多条直接展开原有缩进列表；分组容器不使用业务详情面板。 */
export function ActivityFlow({ parts, summarize, render_item, render_group }: ActivityFlowProps) {
  const groups: AgentActivityPart[][] = [];
  for (const part of parts) {
    const previous = groups[groups.length - 1];
    if (part.type !== "reasoning" && previous && previous[0].type !== "reasoning") previous.push(part);
    else groups.push([part]);
  }
  if (!groups.length) return null;
  return <Activity class_name="agent-process-body">{groups.map(group => {
    if (group.length === 1) return <Fragment key={group[0].part_id}>{render_item(group[0])}</Fragment>;
    const rows = group.map(summarize);
    const latest = [...rows].reverse();
    const summary = latest.find(row => row.tone === "waiting") ?? latest.find(row => row.tone === "failed") ?? rows[rows.length - 1];
    const props: ActivityRowProps = {
      ...summary, item_id: group[0].part_id,
      badge: `+${group.length - 1}`,
      summary_class_name: "activity-tool-group-summary",
      render_body: undefined,
      render_items: () => <Activity class_name="activity-tool-group-body">{group.map(part => <Fragment key={part.part_id}>{render_item(part)}</Fragment>)}</Activity>,
    };
    return <Fragment key={group[0].part_id}>{render_group ? render_group(props, group[0].part_id) : <ActivityRow {...props} />}</Fragment>;
  })}</Activity>;
}
