/** 主导航各业务 Sidebar 共用的顶部标题栏。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sidebar_heading_class_name } from "./sidebarRow";

/**
 * 渲染统一高度、内缩与标题层级的 Sidebar Header。
 *
 * ## 左缘来自契约，不写字面量
 *
 * 标题要落在**行首槽左缘**那条线上（见 `sidebarRow.ts` 的两条文字线）：
 * `40 + 8 + 8 = 56`。写成 `px-2` 加标题自己 `px-1`（旧写法）会得到第三条线，
 * 而写成 `pl-4` 虽然当下碰对了，改契约时它不会跟着动——两者都会变成漂移。
 *
 * ## 右侧动作为什么是 `pr-2`
 *
 * 行盒的右缘距面板边缘 8（滚动条槽位由 `.sidebar-body-scroll` 让出），
 * 因此标题与动作的右缘也用 8，标题与动作才会与下面那些行构成同一列。
 */
export function SidebarHeader({ title, actions }: {
  /** 当前 Sidebar 的用户可见标题。 */
  readonly title: ReactNode;
  /** 可选的右侧操作。 */
  readonly actions?: ReactNode;
}) {
  return <div className={cn("flex h-9 shrink-0 items-center gap-2", sidebar_heading_class_name)}>
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{title}</span>
    {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
  </div>;
}
