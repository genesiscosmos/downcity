/**
 * Downcity UI SDK 公共类型定义。
 *
 * 关键说明（中文）
 * - 基础组件的公共联合类型统一集中到 `types/` 目录。
 * - 这里只放跨组件共享或对外公开的类型，不放实现细节。
 */

import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { Select as SelectPrimitive } from "@base-ui/react/select";
import type { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { Command as CommandPrimitive } from "cmdk";
import type * as React from "react";
import type { ToasterProps } from "sonner";

/** ToggleGroup 支持的视觉尺寸。 */
export type DowncityToggleGroupSize = "default" | "sm" | "lg";

/** ToggleGroup 保留的视觉变体；两种变体共享同一套主题表面。 */
export type DowncityToggleGroupVariant = "default" | "outline";

/** ToggleGroup 属性；组件固定为互斥单选，以支持唯一的移动激活层。 */
export interface DowncityToggleGroupProps extends Omit<ToggleGroupPrimitive.Props<string>, "multiple"> {
  /** 根元素引用，用于宿主应用读取布局或控制焦点。 */
  ref?: React.Ref<HTMLDivElement>;
  /** 组内项目之间的像素间距，默认无间距。 */
  spacing?: number;
  /** 组内项目的统一视觉尺寸。 */
  size?: DowncityToggleGroupSize;
  /** 组内项目的统一视觉变体。 */
  variant?: DowncityToggleGroupVariant;
}

/** Annotation 支持的语义强度。 */
export type DowncityAnnotationTone = "note" | "info" | "warning" | "danger";

/** Annotation 注释块属性。 */
export interface DowncityAnnotationProps extends Omit<React.ComponentPropsWithoutRef<"aside">, "title"> {
  /** 注释块顶部展示的可选标题。 */
  title?: React.ReactNode;
  /** 注释块的语义强度，只影响由主题变量派生的边界与表面。 */
  tone?: DowncityAnnotationTone;
}

/** Typography 标题组件属性。 */
export type DowncityTypographyHeadingProps = React.ComponentPropsWithoutRef<"h1">;

/** Typography 段落组件属性。 */
export type DowncityTypographyParagraphProps = React.ComponentPropsWithoutRef<"p">;

/** Typography 行内文本组件属性。 */
export type DowncityTypographySpanProps = React.ComponentPropsWithoutRef<"span">;

/** Typography 引用组件属性。 */
export type DowncityTypographyBlockquoteProps = React.ComponentPropsWithoutRef<"blockquote">;

/** Typography 无序列表组件属性。 */
export type DowncityTypographyUnorderedListProps = React.ComponentPropsWithoutRef<"ul">;

/** Typography 有序列表组件属性。 */
export type DowncityTypographyOrderedListProps = React.ComponentPropsWithoutRef<"ol">;

/** Typography 列表项组件属性。 */
export type DowncityTypographyListItemProps = React.ComponentPropsWithoutRef<"li">;

/** Typography 行内代码组件属性。 */
export type DowncityTypographyInlineCodeProps = React.ComponentPropsWithoutRef<"code">;

/** FootnoteReference 正文脚注引用属性。 */
export interface DowncityFootnoteReferenceProps extends React.ComponentPropsWithoutRef<"a"> {
  /** 引用展示的脚注序号或短标签。 */
  label: React.ReactNode;
}

/** Footnotes 脚注区域属性。 */
export interface DowncityFootnotesProps extends Omit<React.ComponentPropsWithoutRef<"section">, "title"> {
  /** 脚注区域的可选标题。 */
  title?: React.ReactNode;
}

/** FootnoteItem 单条脚注属性。 */
export interface DowncityFootnoteItemProps extends React.ComponentPropsWithoutRef<"li"> {
  /** 返回正文引用位置的可选链接。 */
  back_href?: string;
  /** 返回正文链接的无障碍标签。 */
  back_label?: string;
}

/** TaskListItem 任务列表项属性。 */
export interface DowncityTaskListItemProps extends Omit<React.ComponentPropsWithoutRef<"li">, "children"> {
  /** 当前任务是否完成。 */
  checked?: boolean;
  /** 任务项展示的正文内容。 */
  children: React.ReactNode;
}

/** DefinitionList 定义列表属性。 */
export type DowncityDefinitionListProps = React.ComponentPropsWithoutRef<"dl">;

/** DefinitionTerm 定义名称属性。 */
export type DowncityDefinitionTermProps = React.ComponentPropsWithoutRef<"dt">;

/** DefinitionDescription 定义说明属性。 */
export type DowncityDefinitionDescriptionProps = React.ComponentPropsWithoutRef<"dd">;

/** ButtonGroup 支持的排列方向。 */
export type DowncityButtonGroupOrientation = "horizontal" | "vertical";

/** ButtonGroup 组合容器属性。 */
export interface DowncityButtonGroupProps extends React.ComponentPropsWithoutRef<"div"> {
  /** 相邻按钮的排列方向。 */
  orientation?: DowncityButtonGroupOrientation;
}

/** ThemeContainer 支持的主题预设。 */
export type DowncityThemeVariant =
  | "neutral"
  | "zinc"
  | "slate"
  | "stone"
  | "blue";

/** ThemeContainer 支持的明暗模式。 */
export type DowncityThemeMode = "light" | "dark";

/** ThemeContainer 主题容器属性。 */
export interface DowncityThemeContainerProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /** 当前组件树使用的颜色主题预设。 */
  variant?: DowncityThemeVariant;
  /** 当前组件树使用的明确明暗模式。 */
  mode?: DowncityThemeMode;
}

