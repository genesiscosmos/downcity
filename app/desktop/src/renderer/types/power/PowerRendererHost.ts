/** Power React 插槽宿主的 Renderer 内部类型。 */

import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { PowerRendererConfirmInput, PowerRendererDefinition, PowerRendererNotification, PowerRendererToastInput } from "@downcity/city/power/react";

/** Power Renderer 当前承载的独立 UI 插槽。 */
export type PowerRendererSlot = "sidebar" | "mainview" | "config";

/** Power 清单声明的 Renderer 插槽能力。 */
export interface PowerRendererCapabilities {
  /** Power 是否声明专属 Sidebar。 */
  readonly has_sidebar: boolean;
  /** Power 是否声明业务 Mainview。 */
  readonly has_mainview: boolean;
  /** Power 是否声明设置中心 Config。 */
  readonly has_config: boolean;
}

/** Power React 插槽宿主属性。 */
export interface PowerRendererHostProps {
  /** 当前 Power 稳定 ID。 */
  readonly power_id: string;
  /** Sidebar 插槽由宿主展示的 Power 标题。 */
  readonly sidebar_title?: string;
  /** 当前要渲染的独立插槽。 */
  readonly slot: PowerRendererSlot;
  /** Power 清单声明的插槽能力，用于校验实际 ESM 导出。 */
  readonly capabilities: PowerRendererCapabilities;
  /** 内置 Power 的静态 Renderer 定义。 */
  readonly builtin_renderer?: PowerRendererDefinition;
  /** 第三方 Power 的受控 ESM URL。 */
  readonly renderer_url?: string;
  /** 调用当前 Power 的业务 action。 */
  invoke_mainview(action_id: string, input?: PowerJsonValue): Promise<PowerJsonValue>;
  /** 调用当前 Power 的唯一 Config action。 */
  invoke_config?(action_id: string, input?: PowerJsonValue): Promise<PowerJsonValue>;
  /** Sidebar 与 Mainview 共享的宿主路由。 */
  readonly route?: PowerJsonObject;
  /** 当前 Power 命名空间内的只读未读通知。 */
  readonly notifications?: readonly PowerRendererNotification[];
  /** 替换 Sidebar 与 Mainview 共享的宿主路由。 */
  navigate?(route: PowerJsonObject): void;
  /** 当前 Power 功能界面的宿主刷新版本。 */
  readonly revision?: number;
  /** 通知同一 Power 的 Sidebar 与 Mainview 重新读取业务快照。 */
  invalidate?(): void;
}

/** 已动态加载的第三方 Renderer。 */
export interface LoadedPowerRenderer {
  /** 本次加载对应的 ESM URL。 */
  readonly renderer_url: string;
  /** ESM 默认导出的三个独立插槽定义。 */
  readonly definition: PowerRendererDefinition;
}

/** 正在等待用户选择的确认对话框。 */
export interface PowerRendererConfirmationState {
  /** Power 请求的确认内容。 */
  readonly input: PowerRendererConfirmInput;
}

/** 当前显示的 Power Toast。 */
export interface PowerRendererToastState extends PowerRendererToastInput {
  /** 用于区分连续相同消息的本地标识。 */
  readonly toast_id: number;
}
