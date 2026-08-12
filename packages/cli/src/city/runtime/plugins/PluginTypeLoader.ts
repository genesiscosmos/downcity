/**
 * CLI Plugin constructor 加载入口。
 *
 * 内建类型、第三方制品路径、静态 Manifest 快照和入口导出校验全部由
 * `@downcity/city` 负责；CLI 只投影自己的 Plugin 类型协议。
 */

import { LocalCityStore } from "@downcity/city";
import type { PluginType } from "@/city/types/plugin/PluginInstallation.js";

/** 加载内建 Plugin 时可用的 CLI 宿主依赖。 */
export interface PluginTypeLoadContext {
  /** 宿主显式注入的环境变量。 */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;
  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
}

/** 加载指定 Plugin 所属入口导出的完整 constructor 数组。 */
export async function load_plugin_types(
  plugin_name: string,
  context: PluginTypeLoadContext = {},
): Promise<PluginType[]> {
  const store = new LocalCityStore({ host: context.host, port: context.port });
  try {
    return await store.load_plugin_types(plugin_name) as PluginType[];
  } finally {
    store.close();
  }
}

/** 按 Plugin 名称读取一个 constructor。 */
export async function load_plugin_type(
  plugin_name: string,
  context: PluginTypeLoadContext = {},
): Promise<PluginType> {
  const plugin_types = await load_plugin_types(plugin_name, context);
  const plugin_type = plugin_types.find((item) => item.manifest.name === plugin_name);
  if (!plugin_type) throw new Error(`Plugin constructor not found: ${plugin_name}`);
  return plugin_type;
}
