/** Plugin Sidebar、Mainview、Config 与宿主 UI 注入协议。 */

import type { ReactNode } from "react";
import type { PluginJsonObject, PluginJsonValue } from "./Json.js";
import type { PluginRendererNotification } from "./PluginNotification.js";

/** Plugin 业务 UI 调用 Plugin 级宿主 action 的最小网关。 */
export interface PluginActionGateway {
  /** 调用当前 Plugin 注册的稳定宿主管理 action。 */
  invoke<Result = PluginJsonValue>(
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<Result>;
}

/** Plugin Config 调用当前 Plugin 唯一配置 action 的最小网关。 */
export interface PluginConfigGateway {
  /** 调用当前 Plugin 的稳定 Config action。 */
  invoke<Result = PluginJsonValue>(
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<Result>;
}

/** Plugin Sidebar 与 Mainview 共享的宿主导航。 */
export interface PluginRendererNavigation {
  /** 当前 Plugin 工作区的 JSON 路由状态。 */
  readonly route: PluginJsonObject;

  /** 原子替换当前 Plugin 工作区路由。 */
  navigate(route: PluginJsonObject): void;
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

/** Plugin Sidebar 根布局属性。 */
export interface PluginRendererSidebarProps {
  /** Sidebar 内的全部导航内容。 */
  readonly children: ReactNode;
}

/** Plugin Sidebar 分区属性。 */
export interface PluginRendererSidebarSectionProps {
  /** 分区的用户可见名称。 */
  readonly label?: ReactNode;

  /** 分区内的导航项。 */
  readonly children: ReactNode;
}

/** Plugin Sidebar 导航项属性。 */
export interface PluginRendererSidebarItemProps {
  /** 导航项名称。 */
  readonly label: ReactNode;

  /** 可选的单行补充说明。 */
  readonly description?: ReactNode;

  /** 可选的左侧视觉元素。 */
  readonly leading?: ReactNode;

  /** 可选的右侧状态或数量。 */
  readonly trailing?: ReactNode;

  /** 当前导航项是否被选中。 */
  readonly active?: boolean;

  /** 是否禁止选择。 */
  readonly disabled?: boolean;

  /** 用户选择导航项时的回调。 */
  readonly on_select: () => void;
}

/** Plugin Sidebar 树中的一个节点。 */
export interface PluginRendererSidebarTreeItemProps {
  /** 树节点的用户可见名称。 */
  readonly label: ReactNode;

  /** 可选的左侧视觉元素；叶子节点未提供时使用宿主默认标记。 */
  readonly leading?: ReactNode;

  /** 可选的右侧数量、状态或操作。 */
  readonly trailing?: ReactNode;

  /** 当前节点在树中的缩进层级，从 0 开始。 */
  readonly depth: number;

  /** 节点语义类型；分支节点用于容纳子项，叶子节点表示最终可选资源。 */
  readonly kind?: "branch" | "leaf";

  /** 当前节点是否被选中。 */
  readonly active?: boolean;

  /** 当前父节点是否展开；提供 `on_toggle` 时显示展开控制。 */
  readonly expanded?: boolean;

  /** 点击展开控制时的回调，不会触发 `on_select`。 */
  readonly on_toggle?: () => void;

  /** 是否禁止选择和展开节点。 */
  readonly disabled?: boolean;

  /** 用户选择节点正文时的回调。 */
  readonly on_select: () => void;
}

/** Item Menu 中的一条操作。 */
export interface PluginRendererItemMenuAction {
  /** 操作在当前菜单内的稳定标识。 */
  readonly action_id: string;

  /** 操作的用户可见名称。 */
  readonly label: ReactNode;

  /** 可选的左侧视觉元素。 */
  readonly leading?: ReactNode;

  /** 是否在当前操作前显示分隔线。 */
  readonly separator_before?: boolean;

  /** 是否使用危险操作视觉。 */
  readonly destructive?: boolean;

  /** 是否禁止执行当前操作。 */
  readonly disabled?: boolean;

  /** 用户选择操作时执行的回调。 */
  readonly on_select: () => void | Promise<void>;
}

/** 宿主统一 Item Menu 的属性。 */
export interface PluginRendererItemMenuProps {
  /** 菜单触发器的无障碍名称。 */
  readonly label: string;

  /** 菜单中的全部操作。 */
  readonly actions: readonly PluginRendererItemMenuAction[];

  /** 是否仅在所属 Item 悬浮或菜单展开时显示触发器。 */
  readonly reveal_on_hover?: boolean;
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

/** Tabs 中的一个稳定选项。 */
export interface PluginRendererTabItem {
  /** Tab 的稳定值。 */
  readonly value: string;

  /** Tab 的用户可见名称。 */
  readonly label: ReactNode;

  /** 可选的数量提示。 */
  readonly count?: number;
}

/** Tabs 属性。 */
export interface PluginRendererTabsProps {
  /** 当前选中的稳定值。 */
  readonly value: string;

  /** Tab 组的无障碍名称。 */
  readonly label: string;

  /** 全部 Tab 选项。 */
  readonly items: readonly PluginRendererTabItem[];

  /** 用户切换 Tab 时的回调。 */
  readonly on_value_change: (value: string) => void;
}

/** CodeBlock 属性。 */
export interface PluginRendererCodeBlockProps {
  /** 要展示的纯文本代码或说明内容。 */
  readonly children: string;
}

/** 安全 Markdown 正文属性。 */
export interface PluginRendererMarkdownProps {
  /** 需要由宿主安全渲染的 Markdown 原文。 */
  readonly text: string;
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

