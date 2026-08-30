/** Agent、Group 等对话页面共用的主视图容器。 */

import type { ReactNode } from "react";
import { MainViewBody, MainViewHeader, MainViewLayout } from "./MainViewLayout";

/** 统一 Chat Surface 的 Header 与可增长 Body 边界。 */
export function ChatSurfaceLayout({ header_left, header_actions, header_right, sidebar, children }: { /** Header 标题。 */ header_left: ReactNode; /** Header 左侧页面操作。 */ header_actions?: ReactNode; /** Header 右侧固定操作组。 */ header_right?: ReactNode; /** Header 下方的内部 Sidebar。 */ sidebar?: ReactNode; /** 对话主体。 */ children: ReactNode }) {
  return <MainViewLayout><MainViewHeader title={header_left} left_actions={header_actions} right_actions={header_right} bordered /><MainViewBody>{sidebar}{children}</MainViewBody></MainViewLayout>;
}
