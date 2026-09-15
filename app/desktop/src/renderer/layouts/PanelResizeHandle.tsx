/** 窗口级面板的缩放把手：左右两侧共用同一套几何与交互。 */

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ResizeHandleProps } from "@/hooks/use_horizontal_resize";
import { SHELL_RESIZE_HANDLE_BLEED_CSS, SHELL_RESIZE_HANDLE_WIDTH_CSS } from "./shellMotion";

/**
 * 面板朝卡片那条边上的缩放把手。
 *
 * ## 为什么向卡片一侧外扩一个留白
 *
 * 面板是窗口级的一列，卡片却整体内缩 SHELL_MAIN_VIEW_OFFSET，两者边缘并不重合。
 * 用户看到的边界是卡片边缘（浅色主题下就是那条白边），因此把手必须跨过这段留白：
 * 外缘落在卡片边缘上、内缘留在面板内。只贴面板边缘时，抓取区比视觉边界向外偏 4px，
 * 中间那段留白反而谁也拖不动。
 *
 * 外缘因此**不越过卡片边框**：多扩一点就会盖住卡片内容，少扩一点就退回死区。
 *
 * ## 为什么把手必须挂在「不被裁切」的层上
 *
 * 面板为了折叠动画带 overflow-hidden（收起时里面固定宽度的内容要跟着被裁掉），
 * 负偏移放进裁切层会被裁掉一半：左侧把手历史上就是这样，6px 抓握区实际只剩 3px，
 * 而右侧是完整 6px——同一件事两侧手感不一样。所以两个面板都把把手放在动画层**之外**、
 * 与动画层同级（见 SidebarFrame 与 BayBar 的列结构），并由列元素提供定位基准。
 *
 * ## 指示条的位置
 *
 * 指示条停在留白里（4px 留白、2px 条、两侧各留 1px），也就是贴着卡片边缘；
 * 若把它居中在整条把手上，它会落进面板内部、离开用户看到的那条边界。
 *
 * 焦点指示沿用原来的做法：应用全局关闭了 outline，把手自己用 focus-visible 点亮指示条。
 * 把手是 role="separator" 的真实控件，方向键 / Home / End 都能调整宽度。
 */
export function PanelResizeHandle({ side, label, resize_handle_props, on_resize_start }: {
  /** 把手贴在哪条边：左侧面板用 right（贴面板右缘），右侧面板用 left（贴面板左缘）。 */
  side: "left" | "right";
  /** 可访问名称。 */
  label: string;
  /** use_horizontal_resize 提供的 role / aria / 键盘处理。 */
  resize_handle_props: ResizeHandleProps;
  /** 鼠标拖拽起点。 */
  on_resize_start(event: React.MouseEvent): void;
}) {
  // 外扩量按边缘方向取负：右缘向右扩、左缘向左扩。
  const bleed = `calc(-1 * ${SHELL_RESIZE_HANDLE_BLEED_CSS})`;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  // 把手整高覆盖顶栏拖拽带：它自己也必须是 no-drag，否则按住上端会拖动窗口而不是改宽度。
  const style: CSSProperties = side === "right"
    ? { ...no_drag_style, right: bleed, width: SHELL_RESIZE_HANDLE_WIDTH_CSS }
    : { ...no_drag_style, left: bleed, width: SHELL_RESIZE_HANDLE_WIDTH_CSS };

  return <div
    {...resize_handle_props}
    aria-label={label}
    onMouseDown={on_resize_start}
    style={style}
    className={cn(
      "group absolute top-0 z-20 flex h-full cursor-ew-resize items-center outline-none",
      // 指示条靠向卡片一侧：左侧面板的卡片在右、右侧面板的卡片在左。
      side === "right" ? "justify-end" : "justify-start",
    )}
  >
    <span className="m-px h-8 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground" />
  </div>;
}
