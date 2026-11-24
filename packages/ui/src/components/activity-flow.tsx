/** Desktop 活动的共享分组：推理切断分组，等待优先于失败，收起时不挂载日志。 */
import type { AgentActivityPart } from "../types/chat-blocks";
import type { ActivityFlowProps } from "../types/activity-flow";
import type { ActivityRowProps } from "../types/activity-row";
import { ActivityRow } from "./activity-row";

/** 单条原位展示，多条使用相同摘要与按需详情外壳。 */
export function ActivityFlow({ parts, summarize, render_item, render_group }: ActivityFlowProps) {
  const groups: AgentActivityPart[][] = [];
  for (const part of parts) {
    const previous = groups[groups.length - 1];
    if (part.type !== "reasoning" && previous && previous[0].type !== "reasoning") previous.push(part);
    else groups.push([part]);
  }
  if (!groups.length) return null;
  return <div className="agent-process-body">{groups.map(group => {
    if (group.length === 1) return <div key={group[0].part_id}>{render_item(group[0])}</div>;
    const rows = group.map(summarize);
    const latest = [...rows].reverse();
    const summary = latest.find(row => row.tone === "waiting") ?? latest.find(row => row.tone === "failed") ?? rows[rows.length - 1];
    const props: ActivityRowProps = {
      ...summary,
      badge: `+${group.length - 1}`,
      summary_class_name: "activity-tool-group-summary",
      render_body: () => <div className="activity-tool-group-body">{group.map(part => <div className="activity-tool-log" key={part.part_id}>{render_item(part)}</div>)}</div>,
    };
    return <div key={group[0].part_id}>{render_group ? render_group(props, group[0].part_id) : <ActivityRow {...props} />}</div>;
  })}</div>;
}
