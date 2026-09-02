/**
 * Plugin Sidebar、Mainview 与 Config 的 React 契约。
 *
 * Renderer 作为受信任本地 ESM 模块在宿主 React 树中运行。宿主负责注入统一 UI
 * Components 与按界面隔离的 action gateway，Plugin 不读取宿主内部状态。
 */

import type { PluginRendererDefinition } from "./types/PluginRenderer.js";

/** 保留 Plugin Renderer 定义的精确类型并返回原对象。 */
export function define_plugin_renderer(
  renderer: PluginRendererDefinition,
): PluginRendererDefinition {
  return renderer;
}

export type { PluginRendererNotification } from "./types/PluginNotification.js";

export type {
  PluginActionGateway,
  PluginConfigComponent,
  PluginConfigComponentProps,
  PluginConfigGateway,
  PluginMainviewComponent,
  PluginMainviewComponentProps,
  PluginRendererMainviewSidebarItemProps,
  PluginRendererMainviewSidebarProps,
  PluginRendererButtonProps,
  PluginRendererCalloutProps,
  PluginRendererCodeBlockProps,
  PluginRendererConfirmInput,
  PluginRendererDefinition,
  PluginRendererEmptyStateProps,
  PluginRendererFieldProps,
  PluginRendererGroupProps,
  PluginRendererInlineProps,
  PluginRendererInputProps,
  PluginRendererItemMenuAction,
  PluginRendererItemMenuProps,
  PluginRendererLoadingStateProps,
  PluginRendererMarkdownProps,
  PluginRendererPageProps,
  PluginRendererNavigation,
  PluginRendererRowProps,
  PluginRendererSectionProps,
  PluginRendererSelectOption,
  PluginRendererSelectProps,
  PluginRendererSidebarItemProps,
  PluginRendererSidebarProps,
  PluginRendererSidebarSectionProps,
  PluginRendererSidebarTreeItemProps,
  PluginRendererStackProps,
  PluginRendererStatusProps,
  PluginRendererSwitchProps,
  PluginRendererTabItem,
  PluginRendererTabsProps,
  PluginRendererTextareaProps,
  PluginRendererToastInput,
  PluginRendererToolbarProps,
  PluginRendererUi,
  PluginRendererUiComponents,
  PluginSidebarComponent,
  PluginSidebarComponentProps,
} from "./types/PluginRenderer.js";
