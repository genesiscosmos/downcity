/** Plugin React 插槽宿主的 Renderer 内部类型。 */

import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type { PluginRendererConfirmInput, PluginRendererDefinition, PluginRendererNotification, PluginRendererToastInput } from "@downcity/city/plugin/react";

/** Plugin Renderer 当前承载的独立 UI 插槽。 */
export type PluginRendererSlot = "sidebar" | "mainview" | "config";

/** Plugin 清单声明的 Renderer 插槽能力。 */
export interface PluginRendererCapabilities {
  /** Plugin 是否声明专属 Sidebar。 */
  readonly has_sidebar: boolean;
  /** Plugin 是否声明业务 Mainview。 */
  readonly has_mainview: boolean;
  /** Plugin 是否声明设置中心 Config。 */
  readonly has_config: boolean;
}

/** Plugin React 插槽宿主属性。 */
export interface PluginRendererHostProps {
  /** 当前 Plugin 稳定 ID。 */
  readonly plugin_id: string;
  /** 当前要渲染的独立插槽。 */
  readonly slot: PluginRendererSlot;
  /** Plugin 清单声明的插槽能力，用于校验实际 ESM 导出。 */
  readonly capabilities: PluginRendererCapabilities;
  /** 内置 Plugin 的静态 Renderer 定义。 */
  readonly builtin_renderer?: PluginRendererDefinition;
  /** 第三方 Plugin 的受控 ESM URL。 */
  readonly renderer_url?: string;
  /** 调用当前 Plugin 的业务 action。 */
  invoke_mainview(action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;
  /** 调用当前 Plugin 的唯一 Config action。 */
  invoke_config?(action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;
  /** Sidebar 与 Mainview 共享的宿主路由。 */
  readonly route?: PluginJsonObject;
  /** 当前 Plugin 命名空间内的只读未读通知。 */
  readonly notifications?: readonly PluginRendererNotification[];
  /** 替换 Sidebar 与 Mainview 共享的宿主路由。 */
  navigate?(route: PluginJsonObject): void;
  /** 当前 Plugin 功能界面的宿主刷新版本。 */
  readonly revision?: number;
  /** 通知同一 Plugin 的 Sidebar 与 Mainview 重新读取业务快照。 */
  invalidate?(): void;
}

/** 已动态加载的第三方 Renderer。 */
export interface LoadedPluginRenderer {
  /** 本次加载对应的 ESM URL。 */
  readonly renderer_url: string;
  /** ESM 默认导出的三个独立插槽定义。 */
  readonly definition: PluginRendererDefinition;
}

/** 正在等待用户选择的确认对话框。 */
export interface PluginRendererConfirmationState {
  /** Plugin 请求的确认内容。 */
  readonly input: PluginRendererConfirmInput;
}

/** 当前显示的 Plugin Toast。 */
export interface PluginRendererToastState extends PluginRendererToastInput {
  /** 用于区分连续相同消息的本地标识。 */
  readonly toast_id: number;
}
