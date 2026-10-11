/**
 * City TUI 视图与动作类型。
 *
 * 关键说明（中文）
 * - TUI 只负责顶层导航与状态总览。
 * - 具体业务动作仍复用现有交互式流程，避免一次性重写所有管理逻辑。
 */

/**
 * TUI 列表项。
 */
export interface tui_list_item {
  /** 稳定主键，用于键盘选择和动作分发。 */
  id: string;

  /** 左侧列表展示标题。 */
  title: string;

  /** 左侧列表副标题。 */
  subtitle: string;

  /** 右侧详情面板内容。 */
  detail: string;
}

/**
 * TUI 动作结果。
 */
export type tui_action_result = "refresh" | "quit";
