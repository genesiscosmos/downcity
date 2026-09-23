/** 窗口级面板的缩放把手：左右两侧共用同一套几何与交互。 */

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ResizeHandleProps } from "@/hooks/use_horizontal_resize";
import { SHELL_RESIZE_HANDLE_WIDTH_CSS } from "./shellMotion";

/**
 * 面板朝正文那条边上的缩放把手。
 *
 * ## 为什么贴在面板内缘、不向外扩
 *
 * 正文与面板横向齐平（两者都没有留白、没有边框），因此面板朝正文的那条内缘
 * 就是用户看到的边界。把手贴在这条内缘上，抓取区与视觉边界重合，中间没有拖不动的死区。
 *
 * 历史上正文卡片整体内缩 4px，把手必须跨过那段留白才不会比视觉边界偏 4px——
 * 那段外扩随留白与卡片一起取消。若将来重新给正文加回留白，把手必须同步跨过去。
 *
 * ## 为什么把手必须挂在「不被裁切」的层上
 *
 * 面板为了折叠动画带 overflow-hidden（收起时里面固定宽度的内容要跟着被裁掉），
 * 负偏移放进裁切层会被裁掉一半：左侧把手历史上就是这样，6px 抓握区实际只剩 3px，
 * 而右侧是完整 6px——同一件事两侧手感不一样。所以两个面板都把把手放在动画层**之外**、
 * 与动画层同级（见 ShellPanel），并由列元素提供定位基准。
 *
 * ## 指示条的位置
 *
 * 指示条停在把手朝正文的一侧，也就是贴着面板与正文的公共边界。
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
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  // 把手整高覆盖顶栏拖拽带：它自己也必须是 no-drag，否则按住上端会拖动窗口而不是改宽度。
  const style: CSSProperties = side === "right"
    ? { ...no_drag_style, right: 0, width: SHELL_RESIZE_HANDLE_WIDTH_CSS }
    : { ...no_drag_style, left: 0, width: SHELL_RESIZE_HANDLE_WIDTH_CSS };

  return <div
    {...resize_handle_props}
    aria-label={label}
    onMouseDown={on_resize_start}
    style={style}
    className={cn(
      "group absolute top-0 z-20 flex h-full cursor-ew-resize items-center outline-none",
      // 指示条靠向正文一侧：左侧面板的正文在右、右侧面板的正文在左。
      side === "right" ? "justify-end" : "justify-start",
    )}
  >
    <span className="m-px h-8 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground" />
  </div>;
}
