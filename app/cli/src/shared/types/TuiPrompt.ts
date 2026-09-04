/**
 * CLI 共享 TUI prompt 类型。
 *
 * 关键点（中文）
 * - 本文件只定义跨 city / federation 可复用的交互类型。
 * - 所有字段都保留详细注释，避免业务模块直接依赖具体 TUI 框架。
 */

/**
 * TUI 列表选项。
 */
export interface tui_prompt_option {
  /** 左侧展示标题。 */
  label: string;

  /** 选中后返回给业务层的稳定值。 */
  value: string;

  /** 列表辅助说明或选中项底部提示。 */
  hint?: string;

  /**
   * 是否为不可选分组标题。
   *
   * 关键点（中文）
   * - true 时该项只负责展示分组，不会作为选择结果返回。
   * - 键盘上下移动会自动跳过 disabled 项。
   */
  disabled?: boolean;
}

/**
 * TUI dashboard 列表项。
 */
export interface tui_dashboard_item {
  /** 稳定主键，用于键盘选择和动作分发。 */
  id: string;

  /** 左侧列表展示标题。 */
  title: string;

  /** 左侧列表副标题。 */
  subtitle: string;

  /** 选中项底部提示内容。 */
  detail: string;

  /**
   * 是否仅作为分区标题展示。
   *
   * 关键点（中文）
   * - true 时该项不会作为业务动作返回，只用于把 sidebar 分成清晰区域。
   * - 键盘移动与回车选择会自动跳过该项，避免误触发。
   */
  disabled?: boolean;
}

/**
 * TUI 短消息类型。
 */
export type tui_message_kind = "info" | "success" | "error";

/**
 * TUI 表格行。
 */
export interface tui_table_row {
  /** 行内每一列的展示文本，按 columns 顺序排列。 */
  cells: string[];
}

/**
 * TUI 表格展示参数。
 */
export interface tui_table_input {
  /** 表格标题。 */
  title: string;

  /** 表格列标题。 */
  columns: string[];

  /** 表格数据行。 */
  rows: tui_table_row[];

  /** 空数据时显示的说明。 */
  empty_message?: string;
}
