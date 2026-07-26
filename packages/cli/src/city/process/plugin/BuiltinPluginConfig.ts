/** City 内建 Plugin 的 Binding 配置目录。 */

import type { CityBuiltinPluginConfigDefinition } from "@/city/types/plugin/CityBuiltinPlugin.js";

/** 全部内建 Plugin 配置定义；配置属于 Binding，不属于 Runtime Plugin 对象。 */
export const CITY_BUILTIN_PLUGIN_CONFIGS: readonly CityBuiltinPluginConfigDefinition[] = [
  { plugin_name: "skill", default_config: {} },
  { plugin_name: "web", default_config: {} },
  { plugin_name: "workboard", default_config: {} },
  {
    plugin_name: "chat",
    default_config: {},
    config_schema: {
      type: "object",
      properties: {
        queue: { type: "object" },
        channels: { type: "object" },
      },
    },
  },
  { plugin_name: "contact", default_config: {} },
  { plugin_name: "task", default_config: {} },
  { plugin_name: "memory", default_config: {} },
  { plugin_name: "image", default_config: {} },
  { plugin_name: "sound", default_config: {} },
];

/** 按名称读取内建 Plugin 配置定义。 */
export function get_builtin_plugin_config(
  plugin_name: string,
): CityBuiltinPluginConfigDefinition | null {
  return CITY_BUILTIN_PLUGIN_CONFIGS.find((item) => item.plugin_name === plugin_name) ?? null;
}
