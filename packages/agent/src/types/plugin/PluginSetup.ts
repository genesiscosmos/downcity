/**
 * Plugin setup / usage UI 协议类型。
 *
 * 关键点（中文）
 * - setup 面向安装与配置。
 * - usage 面向 agent 使用 plugin 时的行为参数。
 */

/**
 * Plugin setup 字段选项。
 */
export interface PluginSetupFieldOption {
  /** 选项展示标签。 */
  label: string;
  /** 选项实际值。 */
  value: string;
  /** 选项补充说明（可选）。 */
  hint?: string;
}

/**
 * Plugin setup 字段定义。
 */
export interface PluginSetupField {
  /** 字段稳定键。 */
  key: string;
  /** 字段展示标签。 */
  label: string;
  /**
   * 字段类型。
   *
   * 说明（中文）
   * - 当前阶段只允许 `select` 与 `checkbox`，避免退回到大量自由输入。
   */
  type: "select" | "checkbox";
  /** 是否必填。 */
  required?: boolean;
  /** 静态选项列表（可选）。 */
  options?: PluginSetupFieldOption[];
  /**
   * 动态选项来源 action（可选）。
   *
   * 说明（中文）
   * - 若存在，则 Console 打开 setup 弹窗时会先调用该 action 拉取下拉选项。
   */
  source_action?: string;
}

/**
 * Plugin setup 定义。
 */
export interface PluginSetupDefinition {
  /**
   * setup 模式。
   *
   * 说明（中文）
   * - `install`：只执行依赖安装。
   * - `configure`：只写入配置。
   * - `install-configure`：安装与配置一体化。
   */
  mode: "install" | "configure" | "install-configure";
  /** setup 面板标题。 */
  title: string;
  /** setup 面板说明（可选）。 */
  description?: string;
  /** setup 字段列表。 */
  fields: PluginSetupField[];
  /** 主动作 action 名称。 */
  primary_action: string;
  /** 状态同步 action 名称（可选）。 */
  status_action?: string;
}

/**
 * Plugin usage 字段选项。
 */
export interface PluginUsageFieldOption {
  /** 选项展示标签。 */
  label: string;
  /** 选项实际值。 */
  value: string;
  /** 选项补充说明（可选）。 */
  description?: string;
}

/**
 * Plugin usage 字段定义。
 */
export interface PluginUsageField {
  /** 字段稳定键。 */
  key: string;
  /** 字段展示标签。 */
  label: string;
  /**
   * 字段类型。
   *
   * 说明（中文）
   * - `usage` 面向 agent 如何使用 plugin，因此允许更丰富的配置类型。
   */
  type: "string" | "secret" | "boolean" | "select" | "number";
  /** 字段占位文案（可选）。 */
  placeholder?: string;
  /** 字段说明（可选）。 */
  description?: string;
  /** 是否必填。 */
  required?: boolean;
  /** 字段是否禁用。 */
  disabled?: boolean;
  /** 布尔字段为 true 时的标签（可选）。 */
  true_label?: string;
  /** 布尔字段为 false 时的标签（可选）。 */
  false_label?: string;
  /** 静态选项列表（可选）。 */
  options?: PluginUsageFieldOption[];
  /**
   * 动态选项来源 action（可选）。
   *
   * 说明（中文）
   * - Console 打开 usage 面板时会先调用该 action 同步下拉选项。
   */
  source_action?: string;
}

/**
 * Plugin usage 定义。
 */
export interface PluginUsageDefinition {
  /** usage 面板标题。 */
  title: string;
  /** usage 面板说明（可选）。 */
  description?: string;
  /** agent 使用该 plugin 时可配置的字段列表。 */
  fields: PluginUsageField[];
  /** 保存 usage 配置时调用的 action。 */
  save_action: string;
  /** 读取当前 usage 快照时调用的 action（可选）。 */
  status_action?: string;
}
