/** 胶囊选择控件的公开属性。 */
import type { ReactNode } from "react";
/** 分段选择项。 */
export interface PillSwitcherOption<Value extends string> {
  /** 选项稳定值。 */
  value: Value;
  /** 选项展示内容，允许名称附带宿主渲染的数量提示。 */
  label: ReactNode;
  /** 是否禁止选择。 */
  disabled?: boolean;
}

/** 分段选择控件属性。 */
export interface PillSwitcherProps<Value extends string> {
  /** 当前选中值。 */
  value: Value;
  /** 全部可选项。 */
  options: readonly PillSwitcherOption<Value>[];
  /** 选中项变化回调。 */
  on_value_change(value: Value): void;
  /** 辅助功能名称。 */
  aria_label: string;
  /** 受控内容区域的标识；提供时同时表达每个胶囊是否展开。 */
  controlled_panel_id?: string;
  /** 附加样式。 */
  class_name?: string;
}
