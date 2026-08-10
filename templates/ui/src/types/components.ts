/**
 * UI 展示应用的组件类型。
 *
 * 这些类型只描述展示应用自身的目录与预览状态，不扩展 `@downcity/ui` 的公开类型。
 */

/** 展示页支持选择的组件标识。 */
export type ShowcaseComponentId =
  | "button"
  | "button-group"
  | "badge"
  | "toggle"
  | "spinner"
  | "kbd"
  | "input"
  | "textarea"
  | "checkbox"
  | "code-block"
  | "select"
  | "slider"
  | "switch"
  | "card"
  | "tabs"
  | "item"
  | "empty"
  | "skeleton"
  | "separator"
  | "settings"
  | "dropdown-menu"
  | "context-menu"
  | "popover"
  | "dialog"
  | "sheet"
  | "tooltip"
  | "command"
  | "toaster"
  | "chat"
  | "workboard"
  | "image-preview"
  | "menu"
  | "typography"
  | "sidebar-layout"
  | "form-field"
  | "accordion"
  | "alert"
  | "alert-dialog"
  | "avatar"
  | "drawer"
  | "input-group"
  | "pagination"
  | "progress"
  | "radio-group"
  | "scroll-area"
  | "table"
  | "file-upload"
  | "data-table"
  | "resizable"
  | "hover-card";

/** Sidebar 中的单个组件入口。 */
export interface ShowcaseComponentEntry {
  /** 用于状态、URL hash 与预览路由的稳定标识。 */
  id: ShowcaseComponentId;
  /** Sidebar 和移动端选择器显示的组件名称。 */
  label: string;
  /** 右侧预览标题下方显示的用途说明。 */
  description: string;
}

/** Sidebar 中的一组组件入口。 */
export interface ShowcaseComponentGroup {
  /** 组件分组的可见标题。 */
  label: string;
  /** 当前分组内按展示顺序排列的组件。 */
  items: readonly ShowcaseComponentEntry[];
}

/** ShowcaseSidebar 组件属性。 */
export interface ShowcaseSidebarProps {
  /** 当前正在右侧展示的组件标识。 */
  selected_component_id: ShowcaseComponentId;
  /** 用户从目录选择组件时触发的回调。 */
  on_select_component: (component_id: ShowcaseComponentId) => void;
  /** 当前应用使用的颜色主题标识。 */
  theme_id: ShowcaseThemeId;
  /** 用户切换颜色主题时触发的回调。 */
  on_theme_change: (theme_id: ShowcaseThemeId) => void;
  /** 当前外观偏好，决定浅色、深色或跟随系统。 */
  color_mode: ShowcaseColorMode;
  /** 用户切换外观偏好时触发的回调。 */
  on_color_mode_change: (color_mode: ShowcaseColorMode) => void;
}

/** 展示站支持的 Shadcn 风格颜色主题。 */
export type ShowcaseThemeId = "neutral" | "zinc" | "slate" | "stone" | "blue";

/** 展示站支持的外观偏好。 */
export type ShowcaseColorMode = "system" | "light" | "dark";

/** ComponentDemo 组件属性。 */
export interface ComponentDemoProps {
  /** MDX 文档请求展示的组件标识。 */
  component_id: ShowcaseComponentId;
}
