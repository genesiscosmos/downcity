/** 活动行的唯一 DOM：来源、标题、目标、改动统计与按需详情；显式选择保持消息阅读位置。 */
import { useId, useState } from "react";
import { DetailContent } from "./detail-content";
import { TbChevronRight } from "react-icons/tb";
import type { ActivityRowProps } from "../types/activity-row";
import type { AgentActivityTone } from "../types/activity";
import { cn } from "../lib/utils";


/** 生命周期仅映射语气；Input 不使用 running 动画。 */
const activity_tone_class: Record<AgentActivityTone, string> = {
  running: "is-running", complete: "is-complete", failed: "is-failed", waiting: "is-complete",
};

/** 单条与分组共享同一折叠结构；收起即卸载正文，文件入口不触发展开。 */
export function ActivityRow({ open: controlled_open, on_open_change, icon, tone, diff_stat, state, identity, summary, summary_text, incoming, badge, render_body, render_extra_body, summary_class_name, show_chevron = true, detail_label }: ActivityRowProps) {
  const [local_open, set_local_open] = useState(false);
  const open = controlled_open ?? local_open;
  const set_choice = (next: boolean) => { set_local_open(next); on_open_change?.(next); };
  const detail_id = useId();
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
    {has_expandable && show_chevron ? <TbChevronRight className="activity-tool-chevron" aria-hidden /> : null}
  </span>;
  const row_class = cn("activity-tool-row", activity_tone_class[tone], incoming && "is-incoming");
  const summary_class = cn("activity-tool-summary", summary_class_name);
  if (!has_expandable) return <div className={row_class}><div className={summary_class}>{summary_content}</div></div>;
  return <details open={open} className={row_class}>
    <summary className={summary_class} aria-label={detail_label} aria-expanded={open} aria-controls={open && detail_label ? detail_id : undefined}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a[href], button")) return;
        event.preventDefault(); set_choice(!open);
      }}>{summary_content}</summary>
    {open ? detail_label ? <DetailContent id={detail_id} class_name="activity-tool-detail" tabIndex={0} role="region" aria-label={detail_label}>{render_body?.()}{render_extra_body?.()}</DetailContent>
      : <>{render_body?.()}{render_extra_body?.()}</> : null}
  </details>;
}
