/** Duobox 应用壳的水平面板缩放行为。 */

import { useCallback, useEffect, useRef, useState } from "react";

/** 水平缩放 Hook 输入。 */
interface HorizontalResizeOptions {
  /** 拖拽边缘；右侧边缘向右增宽，左侧边缘向左增宽。 */
  resize_edge?: "left" | "right";
  /** 上次持久化的面板宽度。 */
  stored_width?: number | null;
  /** 允许的最小宽度。 */
  min_width: number;
  /** 允许的最大宽度。 */
  max_width: number;
  /** 没有持久化值时使用的默认宽度。 */
  default_width: number;
  /** 宽度提交后的回调。 */
  on_width_change(width: number): void;
}

/** 将面板宽度约束在 Duobox 壳允许的范围。 */
function clamp_width(width: number, min_width: number, max_width: number): number {
  return Math.max(min_width, Math.min(max_width, width));
}

/** 提供与 Duobox Sidebar 相同的拖拽缩放生命周期。 */
export function use_horizontal_resize(options: HorizontalResizeOptions) {
  const { stored_width, min_width, max_width, default_width, on_width_change, resize_edge = "right" } = options;
  const [is_resizing, set_is_resizing] = useState(false);
  const [current_width, set_current_width] = useState(() => clamp_width(stored_width ?? default_width, min_width, max_width));
  const start_x_ref = useRef(0);
  const start_width_ref = useRef(0);
  const current_width_ref = useRef(current_width);

  useEffect(() => {
    if (stored_width == null || is_resizing) return;
    set_current_width(clamp_width(stored_width, min_width, max_width));
  }, [is_resizing, max_width, min_width, stored_width]);

  const handle_resize_start = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    start_x_ref.current = event.clientX;
    start_width_ref.current = current_width;
    current_width_ref.current = current_width;
    set_is_resizing(true);
  }, [current_width]);

  useEffect(() => {
    if (!is_resizing) return;
    const previous_cursor = document.body.style.cursor;
    const previous_user_select = document.body.style.userSelect;
    const capture_layer = document.createElement("div");
    Object.assign(capture_layer.style, { position: "fixed", inset: "0", zIndex: "2147483647", cursor: "ew-resize" });
    document.body.appendChild(capture_layer);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const handle_mouse_move = (event: MouseEvent) => {
      const horizontal_delta = event.clientX - start_x_ref.current;
      const next_width = clamp_width(start_width_ref.current + (resize_edge === "left" ? -horizontal_delta : horizontal_delta), min_width, max_width);
      current_width_ref.current = next_width;
      set_current_width(next_width);
    };
    const handle_mouse_up = () => {
      on_width_change(current_width_ref.current);
      set_is_resizing(false);
    };
    document.addEventListener("mousemove", handle_mouse_move);
    document.addEventListener("mouseup", handle_mouse_up);
    return () => {
      document.removeEventListener("mousemove", handle_mouse_move);
      document.removeEventListener("mouseup", handle_mouse_up);
      capture_layer.remove();
      document.body.style.cursor = previous_cursor;
      document.body.style.userSelect = previous_user_select;
    };
  }, [is_resizing, max_width, min_width, on_width_change, resize_edge]);

  /**
   * 键盘调整宽度。
   *
   * 拖拽手柄以前只能鼠标操作：`aria-valuenow` 与方向键都不存在，键盘用户完全改不了面板宽度。
   * 步长 8px，按住 Shift 为 32px；方向键语义跟随边缘——向左边缘的面板，按左键是变宽。
   */
  const handle_resize_key_down = useCallback((event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 32 : 8;
    const outward = resize_edge === "left" ? -step : step;
    let next_width: number | null = null;
    if (event.key === "ArrowLeft") next_width = current_width - outward;
    if (event.key === "ArrowRight") next_width = current_width + outward;
    if (event.key === "Home") next_width = min_width;
    if (event.key === "End") next_width = max_width;
    if (next_width === null) return;
    event.preventDefault();
    const clamped = clamp_width(next_width, min_width, max_width);
    current_width_ref.current = clamped;
    set_current_width(clamped);
    on_width_change(clamped);
  }, [current_width, max_width, min_width, on_width_change, resize_edge]);

  // 手柄同时承担鼠标拖拽与键盘调整，因此 role=separator 上必须带完整可访问数值。
  const resize_handle_props = {
    role: "separator" as const,
    tabIndex: 0,
    "aria-orientation": "vertical" as const,
    "aria-valuenow": Math.round(current_width),
    "aria-valuemin": min_width,
    "aria-valuemax": max_width,
    onKeyDown: handle_resize_key_down,
  };

  return { current_width, is_resizing, handle_resize_start, resize_handle_props };
}
