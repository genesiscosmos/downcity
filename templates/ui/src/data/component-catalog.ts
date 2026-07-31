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
      { id: "button-group", label: "ButtonGroup", description: "组合相关按钮并合并相邻边界。" },
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
      { id: "input-group", label: "InputGroup", description: "将输入框、前后缀和快捷键提示组合为一个控件。" },
      { id: "radio-group", label: "RadioGroup", description: "在互斥选项中选择一个值。" },
      { id: "file-upload", label: "FileUpload", description: "以受控 File 列表接收点击或拖拽上传。" },
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
      { id: "accordion", label: "Accordion", description: "按需展开相关内容，保持页面密度。" },
      { id: "alert", label: "Alert", description: "呈现内联状态、提醒和阻断信息。" },
      { id: "avatar", label: "Avatar", description: "展示用户、项目或实体的紧凑身份标识。" },
      { id: "pagination", label: "Pagination", description: "在分页资源的相邻页面之间导航。" },
      { id: "progress", label: "Progress", description: "展示确定性任务或上传的完成进度。" },
      { id: "scroll-area", label: "ScrollArea", description: "提供与宿主样式一致的独立滚动区域。" },
      { id: "table", label: "Table", description: "以紧凑行列布局展示结构化数据。" },
      { id: "data-table", label: "DataTable", description: "通过受控列定义渲染可交互的业务表格。" },
      { id: "resizable", label: "Resizable", description: "将工作区分为可拖拽调整的面板。" },
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
      { id: "alert-dialog", label: "AlertDialog", description: "在高风险操作前请求明确确认。" },
      { id: "drawer", label: "Drawer", description: "以底部抽屉承载移动端的轻量操作。" },
      { id: "hover-card", label: "HoverCard", description: "在悬停时展示非阻断式的上下文摘要。" },
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
