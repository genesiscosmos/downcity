/** Desktop 统一右侧面板宿主，保证同一时间只展示一个面板。 */

import type { ReactNode } from "react";

/** 右侧面板宿主。面板内容由 App 组合，布局职责集中在此处。 */
export function RightPanelHost({ children }: { /** 当前面板内容。 */ children: ReactNode }) {
  return <aside className="flex h-full min-h-0 shrink-0">{children}</aside>;
}
