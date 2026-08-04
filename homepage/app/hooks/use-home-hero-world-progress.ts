/**
 * Hero World 固定叙事舞台的受控滚动进度。
 *
 * Hook 只在 Agent、Capabilities、City 与 Federation 的叙事区间内限制单次输入，
 * 避免一次大幅滚动跳过主体动画。完成 Federation 的当前手势只会停在地图，
 * 同一串连续滚轮事件无论惯性多长都不会被释放，只有下一串独立输入
 * 才会释放原生滚动。触屏则使用原生 touchend 作为手势边界。
 * 从下一 Section 向上重新进入接缝时，则在滚动过程中顺势吸回完整 Federation。
 */

import { useEffect, useRef, type RefObject } from "react";
import { useMotionValue, useSpring } from "framer-motion";

const progress_distance_in_viewports = 2;
const seam_distance_in_viewports = 0.18;
const maximum_step_in_viewports = 0.1;
const boundary_epsilon = 0.0005;
const wheel_gesture_idle_gap_in_milliseconds = 120;

/** 将数值限制在零到一之间。 */
function clamp_progress(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** 将不同 deltaMode 的滚轮输入统一换算为像素。 */
function normalize_wheel_delta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

/** 判断 Sticky 舞台是否仍完整覆盖当前视口。 */
function is_stage_active(section: HTMLElement) {
  const section_rect = section.getBoundingClientRect();
  return section_rect.top <= 1 && section_rect.bottom >= window.innerHeight - 1;
}

/** 为 Hero World 提供不会被大幅输入跳过的共享动画进度。 */
export function use_home_hero_world_progress(
  section_ref: RefObject<HTMLElement | null>,
  reduce_motion: boolean,
) {
  const target_progress = useMotionValue(0);
  const seam_progress = useMotionValue(0);
  const target_progress_ref = useRef(0);
  const last_touch_y_ref = useRef<number | null>(null);
  const touch_boundary_ref = useRef<"start" | "end" | null>(null);
  const last_native_scroll_y_ref = useRef(0);
  const last_wheel_event_time_ref = useRef<number | null>(null);
  const wheel_gesture_id_ref = useRef(0);
  const federation_hold_wheel_gesture_ref = useRef<number | null>(null);
  const upward_snap_active_ref = useRef(false);
  const world_progress = useSpring(target_progress, {
    stiffness: 460,
    damping: 42,
    mass: 0.22,
    restDelta: 0.0005,
  });

  useEffect(() => {
    const section = section_ref.current;
    if (!section || reduce_motion) return;

    /** 获取当前 Section 的文档坐标与主体动画的真实滚动预算。 */
    const get_scroll_geometry = () => {
      const section_top = section.getBoundingClientRect().top + window.scrollY;
      const progress_distance = window.innerHeight * progress_distance_in_viewports;
      return { section_top, progress_distance };
    };

    /** 同步 Motion 目标与真实页面位置。 */
    const set_progress = (next_progress: number) => {
      const safe_progress = clamp_progress(next_progress);
      const { section_top, progress_distance } = get_scroll_geometry();
      target_progress_ref.current = safe_progress;
      target_progress.set(safe_progress);
      window.scrollTo({
        top: section_top + safe_progress * progress_distance,
        behavior: "auto",
      });
    };

    /** 在叙事开始前只完成舞台吸顶，避免 Header 高度进入第一次动画步进。 */
    const approach_pinned_stage = (delta_y: number) => {
      const { section_top } = get_scroll_geometry();
      const maximum_delta = window.innerHeight * maximum_step_in_viewports;
      const limited_delta = Math.min(Math.max(0, delta_y), maximum_delta);

      window.scrollTo({
        top: Math.min(section_top, window.scrollY + limited_delta),
        behavior: "auto",
      });
    };

    /** 将输入位移转换为最多 0.1 个视口的小步进。 */
    const advance_progress = (delta_y: number, input_kind: "wheel" | "touch") => {
      const maximum_delta = window.innerHeight * maximum_step_in_viewports;
      const limited_delta = Math.sign(delta_y) * Math.min(Math.abs(delta_y), maximum_delta);
      const progress_delta = limited_delta / (window.innerHeight * progress_distance_in_viewports);
      const next_progress = clamp_progress(target_progress_ref.current + progress_delta);

      if (input_kind === "touch") {
        if (next_progress <= boundary_epsilon) touch_boundary_ref.current = "start";
        if (next_progress >= 1 - boundary_epsilon) touch_boundary_ref.current = "end";
      }
      set_progress(next_progress);
      return next_progress;
    };

    /** 完成世界动画的当前手势停在 Federation，下一次手势才能离场。 */
    const handle_wheel = (event: WheelEvent) => {
      const delta_y = normalize_wheel_delta(event);
      const section_rect = section.getBoundingClientRect();
      const last_wheel_event_time = last_wheel_event_time_ref.current;
      const starts_new_gesture =
        last_wheel_event_time === null ||
        event.timeStamp - last_wheel_event_time > wheel_gesture_idle_gap_in_milliseconds;

      if (starts_new_gesture) wheel_gesture_id_ref.current += 1;
      last_wheel_event_time_ref.current = event.timeStamp;

      if (upward_snap_active_ref.current) {
        if (delta_y < 0) {
          event.preventDefault();
          return;
        }
        upward_snap_active_ref.current = false;
      }

      if (delta_y > 0 && section_rect.top > 1 && section_rect.top < window.innerHeight) {
        event.preventDefault();
        approach_pinned_stage(delta_y);
        return;
      }

      if (!is_stage_active(section)) return;

      const { section_top, progress_distance } = get_scroll_geometry();
      const is_inside_seam = window.scrollY > section_top + progress_distance + 1;
      if (is_inside_seam) return;

      const progress = target_progress_ref.current;
      const leaving_from_start = delta_y < 0 && progress <= boundary_epsilon;
      if (leaving_from_start) return;

      const is_complete = progress >= 1 - boundary_epsilon;
      if (delta_y > 0 && is_complete) {
        const is_held_by_current_gesture =
          federation_hold_wheel_gesture_ref.current === wheel_gesture_id_ref.current;

        if (!is_held_by_current_gesture) {
          federation_hold_wheel_gesture_ref.current = null;
          return;
        }

        event.preventDefault();
        set_progress(1);
        return;
      }

      event.preventDefault();
      if (delta_y < 0) {
        federation_hold_wheel_gesture_ref.current = null;
      }

      const next_progress = advance_progress(delta_y, "wheel");
      if (delta_y > 0 && next_progress >= 1 - boundary_epsilon) {
        federation_hold_wheel_gesture_ref.current = wheel_gesture_id_ref.current;
      }
    };

    /** 记录触控手势的起始位置。 */
    const handle_touch_start = (event: TouchEvent) => {
      last_touch_y_ref.current = event.touches[0]?.clientY ?? null;
      touch_boundary_ref.current = null;
    };

    /** 将触控位移映射到同一受控进度，并在下一次手势自然越过边界。 */
    const handle_touch_move = (event: TouchEvent) => {
      const current_touch_y = event.touches[0]?.clientY;
      const last_touch_y = last_touch_y_ref.current;
      if (current_touch_y === undefined || last_touch_y === null) return;

      const delta_y = last_touch_y - current_touch_y;
      const section_rect = section.getBoundingClientRect();
      last_touch_y_ref.current = current_touch_y;

      if (upward_snap_active_ref.current) {
        if (delta_y < 0) {
          event.preventDefault();
          return;
        }
        upward_snap_active_ref.current = false;
      }

      if (delta_y > 0 && section_rect.top > 1 && section_rect.top < window.innerHeight) {
        event.preventDefault();
        approach_pinned_stage(delta_y);
        return;
      }

      if (!is_stage_active(section)) return;

      const { section_top, progress_distance } = get_scroll_geometry();
      const is_inside_seam = window.scrollY > section_top + progress_distance + 1;
      if (is_inside_seam) return;

      const progress = target_progress_ref.current;
      const leaving_from_start = delta_y < 0 && progress <= boundary_epsilon;
      const leaving_from_end = delta_y > 0 && progress >= 1 - boundary_epsilon;
      const can_leave_start = leaving_from_start && touch_boundary_ref.current !== "start";
      const can_leave_end = leaving_from_end && touch_boundary_ref.current !== "end";
      if (can_leave_start || can_leave_end) return;

      event.preventDefault();
      if (!leaving_from_start && !leaving_from_end) {
        advance_progress(delta_y, "touch");
      }
    };

    /** 清理当前触控手势状态。 */
    const handle_touch_end = () => {
      last_touch_y_ref.current = null;
      touch_boundary_ref.current = null;
    };

    /** 让键盘、滚动条与边界外的原生滚动同步主体动画进度。 */
    const handle_native_scroll = () => {
      const { section_top, progress_distance } = get_scroll_geometry();
      const current_scroll_y = window.scrollY;
      const scroll_delta = current_scroll_y - last_native_scroll_y_ref.current;
      const federation_anchor = section_top + progress_distance;
      const seam_distance = window.innerHeight * seam_distance_in_viewports;
      const is_returning_through_seam =
        scroll_delta < -boundary_epsilon &&
        current_scroll_y > federation_anchor &&
        current_scroll_y <= federation_anchor + seam_distance;

      last_native_scroll_y_ref.current = current_scroll_y;

      const native_progress = clamp_progress((current_scroll_y - section_top) / progress_distance);
      const native_seam_progress = clamp_progress(
        (current_scroll_y - federation_anchor) / seam_distance,
      );
      target_progress_ref.current = native_progress;
      target_progress.set(native_progress);
      seam_progress.set(native_seam_progress);

      if (is_returning_through_seam && !upward_snap_active_ref.current) {
        upward_snap_active_ref.current = true;
        federation_hold_wheel_gesture_ref.current = null;
        window.scrollTo({ top: federation_anchor, behavior: "smooth" });
      }
    };

    /** 滚动结束只负责结束向上吸附，不参与 Federation 离场解锁。 */
    const handle_scroll_end = () => {
      upward_snap_active_ref.current = false;
    };

    last_native_scroll_y_ref.current = window.scrollY;
    handle_native_scroll();
    window.addEventListener("wheel", handle_wheel, { passive: false });
    window.addEventListener("touchstart", handle_touch_start, { passive: true });
    window.addEventListener("touchmove", handle_touch_move, { passive: false });
    window.addEventListener("touchend", handle_touch_end, { passive: true });
    window.addEventListener("touchcancel", handle_touch_end, { passive: true });
    window.addEventListener("scroll", handle_native_scroll, { passive: true });
    document.addEventListener("scrollend", handle_scroll_end, { passive: true });

    return () => {
      window.removeEventListener("wheel", handle_wheel);
      window.removeEventListener("touchstart", handle_touch_start);
      window.removeEventListener("touchmove", handle_touch_move);
      window.removeEventListener("touchend", handle_touch_end);
      window.removeEventListener("touchcancel", handle_touch_end);
      window.removeEventListener("scroll", handle_native_scroll);
      document.removeEventListener("scrollend", handle_scroll_end);
    };
  }, [reduce_motion, seam_progress, section_ref, target_progress]);

  return { world_progress, seam_progress };
}
