/** Plugin Mainview iframe 的 Renderer 属性。 */

import type { PluginJsonValue } from "@downcity/plugin";

/** 隔离 Plugin Mainview iframe 的属性。 */
export interface PluginRendererFrameProps {
  /** 当前 Plugin 的稳定 ID。 */
  plugin_id: string;

  /** 当前 Mainview 绑定的 Profile ID。 */
  profile_id: string;

  /** Plugin 包提供的自包含 HTML。 */
  renderer_html: string;

  /** 调用当前 Plugin/Profile 范围内的 main action。 */
  invoke(action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;
}
