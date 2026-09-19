/** 侧栏行首：图标 / 头像 / 带底块的图标。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SIDEBAR_LEADING_AVATAR, SIDEBAR_LEADING_ICON, sidebar_avatar_slot_class_name, sidebar_leading_class_name, sidebar_tile_class_name, type SidebarLeadingShape } from "./sidebarRow";

/**
 * 渲染行首节点。
 *
 * 形状由调用点声明（`shape`），槽宽由形状推出——三档一一对应：
 *
 * | 形状 | 槽 | 内容 |
 * | --- | --- | --- |
 * | `icon` | 16 | 单个图标 |
 * | `avatar` | 32 | 头像 |
 * | `tile` | 32 | 28px 圆角底块里的图标 |
 *
 * `avatar` 与 `tile` 都占 32：头像自己决定尺寸（槽位不声明图标尺寸），
 * 底块居中在 32 槽内（因此不引入新的文字线）。
 */
export function SidebarLeading({ children, shape = "avatar", className }: {
  /** 槽内内容。 */
  children?: ReactNode;
  /** 形状；默认 `avatar`（`agent` 变体的默认档）。 */
  shape?: SidebarLeadingShape;
  /** 附加样式。 */
  className?: string;
}) {
  if (shape === "tile") {
    // 底块居中在 32 槽里：槽不声明图标尺寸，底块自己声明（size-4）。
    return <span aria-hidden="true" className={cn(sidebar_leading_class_name(SIDEBAR_LEADING_AVATAR), className)}>
      <span className={sidebar_tile_class_name}>{children}</span>
    </span>;
  }
  return <span
    aria-hidden="true"
    className={cn(shape === "avatar" ? sidebar_avatar_slot_class_name : sidebar_leading_class_name(SIDEBAR_LEADING_ICON), className)}
  >{children}</span>;
}
