/** Plugin Mainview 的 React Renderer 与宿主 UI 注入协议。 */

import type { ReactNode } from "react";
import type { PluginJsonValue } from "./Json.js";

/** Mainview 调用当前 Plugin/Profile main action 的最小网关。 */
export interface PluginRendererGateway {
  /** 调用当前 Plugin main 中的稳定 action。 */
  invoke<Result extends PluginJsonValue = PluginJsonValue>(
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<Result>;
}

/** 宿主 Toast 的输入。 */
export interface PluginRendererToastInput {
  /** Toast 的语义类型。 */
  readonly type?: "success" | "error" | "info";

  /** 用户可见的主消息。 */
  readonly message: string;

  /** 可选的补充说明。 */
  readonly description?: string;
}

/** 宿主确认对话框的输入。 */
export interface PluginRendererConfirmInput {
  /** 对话框标题。 */
  readonly title: string;

  /** 可选的风险或操作说明。 */
  readonly description?: string;

  /** 可选的确认按钮文案。 */
  readonly action?: string;

  /** 是否使用破坏性操作视觉。 */
  readonly destructive?: boolean;
}

/** Select 的一个稳定选项。 */
export interface PluginRendererSelectOption {
  /** 保存和回传的稳定值。 */
  readonly value: string;

  /** 用户可见名称。 */
  readonly label: string;

  /** 是否禁止选择该选项。 */
  readonly disabled?: boolean;
}

/** Page 布局属性。 */
export interface PluginRendererPageProps {
  /** 页面内的全部 Mainview 内容。 */
  readonly children: ReactNode;
}

/** Section 布局属性。 */
export interface PluginRendererSectionProps {
  /** 可选的分区标题。 */
  readonly title?: ReactNode;

  /** 可选的分区说明。 */
  readonly description?: ReactNode;

  /** 可选的右侧分区操作。 */
  readonly action?: ReactNode;

  /** 是否为正文提供统一表面。 */
  readonly surface?: boolean;

  /** 分区正文。 */
  readonly children: ReactNode;
}

/** Group 布局属性。 */
export interface PluginRendererGroupProps {
  /** Group 内的行或自定义正文。 */
  readonly children: ReactNode;

  /** 可选的 Group 标题。 */
  readonly label?: ReactNode;

  /** 可选的数量提示。 */
  readonly count?: number;

  /** 可选的 Group 级操作。 */
  readonly action?: ReactNode;

  /** 是否允许折叠。 */
  readonly collapsible?: boolean;

  /** 可折叠时是否默认展开。 */
  readonly default_expanded?: boolean;
}

/** Row 布局属性。 */
export interface PluginRendererRowProps {
  /** 行标题。 */
  readonly label: ReactNode;

  /** 可选的行说明。 */
  readonly description?: ReactNode;

  /** 可选的左侧视觉元素。 */
  readonly leading?: ReactNode;

  /** 可选的右侧值或操作。 */
  readonly trailing?: ReactNode;

  /** 可选的整行点击行为。 */
  readonly on_click?: () => void;

  /** 是否禁止整行交互。 */
  readonly disabled?: boolean;
}

/** Stack 垂直布局属性。 */
export interface PluginRendererStackProps {
  /** 垂直排列的内容。 */
  readonly children: ReactNode;
}

/** Inline 水平布局属性。 */
export interface PluginRendererInlineProps {
  /** 水平排列且允许换行的内容。 */
  readonly children: ReactNode;

  /** 是否让第一个子元素占据剩余空间。 */
  readonly fill?: boolean;
}

/** Toolbar 布局属性。 */
export interface PluginRendererToolbarProps {
  /** 可选的工具栏标题。 */
  readonly title?: ReactNode;

  /** 可选的工具栏说明。 */
  readonly description?: ReactNode;

  /** 可选的左侧视觉元素。 */
  readonly leading?: ReactNode;

  /** 可选的右侧操作。 */
  readonly actions?: ReactNode;
}

/** Button 属性。 */
export interface PluginRendererButtonProps {
  /** 按钮内容。 */
  readonly children: ReactNode;

  /** 点击回调。 */
  readonly on_click?: () => void;

  /** 是否禁止点击。 */
  readonly disabled?: boolean;

  /** 按钮语义样式。 */
  readonly variant?: "default" | "primary" | "destructive";

  /** 按钮尺寸。 */
  readonly size?: "default" | "icon" | "full";

  /** 可选的原生标题提示。 */
  readonly title?: string;

  /** 图标按钮所需的无障碍名称。 */
  readonly aria_label?: string;
}

/** Input 属性。 */
export interface PluginRendererInputProps {
  /** 当前字符串值。 */
  readonly value: string;

  /** 值变化回调。 */
  readonly on_value_change: (value: string) => void;

  /** 可选占位文本。 */
  readonly placeholder?: string;

