"use client";
import type { StatusPanelHeaderProps } from "../../types/status-panel";
/** StatusPanel 分类共用的 Header：统一高度、文字与留白，分类操作位于右侧且不随内容滚动。 */

/** Queue、Interaction、Sessions 的统一顶部行。 */
export function StatusPanelHeader({ title, source, actions }: StatusPanelHeaderProps) {
  return <header className="flex min-h-8 min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 text-2xs text-muted-foreground">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0">{title}</span>
      {source ? <div className="min-w-0 truncate text-subtle-foreground">{source}</div> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
  </header>;
}
