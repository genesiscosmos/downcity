/**
 * Activity 与 Inbox 共用的完整详情布局。统一可选头部、元信息、操作与正文的留白和对齐。
 * 不限制高度，不持有纵向滚动；长正文随所属页面滚动，代码和表格可横向阅读。
 */
import type { DetailContentProps } from "../types/detail-content";
import { cn } from "../lib/utils";
import { MarkdownViewProvider } from "./markdown/markdown_host_context";

/** 只在调用方挂载时渲染，保留原 DOM 属性、焦点与可访问区域语义。 */
export function DetailContent({ children, heading, heading_id, metadata, header_actions, actions, class_name, ...attributes }: DetailContentProps) {
  const has_header = Boolean(heading || metadata || header_actions || actions);
  return <div {...attributes} role={attributes.role ?? (heading ? "region" : undefined)} aria-labelledby={attributes["aria-labelledby"] ?? (heading ? heading_id : undefined)} className={cn("dc-detail-content", class_name)}>
    <MarkdownViewProvider text_size="compact">
      {has_header ? <header className="dc-detail-header">
        {heading || header_actions ? <div className="dc-detail-heading-row">
          {heading ? <h2 id={heading_id} className="dc-detail-heading">{heading}</h2> : null}
          {header_actions ? <div className="dc-detail-header-actions">{header_actions}</div> : null}
        </div> : null}
        {metadata ? <div className="dc-detail-metadata">{metadata}</div> : null}
        {actions ? <div className="dc-detail-actions">{actions}</div> : null}
      </header> : null}
      <div className="dc-detail-body">{children}</div>
    </MarkdownViewProvider>
  </div>;
}
