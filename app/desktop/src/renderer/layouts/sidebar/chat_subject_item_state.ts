/** Chat 主体行右侧菜单入口的稳定状态规则。 */

/** 菜单入口当前应展示的视觉状态。 */
export type ChatSubjectMenuStatus = "idle" | "unread" | "running";

/** 菜单入口状态计算输入。 */
interface ChatSubjectMenuStatusInput {
  /** 当前 Agent 是否正在执行。 */
  running: boolean;
  /** 当前 Agent 是否存在未读结果。 */
  unread: boolean;
}

/**
 * 计算右侧 Dropdown Trigger 的图标状态。
 * active 刻意不属于输入：选中只影响 Item 背景，不能影响菜单入口的显示、隐藏或动画。
 */
export function resolve_chat_subject_menu_status({ running, unread }: ChatSubjectMenuStatusInput): ChatSubjectMenuStatus {
  if (running) return "running";
  if (unread) return "unread";
  return "idle";
}

/** 返回菜单入口是否必须持续可见；普通省略号的临时显隐继续由 hover、focus 和 open CSS 状态控制。 */
export function is_persistent_chat_subject_menu_status(status: ChatSubjectMenuStatus): boolean {
  return status !== "idle";
}
