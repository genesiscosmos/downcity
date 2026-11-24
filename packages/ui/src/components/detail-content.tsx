/**
 * Activity 与 Inbox 共用的详情正文。统一留白、文字和内容节奏，复用宿主 Markdown 能力。
 * 不限制高度，不持有纵向滚动；长正文随所属页面滚动，代码和表格可横向阅读。
 */
import type { DetailContentProps } from "../types/detail-content";
import { cn } from "../lib/utils";
import { MarkdownViewProvider } from "./markdown/markdown_host_context";

/** 只在调用方挂载时渲染，保留原 DOM 属性、焦点与可访问区域语义。 */
export function DetailContent({ children, class_name, ...attributes }: DetailContentProps) {
  return <div {...attributes} className={cn("dc-detail-content", class_name)}>
    <MarkdownViewProvider text_size="compact">{children}</MarkdownViewProvider>
  </div>;
}
