/**
 * UI 展示页组件目录。
 *
 * 目录是 Sidebar、移动端选择器和右侧标题的单一事实源。
 */

import type {
  ShowcaseComponentEntry,
  ShowcaseComponentGroup,
  ShowcaseComponentId,
} from "../types/components.js";

export const component_groups: readonly ShowcaseComponentGroup[] = [
  {
    label: "Actions",
    items: [
      { id: "button", label: "Button", description: "触发主要、次要或危险操作。" },
      { id: "badge", label: "Badge", description: "展示状态、分类和轻量统计。" },
      { id: "toggle", label: "Toggle", description: "切换单个状态或一组选项。" },
      { id: "spinner", label: "Spinner", description: "表达进行中的异步状态。" },
      { id: "kbd", label: "Kbd", description: "展示快捷键和键位组合。" },
      { id: "code-block", label: "CodeBlock", description: "展示语法高亮代码与复制操作。" },
      { id: "typography", label: "Typography", description: "提供与 Vibecape 一致的文本层级。" },
    ],
  },
  {
    label: "Forms",
    items: [
      { id: "input", label: "Input", description: "接收单行文本与短配置。" },
      { id: "textarea", label: "Textarea", description: "接收多行内容与长文本。" },
      { id: "checkbox", label: "Checkbox", description: "选择一个或多个独立选项。" },
      { id: "select", label: "Select", description: "从分组选项中选择单个值。" },
      { id: "slider", label: "Slider", description: "选择数值或数值范围。" },
      { id: "switch", label: "Switch", description: "切换一个布尔配置。" },
      { id: "form-field", label: "FormField", description: "组合字段标签、说明、错误与控件。" },
    ],
  },
  {
    label: "Display",
    items: [
      { id: "card", label: "Card", description: "组织标题、内容和操作区域。" },
      { id: "tabs", label: "Tabs", description: "在同一层级切换内容面板。" },
      { id: "item", label: "Item", description: "组合资源、搜索结果和设置入口。" },
      { id: "empty", label: "Empty", description: "展示无数据与首次使用状态。" },
      { id: "skeleton", label: "Skeleton", description: "保持异步内容加载时的结构稳定。" },
      { id: "separator", label: "Separator", description: "分隔相邻内容区域。" },
      { id: "settings", label: "Settings", description: "组合紧凑设置页与信息分组。" },
      { id: "sidebar-layout", label: "SidebarLayout", description: "组织固定头尾与独立滚动的侧栏主体。" },
    ],
  },
  {
    label: "Overlays",
    items: [
      { id: "dropdown-menu", label: "DropdownMenu", description: "通过按钮打开操作菜单。" },
      { id: "context-menu", label: "ContextMenu", description: "为目标区域提供右键操作。" },
      { id: "popover", label: "Popover", description: "展示轻量上下文与辅助设置。" },
      { id: "dialog", label: "Dialog", description: "承载需要确认的阻断式任务。" },
      { id: "sheet", label: "Sheet", description: "从页面边缘承载较长工作流。" },
      { id: "tooltip", label: "Tooltip", description: "提供简短的悬停或聚焦提示。" },
      { id: "command", label: "Command", description: "提供搜索、键盘导航与快速执行。" },
      { id: "toaster", label: "Toaster", description: "承载非阻断式全局反馈。" },
      { id: "menu", label: "Menu", description: "提供无需行为依赖的菜单展示原语。" },
      { id: "image-preview", label: "ImagePreview", description: "使用任意 URL 或 data URL 预览图片。" },
    ],
  },
  {
    label: "Composed",
    items: [
      { id: "workboard", label: "Workboard", description: "通过公开快照展示 Agent 工作世界。" },
    ],
  },
];

export const component_entries: readonly ShowcaseComponentEntry[] = component_groups.flatMap(
  (group) => group.items,
);

/** 根据稳定标识读取组件目录信息。 */
export function find_component_entry(component_id: ShowcaseComponentId): ShowcaseComponentEntry {
  return component_entries.find((entry) => entry.id === component_id) ?? component_entries[0];
}

/** 判断 URL hash 是否对应已注册的组件。 */
export function is_showcase_component_id(value: string): value is ShowcaseComponentId {
  return component_entries.some((entry) => entry.id === value);
}
