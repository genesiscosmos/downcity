/** Plugin React Mainview 宿主的 Renderer 内部类型。 */

import type { PluginJsonValue } from "@downcity/plugin";
import type {
  PluginRendererComponent,
  PluginRendererConfirmInput,
  PluginRendererToastInput,
} from "@downcity/plugin/react";

/** Plugin React Mainview 宿主属性。 */
export interface PluginRendererHostProps {
  /** 当前 Plugin 稳定 ID。 */
  readonly plugin_id: string;

  /** 内置 Plugin 的静态 Mainview 组件。 */
  readonly builtin_renderer?: PluginRendererComponent;

  /** 第三方 Plugin 的受控 ESM URL。 */
  readonly renderer_url?: string;

  /** 调用已经绑定当前 Plugin/Profile 的 main action。 */
  invoke(action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;
}

/** 已动态加载的第三方 Mainview。 */
export interface LoadedPluginRenderer {
  /** 本次加载对应的 ESM URL。 */
  readonly renderer_url: string;

  /** ESM 默认导出的 Mainview 组件。 */
  readonly Component: PluginRendererComponent;
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
