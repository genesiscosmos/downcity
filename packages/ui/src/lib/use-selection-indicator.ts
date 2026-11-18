/**
 * 胶囊控件的共享选中背景：横向分段器和纵向导航使用相同的测量、过渡与隐藏规则。
 * 背景与选项必须位于同一相对定位容器，滚动时随内容移动，无须额外校正滚动偏移。
 * 首次显示和尺寸变化直接定位，只有有效选项之间的切换播放动画。
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import type { SelectionIndicatorLayout } from "../types/selection-indicator";

/** 共享选中背景样式；系统要求减少动态效果时直接切换。 */
export const selection_indicator_class_name = "pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-control-hover opacity-0 transition-[width,height,transform,opacity] duration-200 ease-out motion-reduce:transition-none";

/** 测量当前选项；选项列表变化时重新观察尺寸，不干预调用方的导航或键盘语义。 */
export function use_selection_indicator<Element extends HTMLElement>(
  active_value: string | undefined,
  options: readonly unknown[],
  option_selector: string,
  active_selector: string,
) {
  const group_ref = useRef<Element>(null);
  const indicator_ref = useRef<HTMLSpanElement>(null);
  const layout_ref = useRef<SelectionIndicatorLayout | null>(null);
  const update_indicator = useCallback(() => {
    const group = group_ref.current;
    const indicator = indicator_ref.current;
    if (!group || !indicator) return;
    const active_option = group.querySelector<HTMLElement>(active_selector);
    if (active_value === undefined || !active_option || active_option.offsetWidth === 0 || active_option.offsetHeight === 0 || active_option.getClientRects().length === 0) {
      indicator.style.transition = "none";
      indicator.style.opacity = "0";
      layout_ref.current = null;
      return;
    }
    const next_layout: SelectionIndicatorLayout = {
      value: active_value,
      left: active_option.offsetLeft,
      top: active_option.offsetTop,
      width: active_option.offsetWidth,
      height: active_option.offsetHeight,
    };
    const previous_layout = layout_ref.current;
    // 重复尺寸通知不得中断正在进行的选项切换动画。
    if (previous_layout
      && previous_layout.value === next_layout.value
      && previous_layout.left === next_layout.left
      && previous_layout.top === next_layout.top
      && previous_layout.width === next_layout.width
      && previous_layout.height === next_layout.height) return;
    if (previous_layout && previous_layout.value !== next_layout.value) {
      // 提交先前位置后再启用过渡，避免初始化与切换被浏览器合并为同一帧。
      indicator.getBoundingClientRect();
      indicator.style.removeProperty("transition");
    } else {
      indicator.style.transition = "none";
    }
    indicator.style.width = `${next_layout.width}px`;
    indicator.style.height = `${next_layout.height}px`;
    indicator.style.transform = `translate3d(${next_layout.left}px, ${next_layout.top}px, 0)`;
    indicator.style.opacity = "1";
    layout_ref.current = next_layout;
  }, [active_value, active_selector]);

  useLayoutEffect(() => {
    update_indicator();
    const group = group_ref.current;
    if (!group) return;
    const resize_observer = new ResizeObserver(update_indicator);
    resize_observer.observe(group);
    group.querySelectorAll<HTMLElement>(option_selector).forEach((option) => resize_observer.observe(option));
    return () => resize_observer.disconnect();
  }, [options, option_selector, update_indicator]);

  return { group_ref, indicator_ref };
}
