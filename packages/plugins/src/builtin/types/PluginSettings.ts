/** 官方 Plugin 设置 Mainview 的内部声明类型。 */

/** 简单设置字段支持的值类型。 */
export type PluginSettingFieldType = "string" | "number" | "boolean" | "select";

/** 一个由具体 Plugin 声明的设置字段。 */
export interface PluginSettingField {
  /** Profile 配置中的稳定字段名。 */
  readonly key: string;

  /** Mainview 展示名称。 */
  readonly label: string;

  /** 可选的用户说明。 */
  readonly description?: string;

  /** 字段值类型。 */
  readonly type: PluginSettingFieldType;

  /** 数字字段允许的最小值。 */
  readonly minimum?: number;

  /** 数字字段允许的最大值。 */
  readonly maximum?: number;

  /** select 字段允许的稳定选项。 */
  readonly options?: readonly {
    /** 保存到配置的值。 */
    readonly value: string;

    /** Mainview 展示文本。 */
    readonly label: string;
  }[];
}

/** 一个简单设置 Mainview 的完整定义。 */
export interface PluginSettingsDefinition {
  /** Mainview 标题。 */
  readonly title: string;

  /** Mainview 说明。 */
  readonly description: string;

  /** Plugin 自己拥有的全部配置字段。 */
  readonly fields: readonly PluginSettingField[];
}
