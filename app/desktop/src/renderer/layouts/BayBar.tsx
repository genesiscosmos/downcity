/** Desktop 右侧 BayBar，负责承载右侧面板的区域、开关和展开状态。 */

import type { ReactNode } from "react";

/** BayBar 当前状态。 */
export interface BayBarState {
  /** BayBar 是否可见。 */
  open: boolean;
  /** BayBar 是否展开为主区域宽度。 */
  expanded: boolean;
  /** 当前激活的面板类型。 */
  active_tab: "recent" | "agent_config" | "group_config";
}

/** BayBar 区域属性。 */
interface BayBarProps {
  /** 当前 BayBar 状态。 */
  state: BayBarState;
  /** BayBar 内容。 */
  children: ReactNode;
}

/** 右侧区域只负责布局，不拥有具体面板业务。 */
export function BayBar({ state, children }: BayBarProps) {
  if (!state.open) return null;
  return <aside data-baybar-expanded={state.expanded ? "true" : "false"} className="flex h-full min-h-0 w-auto shrink-0 overflow-hidden border-l border-border/45 bg-muted">{children}</aside>;
}
