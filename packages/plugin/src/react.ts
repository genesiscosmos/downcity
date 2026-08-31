/**
 * Plugin 唯一 Mainview 的 React 契约。
 *
 * Renderer 作为受信任本地 ESM 模块在宿主 React 树中运行。宿主负责注入统一 UI
 * Components 与绑定当前 Plugin/Profile 的 action gateway，Plugin 不读取宿主内部状态。
 */

import type { PluginRendererComponent } from "./types/PluginRenderer.js";

/** 保留 Plugin Renderer 的精确组件类型并返回原函数。 */
export function define_plugin_renderer(
  renderer: PluginRendererComponent,
): PluginRendererComponent {
  return renderer;
}

export type {
  PluginRendererButtonProps,
  PluginRendererCalloutProps,
  PluginRendererComponent,
  PluginRendererConfirmInput,
  PluginRendererEmptyStateProps,
  PluginRendererGateway,
  PluginRendererGroupProps,
  PluginRendererInlineProps,
  PluginRendererInputProps,
  PluginRendererLoadingStateProps,
  PluginRendererPageProps,
  PluginRendererProps,
  PluginRendererRowProps,
  PluginRendererSectionProps,
  PluginRendererSelectOption,
  PluginRendererSelectProps,
  PluginRendererStackProps,
  PluginRendererStatusProps,
  PluginRendererSwitchProps,
  PluginRendererToastInput,
  PluginRendererToolbarProps,
  PluginRendererUi,
  PluginRendererUiComponents,
} from "./types/PluginRenderer.js";
