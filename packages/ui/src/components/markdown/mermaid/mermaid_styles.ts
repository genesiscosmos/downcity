/**
 * Mermaid 图表控件的共享样式。
 *
 * 内联工具条与全屏浮层是两种视觉语境：前者是悬停才浮现的安静按钮，后者是始终可见、需要
 * 自带底色的浮层按钮。但两者的手感必须一致——尺寸、悬停反馈和键盘焦点指示在这里定义一次，
 * 浮层只追加自己的表面与投影。
 */

import { cn } from "../../../lib/utils";

/** 控件尺寸、图标与焦点反馈由同目录 mermaid.css 提供，不依赖宿主扫描工具类。 */
export const mermaid_action_button_class_name = "markdown-mermaid-action";

/** 全屏按钮复用基础反馈，再增加独立表面、阴影与稍大的点击区域。 */
export const mermaid_overlay_button_class_name = cn(mermaid_action_button_class_name, "markdown-mermaid-overlay-action");
