/**
 * 应用壳的窄窗口自适应。
 *
 * 窗口允许缩到 760px（main/index.ts 的 minWidth），而展开态需要
 * rail 40 + sidebar 232 + BayBar 最小 360 = 632px，正文只剩不到 130px。
 * 所以窄窗口下必须主动收起两侧面板，而不是让正文被挤没。
 *
 * 判定本身写成纯函数：收起是「自动」还是「用户主动」会决定放宽时要不要恢复，
 * 这部分逻辑不放在组件里才可验证。
 */

/** 窄到需要收起右侧 BayBar 的窗口宽度。 */
export const BAYBAR_AUTO_COLLAPSE_WIDTH = 1000;

/** 窄到需要收起左侧 Sidebar 的窗口宽度。 */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 860;

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