/** 主题内部上下文，仅供组件 Portal 继承唯一主题容器。 */
export interface DowncityThemeContextValue {
  /** 当前主题容器拥有的 Portal 挂载节点引用。 */
  portal_container: React.RefObject<HTMLDivElement | null>;
}

/**
 * Button 组件支持的视觉变体。
 */
export type DowncityButtonVariant =
  | "primary"
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";

/**
 * Button 组件支持的尺寸。
 */
export type DowncityButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

/**
 * Card 组件支持的尺寸。
 */
export type DowncityCardSize = "default" | "sm";

/**
 * DropdownMenu Item 组件支持的变体。
 */
export type DowncityDropdownMenuItemVariant = "default" | "destructive";

/** ContextMenu 菜单项支持的视觉变体。 */
export type DowncityContextMenuItemVariant = "default" | "destructive";

/** Item 通用内容项支持的视觉变体。 */
export type DowncityItemVariant = "default" | "outline" | "muted";

/** Item 通用内容项支持的尺寸。 */
export type DowncityItemSize = "default" | "sm";

/** Item 图形区域支持的视觉变体。 */
export type DowncityItemMediaVariant = "default" | "icon" | "image";

/** Spinner 支持的视觉尺寸。 */
export type DowncitySpinnerSize = "sm" | "default" | "lg";

/** CodeBlock 组件属性。 */
export interface DowncityCodeBlockProps extends React.ComponentProps<"pre"> {
  /** 未经语法高亮处理的原始代码，用于复制操作。 */
  code?: string;
  /** 代码语言标签，例如 `tsx`、`css` 或 `bash`。 */
  language?: string;
  /** 代码块顶部展示的可选文件名或说明。 */
  label?: string;
  /** MDX 编译器写入的原始代码内容。 */
  "data-raw"?: string;
  /** MDX 编译器写入的代码语言。 */
  "data-language"?: string;
}

/** Command 搜索输入框属性。 */
export interface DowncityCommandInputProps
  extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  /** 搜索输入框左侧展示的可选自定义内容。 */
  leading?: React.ReactNode;
}

/** ContextMenu 浮层属性。 */
export interface DowncityContextMenuContentProps
  extends ContextMenuPrimitive.Popup.Props {
  /** 浮层相对指针锚点的对齐方向。 */
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  /** 浮层与对齐位置之间的横向偏移量。 */
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
  /** 浮层相对指针锚点出现的一侧。 */
  side?: ContextMenuPrimitive.Positioner.Props["side"];
  /** 浮层与指针锚点之间的距离。 */
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
}

