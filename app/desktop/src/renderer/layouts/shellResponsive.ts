/**
 * 应用壳的自适应：两侧面板的折叠决策与右栏的宽度上限。
 *
 * 一个共同问题：窗口允许缩到 760px（main/index.ts 的 minWidth），而两侧面板展开时
 * 正文会被挤到无法阅读。所以窄窗口下必须主动收起面板，而不是让正文被挤没；
 * 同样地，右栏能拖多宽也必须由「给正文留多少」决定，而不能写成固定值。
 *
 * 这些判定都写成纯函数：收起是「自动」还是「用户主动」会决定放宽时要不要恢复，
 * 宽度上限则直接决定拖拽的边界。它们不放在组件里才可验证。
 */

// 本模块会被 node 测试直接加载，相对导入必须带扩展名（其余渲染层文件走 Vite 打包）。
import { SHELL_BAYBAR_MIN_WIDTH, SHELL_MAIN_VIEW_MIN_REGION, SHELL_SIDEBAR_MIN_WIDTH, SHELL_SIDEBAR_RAIL_WIDTH } from "./shellMotion.ts";

/** 窄到需要收起左侧 Sidebar 的窗口宽度。 */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 860;

/**
 * 窄到需要收起右侧 BayBar 的窗口宽度。
 *
 * 由「正文保留量」推导：可用正文区域至少要同时容得下正文下限与右栏最小宽度，
 * 再加上左侧最窄的 Sidebar 占地。低于这条线时两者无法并存，
 * 与其把正文压到下限以下，不如收起右栏。
 *
 * 收起态右栏不占宽（开关是浮动按钮），因此右侧只计面板本身的最小宽度。
 *
 * 左侧按 Sidebar 的**最小**宽度计算，与上面的注释一致：Sidebar 本身可拖宽，
 * 拖宽后实际可用区域会更小，而媒体查询只能表达一个固定窗口宽度。
 */
export const BAYBAR_AUTO_COLLAPSE_WIDTH = SHELL_SIDEBAR_RAIL_WIDTH
  + SHELL_SIDEBAR_MIN_WIDTH
  + SHELL_MAIN_VIEW_MIN_REGION
  + SHELL_BAYBAR_MIN_WIDTH;

/**
 * 一侧面板能拖多宽：窗口行宽 − 正文下限 − 另一侧占宽。
 *
 * 两侧共用同一条规则，因为它们面对的是同一个约束：
 * 拖宽任意一侧都会从正文那里拿宽度，而正文与另一侧都不能被挤没。
 *
 * `other_width` 取 **max(另一侧实际宽, 另一侧最小宽)**，两个值各管一件事：
 *
 * | 取哪个 | 管什么 |
 * | --- | --- |
 * | 实际宽 | 不溢出：另一侧已拖宽时，本侧上限必须跟着变小 |
 * | 最小宽 | 不被压成 0：另一侧当前折叠（实际宽 0）或很窄时，仍要为它展开预留位置 |
 *
 * 两者取大而不是相加：它们描述的是同一个「另一侧占多宽」的下界，相加会双重扣除。
 *
 * 结果可能低于本侧最小宽度，也可能为 0（窗口太窄）。调用方据此把下限一起放低——
 * min 不能大于 max，否则夹取无解。
 */
export function resolve_panel_max_width(options: {
  /** 窗口行宽（实测像素）。 */
  row_width: number;
  /** 正文下限（实测像素，读 main 的 computed min-width）。 */
  content_floor: number;
  /** 另一侧当前实际占宽；折叠时为 0。 */
  other_width: number;
  /** 另一侧的最小宽度（设计值，含面板本身）。 */
  other_min_width: number;
}): number {
  const reserved_other = Math.max(options.other_width, options.other_min_width);
  return Math.max(0, Math.floor(options.row_width - options.content_floor - reserved_other));
}

/** 一次自适应决策的结果。 */
export interface ShellAutoCollapse {
  /** 决策后的折叠状态。 */
  collapsed: boolean;
  /** 该折叠是否由系统自动触发；用户主动折叠为 false。 */
  auto_collapsed: boolean;
}

/**
 * 计算窗口宽度变化后两侧面板的折叠状态。
 *
 * 三条规则：
 * 1. 进入窄区间 → 自动收起，并记下「这是我收的」；
 * 2. 已在窄区间内 → 保持用户当前选择，不再反复干预（用户展开就展开）；
 * 3. 离开窄区间且当初是自动收起的 → 恢复展开；用户自己收起的则保持收起。
 *
 * 第 3 条是必要的：否则用户把窗口拉宽后会发现侧栏「莫名其妙不见了」，
 * 而它其实是系统的自动行为，用户没有做过这个决定。
 */
export function resolve_shell_auto_collapse(options: {
  /** 当前窗口是否处于窄区间。 */
  narrow: boolean;
  /** 当前折叠状态。 */
  collapsed: boolean;
  /** 当前折叠是否由系统自动触发。 */
  auto_collapsed: boolean;
}): ShellAutoCollapse {
  if (options.narrow) {
    if (options.collapsed) return { collapsed: true, auto_collapsed: options.auto_collapsed };
    return { collapsed: true, auto_collapsed: true };
  }
  if (options.auto_collapsed) return { collapsed: false, auto_collapsed: false };
  return { collapsed: options.collapsed, auto_collapsed: false };
}
