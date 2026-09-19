/**
 * Power Sidebar、Mainview 与 Config 的 React 契约。
 *
 * Renderer 作为受信任本地 ESM 模块在宿主 React 树中运行。宿主负责注入统一 UI
 * Components 与按界面隔离的 action gateway，Power 不读取宿主内部状态。
 */

import type { PowerRendererDefinition } from "./types/PowerRenderer.js";

/** 保留 Power Renderer 定义的精确类型并返回原对象。 */
export function define_power_renderer(
  renderer: PowerRendererDefinition,
): PowerRendererDefinition {
  return renderer;
}

export type { PowerRendererNotification } from "./types/PowerNotification.js";

export type {
  PowerActionGateway,
  PowerConfigComponent,
  PowerConfigComponentProps,
  PowerConfigGateway,
  PowerMainviewComponent,
  PowerMainviewComponentProps,
  PowerRendererButtonProps,
  PowerRendererCalloutProps,
  PowerRendererCodeBlockProps,
  PowerRendererConfirmInput,
  PowerRendererDefinition,
  PowerRendererEmptyStateProps,
  PowerRendererFieldProps,
  PowerRendererGroupProps,
  PowerRendererInlineProps,
  PowerRendererInputProps,
  PowerRendererItemMenuAction,
  PowerRendererItemMenuProps,
  PowerRendererLoadingStateProps,
  PowerRendererMarkdownProps,
  PowerRendererPageProps,
  PowerRendererNavigation,
  PowerRendererRowProps,
  PowerRendererSectionProps,
  PowerRendererSelectOption,
  PowerRendererSelectProps,
  PowerRendererSidebarItemProps,
  PowerRendererSidebarProps,
  PowerRendererSidebarCreateMenuProps,
  PowerRendererSidebarSectionProps,
  PowerRendererSidebarSubTextProps,
  PowerRendererSidebarTreeItemProps,
  PowerRendererStackProps,
  PowerRendererStatusProps,
  PowerRendererSwitchProps,
  PowerRendererTabItem,
  PowerRendererTabsProps,
  PowerRendererTextareaProps,
  PowerRendererToastInput,
  PowerRendererToolbarProps,
  PowerRendererUi,
  PowerRendererUiComponents,
  PowerSidebarComponent,
  PowerSidebarComponentProps,
} from "./types/PowerRenderer.js";
