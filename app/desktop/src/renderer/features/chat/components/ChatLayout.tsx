/** Agent、Group 等对话页面共用的 MainView 布局。 */

import type { ReactNode } from "react";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";

/** 统一 Chat MainView，只组合 Header 与承载消息、输入器的 Body。 */
export function ChatSurfaceLayout({ header_left, header_right, children }: {
  /** Header 中的对话身份与 Workspace 上下文。 */
  header_left: ReactNode;
  /** Header 右侧的对话操作。 */
  header_right?: ReactNode;
  /** 消息视口与输入器组成的 Chat Body。 */
  children: ReactNode;
}) {
  return <MainViewLayout>
    <MainViewHeader title={header_left} right_actions={header_right} />
    <MainViewBody>{children}</MainViewBody>
  </MainViewLayout>;
}
