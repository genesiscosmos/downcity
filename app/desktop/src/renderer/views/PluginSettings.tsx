/** Plugin Catalog 详情页内的唯一 Config 面板。 */

import { useCallback } from "react";
import type { PluginJsonValue } from "@downcity/city/plugin";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import { PluginRendererHost } from "@/features/plugin/lib/PluginRendererHost";
import type { DesktopActions } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";

/** 直接渲染 City 为 Plugin 持有的唯一配置界面。 */
export function PluginConfigPanel({ controller, plugin, definition }: {
  /** Renderer 稳定操作集合。 */ readonly controller: DesktopActions;
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** 已加载的完整 Plugin 定义。 */ readonly definition?: DesktopPluginDefinition;
}) {
  const invoke_plugin_action = controller.invoke_plugin_action;
  const invoke_config = useCallback(
    (action_id: string, input?: PluginJsonValue) => invoke_plugin_action(plugin.plugin_id, {
      surface: "config",
      action_id,
      ...(input !== undefined ? { input } : {}),
    }),
    [invoke_plugin_action, plugin.plugin_id],
  );
  const renderer = plugin.source === "builtin"
    ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id]
    : undefined;
  return <section className="overflow-hidden rounded-xl bg-surface-subtle p-4">
    <PluginRendererHost
      plugin_id={plugin.plugin_id}
      slot="config"
      capabilities={plugin}
      builtin_renderer={renderer}
      renderer_url={definition?.renderer_url}
      invoke_mainview={async () => { throw new Error("Config cannot invoke workspace actions"); }}
      invoke_config={invoke_config}
    />
  </section>;
}
