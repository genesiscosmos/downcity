/** 工具活动的领域组合：将摘要投影组合为 ActivityItem + Header，不再持有独立折叠或详情结构。 */
import { useId } from "react";
import { ActivityItem } from "./activity-item";
import { ActivityHeader } from "./activity-header";
import type { ActivityRowProps } from "../types/activity-row";
import type { AgentActivityTone } from "../types/activity";
import { cn } from "../lib/utils";


/** 生命周期仅映射语气；Input 不使用 running 动画。 */
const activity_tone_class: Record<AgentActivityTone, string> = {
  running: "is-running", complete: "is-complete", failed: "is-failed", waiting: "is-complete",
};

/** 单条与分组共享同一折叠结构；收起即卸载正文，文件入口不触发展开。 */
export function ActivityRow({ item_id, open, on_open_change, icon, tone, diff_stat, state, identity, summary, summary_text, incoming, badge, render_body, render_items, render_extra_body, summary_class_name, show_chevron = true, detail_label }: ActivityRowProps) {
  const fallback_id = useId();
  const has_expandable = Boolean(render_body || render_extra_body);
  const summary_content = <span className="activity-tool-main">
    {icon}
    {state ? <span className="activity-tool-state">{state}</span> : null}
    {identity ? <span className="activity-tool-identity">{identity}</span> : null}
    {diff_stat ? <span className="activity-tool-pill activity-tool-diff-stat">
      {diff_stat.additions > 0 ? <span className="text-emerald-600 dark:text-emerald-400">+{diff_stat.additions}</span> : null}
      {diff_stat.deletions > 0 ? <span className="ml-1 text-red-500 dark:text-red-400">-{diff_stat.deletions}</span> : null}
    </span> : null}
    {summary ? <span className="activity-tool-target" title={summary_text ?? (typeof summary === "string" ? summary : undefined)}>{summary}</span> : null}
    {badge ? <span className="activity-tool-pill activity-tool-count">{badge}</span> : null}
  </span>;
  const row_class = cn("activity-tool-row", activity_tone_class[tone], incoming && "is-incoming");
  const summary_class = cn("activity-tool-summary", summary_class_name);
  return <ActivityItem item_id={item_id ?? fallback_id} open={open} on_open_change={on_open_change} class_name={row_class} detail_label={detail_label}
    header={<ActivityHeader class_name={summary_class} show_chevron={show_chevron}>{summary_content}</ActivityHeader>}
    render_items={render_items}
    render_detail={has_expandable ? () => <>{render_body?.()}{render_extra_body?.()}</> : undefined} />;
}
