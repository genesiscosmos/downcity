/**
 * Inbox 主页面的唯一页头。Desktop 注入带窗口拖拽和侧栏避让的共享顶栏；
 * 普通宿主使用轻量标题与操作区。页头位于正文滚动区之外，各种事项状态共用。
 */
import type { ReactNode } from "react";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";

/** 只组合页面身份与用户操作，不持有事项或独立导航状态。 */
export function InboxMainviewHeader({ options, actions }: {
  /** 宿主提供的页面框架适配；不提供时渲染通用 Inbox 顶栏。 */
  options: NotificationRendererOptions;
  /** 当前事项的来源按钮和关闭操作；空态不提供操作。 */
  actions?: ReactNode;
}) {
  return options.render_mainview_header
    ? options.render_mainview_header(actions)
    : <header className="inbox-page-header"><span>Inbox</span><div className="inbox-detail-actions">{actions}</div></header>;
}
