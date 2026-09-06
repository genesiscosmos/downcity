/** Chat Plugin React Mainview 的内部组件属性类型。 */

import type { PluginRendererUiComponents } from "@downcity/city/plugin/react";
import type { ChatPluginPublicChannelConfig } from "./ChatPluginPublicConfig.js";

/** 单个 Chat Channel 编辑分组的属性。 */
export interface ChatPluginChannelEditorProps {
  /** 当前 Channel 草稿。 */
  readonly channel: ChatPluginPublicChannelConfig;

  /** 当前配置中已经被其他 Channel 使用的类型。 */
  readonly used_types: ReadonlySet<ChatPluginPublicChannelConfig["type"]>;

  /** 当前 Mainview 使用的宿主 UI Components。 */
  readonly components: Pick<
    PluginRendererUiComponents,
    "Button" | "Group" | "Input" | "Row" | "Select" | "Switch"
  >;

  /** 替换当前 Channel 草稿。 */
  update(channel: ChatPluginPublicChannelConfig): void;

  /** 删除当前 Channel 草稿。 */
  remove(): void;
}
