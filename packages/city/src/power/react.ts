/**
 * Power Sidebar、Mainview、Config 与 Agent Profile 页签的 React 契约。
 *
 * Renderer 作为受信任本地 ESM 模块在宿主 React 树中运行。宿主负责注入统一 UI
 * Components 与按界面隔离的 action gateway，Power 不读取宿主内部状态。
 */

import type { PowerRendererDefinition } from "./types/PowerRenderer.js";

/** 保留 Power Renderer 定义的精确类型并返回原对象。 */
export function define_power_renderer(
  renderer: PowerRendererDefinition,
): PowerRendererDefinition {
  const error = get_power_renderer_definition_error(renderer);
  if (error) throw new Error(`Power renderer definition is invalid: ${error}`);
  return renderer;
}

/** 校验受信任本地 Renderer 的 UI 插槽结构；清单能力匹配由宿主另行校验。 */
export function get_power_renderer_definition_error(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "default export must be an object";
  const definition = value as PowerRendererDefinition;
  for (const slot of ["sidebar", "mainview", "config", "message", "preview"] as const) {
    if (definition[slot] !== undefined && typeof definition[slot] !== "function") return `${slot} must be a component or function`;
  }
  if (Boolean(definition.sidebar) !== Boolean(definition.mainview)) return "sidebar and mainview must be provided together";
  const agent_config = definition.agent_config;
  if (agent_config !== undefined) {
    if (!agent_config || typeof agent_config !== "object" || Array.isArray(agent_config)) return "agent_config must be an object";
    if (typeof agent_config.id !== "string" || !agent_config.id.trim()) return "agent_config.id must be a non-empty string";
    if (typeof agent_config.label !== "string" || !agent_config.label.trim()) return "agent_config.label must be a non-empty string";
    if (typeof agent_config.component !== "function") return "agent_config.component must be a component";
  }
  if (!definition.sidebar && !definition.config && !definition.message && !agent_config) return "at least one UI capability is required";
  return undefined;
}

export type { PowerRendererNotification } from "./types/PowerNotification.js";

export type {
  PowerActionGateway,
  PowerAgentConfigComponent,
  PowerAgentConfigComponentProps,
  PowerAgentConfigDefinition,
  PowerMarkdownRenderRequest,
  PowerMessageComponent,
  PowerMessageComponentProps,
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
  PowerRendererLinkProps,
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
  PowerRendererStatusDotProps,
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
