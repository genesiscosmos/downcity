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
import type { Command as CommandPrimitive } from "cmdk";
import type * as React from "react";

/**
 * Button 组件支持的视觉变体。
 */
export type DowncityButtonVariant =
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

/**
 * Toaster 支持的主题模式。
 */
export type DowncityToasterTheme = "light" | "dark" | "system";

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
