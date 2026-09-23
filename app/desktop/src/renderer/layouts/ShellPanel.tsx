/**
 * 窗口级面板的外壳：两侧面板共用的列结构、折叠动画与宽度约束。
 *
 * ## 结构
 *
 * ```text
 * div（列，relative：把手的定位基准，也是量窗口行的锚点）
 * ├── motion.aside（折叠动画的裁切层，overflow-hidden）
 * │   └── div（固定宽度内容层，flex-col）
 * │       └── 面板自己的 header 与内容
 * └── PanelResizeHandle（与裁切层同级）
 * ```
 *
 * ## 四条不能破的约束
 *
 * 1. **把手必须与裁切层同级。** 裁切层带 overflow-hidden（收起时里面的固定宽度内容要被裁掉），
 *    把手放进它里面时负偏移会被裁掉一半——左侧面板历史上就是这样，6px 抓握区实际只剩 3px，
 *    而右侧是完整 6px，同一件事两侧手感不一样。
 * 2. **宽度只有一份。** 裁切层动画到 0、内容层始终保持固定宽度：内容因此是被裁掉，
 *    而不是被压扁（压扁会让文字在收起过程中反复重排）。
 * 3. **收起时内容不可交互。** 宽度归零后面板里仍有可聚焦元素，键盘用户会 Tab 进一片看不见的区域。
 *    内容层收起时带 `inert`，它同时移出可访问树与 Tab 顺序。
 * 4. **宽度上限由窗口实时算出来，不写死。** 见下节。
 *
 * ## 宽度上限为什么在本层算
 *
 * 上限 = 窗口行宽 − 正文下限 − 另一侧占宽（规则在 `resolve_panel_max_width`）。
 * 三项都是实测值，而本层的外层 div 就是窗口行的直接子元素，量它一次即可：
 *
 * - 行宽：本层父元素的 `getBoundingClientRect().width`；
 * - 正文下限：读 `main` 的 computed min-width（JS 与 CSS 只有一份事实，缩放不可能各算各的）；
 * - 另一侧占宽：按 `data-shell-panel` 找到那一列量它的宽度。
 *
 * 两个元素都要观察：拖宽另一侧时行宽不变、只有它自己变宽，只观察行的话上限会停在旧值。
 *
 * 写死上限会同时错两边：窗口小时上限过高会把正文挤没，窗口大时上限又白占了可用空间。
 * 两侧共用这一条规则，因为它们面对的是同一个约束——拖宽任意一侧都在从正文那里拿宽度。
 *
 * 未测量到（首帧）时**不夹取**，以存下的宽度为准：夹取会把用户存下的宽度截成上限，
 * 看起来像「宽度没有持久化」。
 *
 * ## 内容在收起后是否卸载，由调用方决定
 *
 * 本层始终渲染 children——面板是壳层的一列，「里面有没有东西」不影响它存在。
 * 但两侧面板的取舍不同，所以收起动画完成的信号（`on_collapse_complete`）交回调用方：
 *
 * | | 收起后 | 为什么 |
 * |---|---|---|
 * | Sidebar | 保持挂载 | 它是导航树，卸载会丢掉展开状态与滚动位置，而这些不是业务状态 |
 * | BayBar | 卸载 | 标签页内容是业务视图（编辑器、预览）。留着会让一个已关闭的输入区编辑器
 * | | | 继续挂载，与正文里那一份争同一份草稿——两份 Tiptap 实例写同一个文档会互相覆盖 |
 *
 * ## 为什么两侧共用这一层
 *
 * 两个面板只差三件事：把手贴哪条边（`side`）、宽度范围与持久化键（`resize`）、
 * 以及另一侧的最小占宽（`resize.other_min_width`）。折叠动画、裁切、把手接线、
 * 宽度持久化与上限推导完全相同——各写一遍就会重新出现「一侧贴住正文边缘、另一侧差 4px」
 * 这类分叉，而那种差异不会报错，只会手感不一样。
 *
 * 面板内容不属于这一层：它只负责「一列能折叠、能拖宽的面板」，不知道里面放的是什么。
 * 同理，这里不设 `select-none` 之类的全局修饰——内容能不能选中是内容自己的事，
 * 侧栏的文字不可选由侧栏自己声明，右栏要能选中文件预览与编辑器文本。
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { resolve_panel_max_width } from "./shellResponsive";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";

/** 面板宽度偏好与允许范围。 */
interface ShellPanelResize {
  /** 允许的最小宽度；装不下时退让到上限（min 不能大于 max）。 */
  min_width: number;
  /** 没有持久化值时使用的默认宽度。 */
  default_width: number;
  /** 宽度偏好在 localStorage 中的键。 */
  storage_key: string;
  /** 另一侧面板的最小宽度；为本侧算上限时用它为另一侧预留位置。 */
  other_min_width: number;
}