/** ContextMenu 普通菜单项属性。 */
export interface DowncityContextMenuItemProps
  extends ContextMenuPrimitive.Item.Props {
  /** 是否增加左侧缩进，以便与带图标的菜单项对齐。 */
  inset?: boolean;
  /** 菜单项的视觉语义。 */
  variant?: DowncityContextMenuItemVariant;
}

/** Toaster 属性；实现会忽略 Sonner 的旧 theme 输入并继承 ThemeContainer。 */
export type DowncityToasterProps = ToasterProps;

/** Select 触发器支持的尺寸。 */
export type DowncitySelectTriggerSize = "default" | "sm";

/** Select 触发器属性。 */
export interface DowncitySelectTriggerProps extends SelectPrimitive.Trigger.Props {
  /** 触发器的视觉尺寸。 */
  size?: DowncitySelectTriggerSize;
}

/** Select 浮层属性。 */
export interface DowncitySelectContentProps extends SelectPrimitive.Popup.Props {
  /** 浮层相对触发器的对齐方向。 */
  align?: SelectPrimitive.Positioner.Props["align"];
  /** 浮层与触发器对齐方向上的偏移量。 */
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  /** 浮层相对触发器出现的一侧。 */
  side?: SelectPrimitive.Positioner.Props["side"];
  /** 浮层与触发器之间的距离。 */
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
}

/** Select 选项属性。 */
export interface DowncitySelectItemProps extends SelectPrimitive.Item.Props {
  /** 选项标题下方的补充说明。 */
  description?: React.ReactNode;
}

/** Slider 根组件属性，支持单值与范围值。 */
export type DowncitySliderProps = SliderPrimitive.Root.Props<
  number | readonly number[]
>;

/** SettingsContainer 属性。 */
export interface DowncitySettingsContainerProps {
  /** 设置页面中按顺序排列的分区。 */
  children: React.ReactNode;
  /** 宿主用于扩展外层布局的类名。 */
  className?: string;
}

/** SettingSection 属性。 */
export interface DowncitySettingSectionProps {
  /** 当前设置分区的可选标题。 */
  title?: React.ReactNode;
  /** 当前设置分区的可选补充说明。 */
  description?: React.ReactNode;
  /** 标题区域右侧的可选操作。 */
  action?: React.ReactNode;
  /** 当前分区承载的设置分组。 */
  children: React.ReactNode;
  /** 宿主用于扩展分区布局的类名。 */
  className?: string;
}

/** SettingGroup 属性。 */
export interface DowncitySettingGroupProps {
  /** 分组内按行排列的设置项。 */
  children: React.ReactNode;
  /** 宿主用于扩展分组布局的类名。 */
  className?: string;
}

/** SettingItem 属性。 */
export interface DowncitySettingItemProps {
  /** 当前设置项的主要标签。 */
  label: React.ReactNode;
  /** 当前设置项的可选补充说明。 */
  description?: React.ReactNode;
  /** 当前设置项右侧的控件或状态。 */
  children: React.ReactNode;
  /** 宿主用于扩展设置项布局的类名。 */
  className?: string;
}

/** InfoRow 属性。 */
export interface DowncityInfoRowProps {
  /** 信息行左侧的字段标签。 */
  label: React.ReactNode;
  /** 信息行右侧的字段值。 */
  children: React.ReactNode;
  /** 宿主用于扩展信息行布局的类名。 */
  className?: string;
}

/** ImagePreview 属性。 */
export interface DowncityImagePreviewProps {
  /** 是否展示全屏预览。 */
  open: boolean;
  /** 请求关闭预览时触发。 */
  onOpenChange: (open: boolean) => void;
  /** 要预览的图片地址，可以是 data URL、Blob URL 或远程地址。 */
  src: string;
  /** 图片的替代文字。 */
  alt?: string;
  /** 宿主用于扩展预览根节点的类名。 */
  className?: string;
}

