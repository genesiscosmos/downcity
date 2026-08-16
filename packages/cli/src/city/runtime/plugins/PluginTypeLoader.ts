/**
 * CLI Plugin constructor 加载入口。
 *
 * 内建类型、第三方制品路径、静态 Manifest 快照和入口导出校验由本地产品层负责；
 * CLI 只投影自己的 Plugin 类型协议。
 */

import type { PluginType } from "@/city/types/plugin/PluginDefinition.js";
import { create_cli_plugin_loader } from "@/city/runtime/AgentAssembly.js";
import { getPlatformRootDirPath } from "@/city/process/registry/CityPaths.js";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";

/** 加载内建 Plugin 时可用的 CLI 宿主依赖。 */
export interface PluginTypeLoadContext {
  /** 宿主显式注入的环境变量。 */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;
  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
}

/** 按稳定 ID 加载一个 Plugin constructor。 */
export async function load_plugin_type(
  plugin_id: string,
  context: PluginTypeLoadContext = {},
): Promise<PluginType> {
  const root_path = getPlatformRootDirPath();
  const data = create_cli_local_data(root_path);
  const plugin_loader = create_cli_plugin_loader({
    root_path,
    plugin_repository: data.plugins,
    host: context.host,
    port: context.port,
  });
  try {
    const plugin_type = await plugin_loader.load_plugin_type(plugin_id);
    if (!plugin_type) throw new Error(`Plugin constructor not found: ${plugin_id}`);
    return plugin_type as PluginType;
  } finally {
    data.database.close();
  }
}
