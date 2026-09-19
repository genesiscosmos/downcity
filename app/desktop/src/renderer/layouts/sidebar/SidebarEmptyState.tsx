/**
 * 侧栏空态：所有面板共用一句话 + 一个入口。
 *
 * ## 为什么要合一
 *
 * 侧栏此前有四套空态：Chat 与 Workspace 是「图标 + 一句 + 主按钮」，
 * Power 是纯文字，Power 的缺失插槽又是另一段纯文字。而 Workspace 那套更具体——
 * 标题与按钮文案**完全相同**（都是「添加 Workspace」），旁边还放着一条没人用的
 * 「还没有 Workspace」。用户看到的是一句被念了两遍的话。
 *
 * 所以这里定下两条：
 *
 * 1. **标题陈述状态，按钮陈述动作**。状态与动作是两件事，各说各的，不重复。
 * 2. **不用主区域那套大空态**（`PowerRendererComponents` 的 `EmptyState`：`size-9` 图标底、
 *    `min-h-64`、`text-base` 标题）。侧栏只有 232–400px 宽，那套留白会把列表区占满，
 *    看起来像内容加载失败。
 */
import type { ReactNode } from "react";

/** 侧栏空态属性。 */
interface SidebarEmptyStateProps {
  /** 语义图标；与行的图标同档（20px）。 */
  readonly icon: ReactNode;
  /** 状态陈述，例如「还没有 Workspace」。 */
  readonly title: string;
  /** 可选的首要动作；不提供时只显示状态。 */
  readonly action?: ReactNode;
}

/** 渲染侧栏统一的空态。 */
export function SidebarEmptyState({ icon, title, action }: SidebarEmptyStateProps) {
  return <div className="flex flex-col items-center px-4 py-10 text-center">
    <span aria-hidden="true" className="mb-2 flex size-5 items-center justify-center text-muted-foreground [&_svg]:size-5">{icon}</span>
    <div className="text-xs text-foreground">{title}</div>
    {action ? <div className="mt-3">{action}</div> : null}
  </div>;
}
