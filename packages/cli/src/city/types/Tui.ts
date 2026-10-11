/**
 * City Federation TUI 列表类型。
 *
 * 关键说明（中文）
 * - 只定义 Federation 管理页使用的列表投影。
 * - Agents 首页及其设置分组使用共享 TUI prompt 类型。
 */

/**
 * TUI 列表项。
 */
export interface tui_list_item {
  /** 稳定主键。 */
  id: string;

  /** 左侧列表标题。 */
  title: string;

  /** 左侧列表副标题。 */
  subtitle: string;

  /** 右侧详情内容。 */
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
