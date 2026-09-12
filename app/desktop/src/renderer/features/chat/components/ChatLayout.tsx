/** Agent、Group 等对话页面共用的 MainView 内容布局。 */

import type { ReactNode } from "react";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";

/**
 * Chat 内容的 Header + Body。
 *
 * 卡片外壳与右侧 BayBar 由外层 MainView 提供，因此这里只负责纵向的两段结构，
 * 不重复包裹 MainView。
 */
export function ChatSurfaceLayout({ header_left, header_right, children }: {
  /** Header 中的对话身份与 Workspace 上下文。 */
  header_left: ReactNode;
  /** Header 右侧的对话操作。 */
  header_right?: ReactNode;
  /** 消息视口与输入器组成的 Chat Body。 */
  children: ReactNode;
}) {
  return <>
    <MainViewHeader title={header_left} right_actions={header_right} />
    <MainViewBody>{children}</MainViewBody>
  </>;
}
