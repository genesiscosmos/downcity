/** 侧栏行首：图标或头像。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SIDEBAR_LEADING_ICON, sidebar_avatar_slot_class_name, sidebar_leading_class_name, type SidebarLeadingShape } from "./sidebarRow";

/**
 * 渲染行首节点。
 *
 * 形状由调用点声明（`shape`），槽宽由形状推出——两档一一对应：
 *
 * | 形状 | 槽 | 内容 |
 * | --- | --- | --- |
 * | `icon` | 16 | 单个图标 |
 * | `avatar` | 32 | 头像 |
 */
export function SidebarLeading({ children, shape = "avatar", className }: {
  /** 槽内内容。 */
  children?: ReactNode;
  /** 形状；默认 `avatar`（`agent` 变体的默认档）。 */
  shape?: SidebarLeadingShape;
  /** 附加样式。 */
  className?: string;
}) {
  return <span
    aria-hidden="true"
    className={cn(shape === "avatar" ? sidebar_avatar_slot_class_name : sidebar_leading_class_name(SIDEBAR_LEADING_ICON), className)}
  >{children}</span>;
}