/** 窗口级面板外壳属性。 */
interface ShellPanelProps {
  /** 面板在窗口中的位置；决定把手贴哪条边、拖拽方向、测量标记与「另一侧」。 */
  side: "left" | "right";
  /** 面板是否折叠。 */
  collapsed: boolean;
  /** 面板的可访问名称。 */
  label?: string;
  /** 宽度偏好与范围。 */
  resize: ShellPanelResize;
  /** 缩放把手的可访问名称。 */
  resize_label: string;
  /** 折叠动画结束（宽度已归零）时触发；供需要在收起后卸载内容的调用方使用。 */
  on_collapse_complete?(): void;
  /** 面板的 header 与内容。 */
  children: ReactNode;
}

/** 渲染一列可折叠、可拖宽的窗口级面板。 */
export function ShellPanel({ side, collapsed, label, resize, resize_label, on_collapse_complete, children }: ShellPanelProps) {
  // 惰性初始化：写在 useState 参数里会每次渲染都读一次 localStorage。
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem(resize.storage_key)) || resize.default_width);
  const root_ref = useRef<HTMLDivElement>(null);
  const [max_width, set_max_width] = useState<number>();

  // 上限的三项都来自实测：量窗口行、读 main 的下限、量另一侧那一列。
  // 未测量到时保持 undefined，由下面的 resolved_max_width 兜底——夹取会让存下的宽度看起来没生效。
  useLayoutEffect(() => {
    const row = root_ref.current?.parentElement;
    const content = row?.querySelector<HTMLElement>("main");
    if (!row || !content) return;
    const other_side = side === "left" ? "right" : "left";
    const other = row.querySelector<HTMLElement>(`[data-shell-panel='${other_side}']`);
    const measure = () => {
      const next = resolve_panel_max_width({
        row_width: row.getBoundingClientRect().width,
        content_floor: Number.parseFloat(getComputedStyle(content).minWidth),
        other_width: other?.getBoundingClientRect().width ?? 0,
        other_min_width: resize.other_min_width,
      });
      set_max_width((current) => current === next ? current : next);
    };
    // 在布局阶段同步量一次：拖拽上限依赖它，等普通 effect 就已经晚了一帧。
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    // 另一侧拖宽时行宽不变（正文变窄），因此它自己的尺寸也要观察，否则上限会停在旧值。
    if (other) observer.observe(other);
    return () => observer.disconnect();
  }, [resize.other_min_width, side]);

  // 装不下「正文下限 + 另一侧最小占宽 + 本侧最小宽度」时让位的是本侧：下限退到上限。
  // 未测量时按「未挤窄」处理：此刻还不知道可用宽度，先按用户选过的宽度展示。
  const squeezed = max_width !== undefined && max_width < resize.min_width;
  const min_width = squeezed && max_width !== undefined ? max_width : resize.min_width;
  const resolved_max_width = max_width ?? Math.max(min_width, stored_width);

  const handle_width_change = useCallback((width: number) => {
    // 被窗口挤窄时用户并没有选过这个宽度，写回去会让「缩一次窗口」永久覆盖用户原本的宽度。
    if (squeezed) return;
    set_stored_width(width);
    localStorage.setItem(resize.storage_key, String(width));
  }, [resize.storage_key, squeezed]);
  const { current_width, is_resizing, handle_resize_start, resize_handle_props } = use_horizontal_resize({
    stored_width,
    min_width,
    max_width: resolved_max_width,
    default_width: resize.default_width,
    // 把手贴在面板朝正文的那条边上，因此两侧都是「向外拖变宽」：左侧面板拖右缘、右侧面板拖左缘。
    resize_edge: side === "left" ? "right" : "left",
    on_width_change: handle_width_change,
  });
  // 把手贴哪条边与拖拽方向由同一个 side 推导，不各写一份。
  const handle_side = side === "left" ? "right" : "left";

  return <div ref={root_ref} className="relative flex h-full min-h-0 shrink-0">
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : current_width }}
      transition={is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION}
      onAnimationComplete={() => { if (collapsed) on_collapse_complete?.(); }}
      aria-label={label}
      // 不铺卡片底色、不画外框：与 Sidebar 一样是窗口背景上的面板，靠底色差与间距分层次。
      // min-w-0 + shrink 而非 flex-none：可用区域不足以同时满足正文下限时让面板先让步。
      // data-shell-panel 供另一侧测量本列的宽度（见本文件头部）。
      data-shell-panel={side}
      className="relative flex h-full min-h-0 min-w-0 shrink overflow-hidden bg-muted"
    >
      {/* 固定宽度内容层：裁切层动画到 0 时它保持原宽，内容因此被裁掉而不是被压扁。 */}
      <div inert={collapsed} className="relative flex h-full min-h-0 flex-col" style={{ width: current_width }}>{children}</div>
    </motion.aside>
    {!collapsed ? <PanelResizeHandle side={handle_side} label={resize_label} resize_handle_props={resize_handle_props} on_resize_start={handle_resize_start} /> : null}
  </div>;
}