  /** 是否禁止输入。 */
  readonly disabled?: boolean;

  /** 输入值类型。 */
  readonly type?: "text" | "password" | "number";

  /** 数字输入允许的最小值。 */
  readonly minimum?: number;

  /** 数字输入允许的最大值。 */
  readonly maximum?: number;
}

/** Select 属性。 */
export interface PluginRendererSelectProps {
  /** 当前稳定值。 */
  readonly value: string;

  /** 全部可选项。 */
  readonly options: readonly PluginRendererSelectOption[];

  /** 值变化回调。 */
  readonly on_value_change: (value: string) => void;

  /** 是否禁止选择。 */
  readonly disabled?: boolean;
}

/** Switch 属性。 */
export interface PluginRendererSwitchProps {
  /** 当前是否开启。 */
  readonly checked: boolean;

  /** 开关变化回调。 */
  readonly on_checked_change: (checked: boolean) => void;

  /** 是否禁止切换。 */
  readonly disabled?: boolean;

  /** 开关的无障碍名称。 */
  readonly aria_label: string;
}

/** EmptyState 属性。 */
export interface PluginRendererEmptyStateProps {
  /** 空状态标题。 */
  readonly title: ReactNode;

  /** 可选的空状态说明。 */
  readonly description?: ReactNode;

  /** 可选的空状态图标。 */
  readonly icon?: ReactNode;

  /** 可选的恢复或创建操作。 */
  readonly action?: ReactNode;

  /** 空状态占用空间规格。 */
  readonly size?: "compact" | "default";
}

/** LoadingState 属性。 */
export interface PluginRendererLoadingStateProps {
  /** 加载状态说明。 */
  readonly label: ReactNode;
}

/** Callout 属性。 */
export interface PluginRendererCalloutProps {
  /** Callout 正文。 */
  readonly children: ReactNode;

  /** Callout 语义类型。 */
  readonly tone?: "default" | "warning" | "danger";
}

/** Status 属性。 */
export interface PluginRendererStatusProps {
  /** 状态正文。 */
  readonly children: ReactNode;

  /** 状态语义类型。 */
  readonly tone?: "success" | "warning" | "danger" | "muted";
}

/** 宿主注入的稳定 UI 组件集合。 */
export interface PluginRendererUiComponents {
  /** Mainview 页面根布局。 */
  readonly Page: (props: PluginRendererPageProps) => ReactNode;
  /** 带标题和表面的内容分区。 */
  readonly Section: (props: PluginRendererSectionProps) => ReactNode;
  /** 统一成组表面。 */
  readonly Group: (props: PluginRendererGroupProps) => ReactNode;
  /** 统一设置行。 */
  readonly Row: (props: PluginRendererRowProps) => ReactNode;
  /** 垂直间距布局。 */
  readonly Stack: (props: PluginRendererStackProps) => ReactNode;
  /** 水平间距布局。 */
  readonly Inline: (props: PluginRendererInlineProps) => ReactNode;
  /** 页面内工具栏。 */
  readonly Toolbar: (props: PluginRendererToolbarProps) => ReactNode;
  /** 标准按钮。 */
  readonly Button: (props: PluginRendererButtonProps) => ReactNode;
  /** 标准文本或数字输入框。 */
  readonly Input: (props: PluginRendererInputProps) => ReactNode;
  /** 标准单选选择器。 */
  readonly Select: (props: PluginRendererSelectProps) => ReactNode;
  /** 标准二元开关。 */
  readonly Switch: (props: PluginRendererSwitchProps) => ReactNode;
  /** 标准空状态。 */
  readonly EmptyState: (props: PluginRendererEmptyStateProps) => ReactNode;
  /** 标准加载状态。 */
  readonly LoadingState: (props: PluginRendererLoadingStateProps) => ReactNode;
  /** 标准提示块。 */
  readonly Callout: (props: PluginRendererCalloutProps) => ReactNode;
  /** 轻量状态文本。 */
  readonly Status: (props: PluginRendererStatusProps) => ReactNode;
}

/** 宿主注入的 Mainview 交互能力。 */
export interface PluginRendererUi {
  /** 显示非阻塞反馈。 */
  toast(input: PluginRendererToastInput): void;

  /** 显示宿主确认对话框并返回用户选择。 */
  confirm(input: PluginRendererConfirmInput): Promise<boolean>;

  /** 与宿主主题和交互规范一致的组件集合。 */
  readonly components: PluginRendererUiComponents;
}

/** Plugin 唯一 Mainview 接收的属性。 */
export interface PluginRendererProps {
  /** 已绑定当前 Plugin/Profile 身份的 action 网关。 */
  readonly plugin: PluginRendererGateway;

  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PluginRendererUi;
}

/** Plugin Renderer 默认导出的唯一 Mainview 组件。 */
export type PluginRendererComponent = (props: PluginRendererProps) => ReactNode;
