/**
 * ActivityItem 的唯一详情面板：工具、Input 与 Inbox 共用同一留白、表面及紧凑 Markdown。
 * 不包含 Header；外层限制高度并滚动，内层提供留白，滚动条始终位于面板边缘。
 */
import type { ActivityDetailPanelProps } from "../types/activity-components";
import { get_markdown_text_size } from "./markdown/markdown_text_size";
import { MarkdownViewProvider } from "./markdown/markdown_host_context";

/** 普通正文与嵌入 Markdown 共用同一个受控字号档位。 */
const detail_text_size = "compact";

/** 属性直接透传，保留 Item 创建的 region ID、可访问名称和焦点能力。 */
export function ActivityDetailPanel({ children, ...attributes }: ActivityDetailPanelProps) {
  return <div {...attributes} className="activity-detail-panel">
    <div className="activity-detail-content downcity-writing-text" style={{ fontSize: get_markdown_text_size(detail_text_size) }}>
      <MarkdownViewProvider text_size={detail_text_size}>{children}</MarkdownViewProvider>
    </div>
  </div>;
}
