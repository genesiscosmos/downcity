/**
 * Mermaid 图表控件的共享样式。
 *
 * 内联工具条与全屏浮层是两种视觉语境：前者是悬停才浮现的安静按钮，后者是始终可见、需要
 * 自带底色的浮层按钮。但两者的手感必须一致——尺寸、悬停反馈和键盘焦点指示在这里定义一次，
 * 浮层只追加自己的表面与投影。
 */

import { cn } from "@/lib/utils";

/**
 * 图表操作按钮的基础样式。
 *
 * 应用全局关闭了默认 outline，所以焦点指示必须由元素自己声明；这条类名包含
 * `focus-visible` 环，所有图表按钮都必须使用它（见 tests/design_token_drift.test.ts）。
 */
export const mermaid_action_button_class_name =
  "flex size-6 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * 全屏浮层里的图表按钮。
 *
 * 与内联工具条相比，这里的按钮始终可见、且压在图表内容上，所以需要自己的表面与投影，
 * 尺寸也放大一档。它包含上面的焦点环（见 tests/design_token_drift.test.ts 的白名单）。
 */
export const mermaid_overlay_button_class_name = cn(mermaid_action_button_class_name, "size-8 rounded-control border border-border bg-popover shadow-lg [&_svg]:size-4");
