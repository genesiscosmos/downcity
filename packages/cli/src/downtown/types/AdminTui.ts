/**
 * Admin TUI 运行时类型。
 *
 * 关键说明（中文）
 * - admin 命令不能直接打印到终端，必须通过这里的 runtime 渲染全屏 TUI。
 * - 字段注释保持详细，方便命令层按统一方式展示列表、文本、JSON 与状态消息。
 */

/**
 * Admin TUI 表格行。
 */
export interface admin_tui_table_row {
  /** 行内每一列的展示文本，按 columns 顺序排列。 */
  cells: string[];
}

/**
 * Admin TUI 表格展示参数。
 */
export interface admin_tui_table_input {
  /** 页面标题，会显示在 TUI 顶部边框。 */
  title: string;

  /** 表格列标题。 */
  columns: string[];

  /** 表格数据行。 */
  rows: admin_tui_table_row[];

  /** 空数据时显示的说明。 */
  empty_message?: string;
}

/**
 * Admin TUI 选择项。
 */
export interface admin_tui_select_option {
  /** 展示标签。 */
  label: string;

  /** 选中后返回的业务值。 */
  value: string;

  /** 右侧详情或列表提示。 */
  hint?: string;

  /**
   * 是否仅作为分区标题展示。
   *
   * 关键点（中文）
   * - true 时该项只负责分隔 sidebar 内容，不会作为业务动作返回。
   * - TUI 会在键盘移动时自动跳过该项，避免 Enter 触发无意义动作。
   */
  disabled?: boolean;
}

/**
 * Admin TUI 消息类型。
 */
export type admin_tui_message_kind = "info" | "success" | "error";

/**
 * Admin TUI 运行时。
 */
export interface admin_tui_runtime {
  /** 关闭当前 admin shell，退出全屏 TUI。 */
  close(): void;

  /** 在左侧主导航中选择一个顶层动作，并重置 sidebar breadcrumb。 */
  select_nav(title: string, options: admin_tui_select_option[]): Promise<string | undefined>;

  /** 在左侧 sidebar 中选择一个次级动作，并将 title 追加到 breadcrumb。 */
  select(title: string, options: admin_tui_select_option[]): Promise<string | undefined>;

  /** 在右侧 section 中输入文本。 */
  text(title: string, placeholder?: string): Promise<string | undefined>;

  /** 在右侧 section 中输入密文。 */
  password(title: string, placeholder?: string): Promise<string | undefined>;

  /** 在异步任务执行期间显示 loading 页，并返回任务结果。 */
  with_loading<T>(title: string, task: () => Promise<T>): Promise<T>;

  /** 在右侧 section 显示可滚动文本页，用户按 Enter/Esc 返回。 */
  show_text(title: string, content: string): Promise<void>;

  /** 在右侧 section 显示可滚动表格页，用户按 Enter/Esc 返回。 */
  show_table(input: admin_tui_table_input): Promise<void>;

  /** 在右侧 section 显示 JSON 数据页，用户按 Enter/Esc 返回。 */
  show_json(title: string, data: unknown): Promise<void>;

  /** 在右侧 section 显示短消息页，用户按 Enter/Esc 返回。 */
  show_message(kind: admin_tui_message_kind, message: string): Promise<void>;
}