/** 文件上传组件属性。 */
export interface DowncityFileUploadProps {
  /** 当前已选择的文件；由宿主保存并回传，组件不持久化文件。 */
  files?: readonly File[];
  /** 用户选择或拖入文件后触发，返回完整的新文件列表。 */
  onFilesChange: (files: File[]) => void;
  /** 原生文件输入允许的 MIME 类型或扩展名规则。 */
  accept?: string;
  /** 是否允许一次选择多个文件。 */
  multiple?: boolean;
  /** 是否禁用选择与拖拽交互。 */
  disabled?: boolean;
  /** 可选择文件的最大数量；未提供时不限制。 */
  maxFiles?: number;
  /** 空状态中展示的主要说明。 */
  label?: React.ReactNode;
  /** 空状态中展示的补充说明。 */
  description?: React.ReactNode;
  /** 宿主用于扩展上传区域布局的类名。 */
  className?: string;
}

/** DataTable 列定义。 */
export interface DowncityDataTableColumn<Row> {
  /** 用于 React key 和列语义的稳定标识。 */
  id: string;
  /** 表头中展示的列标题。 */
  header: React.ReactNode;
  /** 根据当前行数据渲染单元格内容。 */
  cell: (row: Row) => React.ReactNode;
  /** 表头与单元格的可选对齐方式。 */
  align?: "left" | "center" | "right";
  /** 宿主用于扩展该列单元格样式的类名。 */
  className?: string;
}

/** DataTable 组件属性。 */
export interface DowncityDataTableProps<Row> {
  /** 需要展示的行数据。 */
  data: readonly Row[];
  /** 表格的列定义，决定展示顺序与单元格渲染方式。 */
  columns: readonly DowncityDataTableColumn<Row>[];
  /** 返回行的稳定标识，用于 React key 与交互回调。 */
  getRowId: (row: Row, index: number) => React.Key;
  /** 数据为空时展示的可选内容。 */
  empty?: React.ReactNode;
  /** 用户点击某行时触发；未提供时行不可点击。 */
  onRowClick?: (row: Row) => void;
  /** 宿主用于扩展表格布局的类名。 */
  className?: string;
}

/** SidebarLayout 属性。 */
export interface DowncitySidebarLayoutProps {
  /** 固定在顶部的可选区域。 */
  header?: React.ReactNode;
  /** 可独立滚动的主体内容。 */
  children: React.ReactNode;
  /** 固定在底部的可选区域。 */
  footer?: React.ReactNode;
  /** 宿主用于扩展外层布局的类名。 */
  className?: string;
}

/** FormField 属性。 */
export interface DowncityFormFieldProps {
  /** 字段名称。 */
  label: React.ReactNode;
  /** 字段的可选说明。 */
  description?: React.ReactNode;
  /** 字段校验失败时展示的错误内容。 */
  error?: React.ReactNode;
  /** 是否显示必填标识。 */
  required?: boolean;
  /** 字段控件。 */
  children: React.ReactNode;
  /** 是否使用标签与控件横向排列的紧凑布局。 */
  horizontal?: boolean;
  /** 宿主用于扩展字段布局的类名。 */
  className?: string;
}

/** CollapsibleSettingGroup 属性。 */
export interface DowncityCollapsibleSettingGroupProps {
  /** 分组标题。 */
  title: React.ReactNode;
  /** 标题左侧的可选内容。 */
  leading?: React.ReactNode;
  /** 标题右侧的可选数量。 */
  count?: number;
  /** 展开的分组内容。 */
  children: React.ReactNode;
  /** 初始展开状态。 */
  defaultOpen?: boolean;
  /** 宿主用于扩展分组布局的类名。 */
  className?: string;
}

/** SettingList 属性。 */
export interface DowncitySettingListProps {
  /** 列表内容。 */
  children?: React.ReactNode;
  /** 没有内容时展示的空状态。 */
  empty?: React.ReactNode;
  /** 是否展示加载状态。 */
  loading?: boolean;
  /** 宿主用于扩展列表布局的类名。 */
  className?: string;
}
