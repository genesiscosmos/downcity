/** Group Chat：MainView 承载正文，右侧注册「Group」tab。 */
import { type ReactNode } from "react";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopGroupSummary } from "@common/types/DesktopApi";

import { MainView } from "@/layouts/BayBar";

/** Group Chat MainView 属性。 */
interface GroupChatMainViewProps {
  /** 当前 Group。 */
  group: DesktopGroupSummary;
  /** Desktop 稳定控制器。 */
  controller: DesktopController;
  /** 当前 Chat 的稳定标识，用于按会话记忆显示位置。 */
  view_key: string;
  /** 渲染 Chat 正文。 */
  children: ReactNode;
}
/** Group Chat：正文容器。标签页在正文入口被点击时构造并打开（见 group_config_tab）。 */
export function GroupChatMainView({ children }: GroupChatMainViewProps) {
  return <MainView>{children}</MainView>;
}