  /** 是否占满当前表单容器的可用宽度。 */
  readonly fill?: boolean;
}

/** 表单字段布局属性。 */
export interface PluginRendererFieldProps {
  /** 字段的用户可见名称。 */
  readonly label: ReactNode;

  /** 可选的字段用途或填写说明。 */
  readonly description?: ReactNode;

  /** 可选的字段校验错误。 */
  readonly error?: ReactNode;

  /** 字段中承载的输入控件。 */
  readonly children: ReactNode;
}

/** 多行文本输入属性。 */
export interface PluginRendererTextareaProps {
  /** 当前文本值。 */
  readonly value: string;

  /** 文本变化回调。 */
  readonly on_value_change: (value: string) => void;

  /** 可选占位文本。 */
  readonly placeholder?: string;

  /** 是否禁止输入。 */
  readonly disabled?: boolean;

  /** 默认展示的文本行数。 */
  readonly rows?: number;
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

  /** 是否占满当前表单容器的可用宽度。 */
  readonly fill?: boolean;
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
  /** Plugin Sidebar 根布局。 */
  readonly Sidebar: (props: PluginRendererSidebarProps) => ReactNode;
  /** Plugin Sidebar 的标准分区。 */
  readonly SidebarSection: (props: PluginRendererSidebarSectionProps) => ReactNode;
  /** Plugin Sidebar 的标准导航项。 */
  readonly SidebarItem: (props: PluginRendererSidebarItemProps) => ReactNode;
  /** Plugin Sidebar 的标准树节点。 */
  readonly SidebarTreeItem: (props: PluginRendererSidebarTreeItemProps) => ReactNode;
  /** Item 的统一操作菜单。 */
  readonly ItemMenu: (props: PluginRendererItemMenuProps) => ReactNode;
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
  /** 页面内的标准 Tab 导航。 */
  readonly Tabs: (props: PluginRendererTabsProps) => ReactNode;
  /** 适合展示说明文件的只读等宽文本块。 */
  readonly CodeBlock: (props: PluginRendererCodeBlockProps) => ReactNode;
  /** 安全渲染静态 Markdown 正文。 */
  readonly Markdown: (props: PluginRendererMarkdownProps) => ReactNode;
  /** 标准按钮。 */
  readonly Button: (props: PluginRendererButtonProps) => ReactNode;
  /** 标准文本或数字输入框。 */
  readonly Input: (props: PluginRendererInputProps) => ReactNode;
  /** 标准表单字段布局。 */
  readonly Field: (props: PluginRendererFieldProps) => ReactNode;
  /** 标准多行文本输入框。 */
  readonly Textarea: (props: PluginRendererTextareaProps) => ReactNode;
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
  /** 当前 Plugin 功能界面的宿主刷新版本。 */
  readonly revision: number;

  /** 通知同一 Plugin 的 Sidebar 与 Mainview 重新读取业务快照。 */
  invalidate(): void;

  /** 显示非阻塞反馈。 */
  toast(input: PluginRendererToastInput): void;

  /** 显示宿主确认对话框并返回用户选择。 */
  confirm(input: PluginRendererConfirmInput): Promise<boolean>;

  /** 与宿主主题和交互规范一致的组件集合。 */
  readonly components: PluginRendererUiComponents;
}

/** Plugin Sidebar 接收的属性。 */
export interface PluginSidebarComponentProps {
  /** 已绑定当前 Plugin 的业务 action 网关。 */
  readonly plugin: PluginActionGateway;

  /** 与 Mainview 共享且由宿主持有的路由。 */
  readonly navigation: PluginRendererNavigation;

  /** 当前 Plugin 命名空间内的只读未读通知。 */
  readonly notifications: readonly PluginRendererNotification[];

  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PluginRendererUi;
}

/** Plugin Mainview 接收的属性。 */
export interface PluginMainviewComponentProps {
  /** 已绑定当前 Plugin 的业务 action 网关。 */
  readonly plugin: PluginActionGateway;

  /** 与 Sidebar 共享且由宿主持有的路由。 */
  readonly navigation: PluginRendererNavigation;

  /** 当前 Plugin 命名空间内的只读未读通知。 */
  readonly notifications: readonly PluginRendererNotification[];

  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PluginRendererUi;
}

/** Plugin Config 接收的属性。 */
export interface PluginConfigComponentProps {
  /** 已绑定当前 Plugin 身份的 Config action 网关。 */
  readonly config: PluginConfigGateway;

  /** 宿主提供的反馈能力和 UI 组件。 */
  readonly ui: PluginRendererUi;
}

/** Plugin 自己拥有的业务 Sidebar 组件。 */
export type PluginSidebarComponent = (
  props: PluginSidebarComponentProps,
) => ReactNode;

/** Plugin 自己拥有的业务主界面组件。 */
export type PluginMainviewComponent = (
  props: PluginMainviewComponentProps,
) => ReactNode;

/** Plugin 自己拥有的 Config 组件。 */
export type PluginConfigComponent = (
  props: PluginConfigComponentProps,
) => ReactNode;

/** 单一 Renderer 入口声明的三个独立 UI 插槽。 */
export interface PluginRendererDefinition {
  /** Plugin 工作区左侧的业务导航；必须与 Mainview 同时声明。 */
  readonly sidebar?: PluginSidebarComponent;

  /** Plugin 工作区右侧的业务主界面；必须与 Sidebar 同时声明。 */
  readonly mainview?: PluginMainviewComponent;

  /** 设置中心内由宿主绑定当前 Plugin 的独立配置界面。 */
  readonly config?: PluginConfigComponent;
}
