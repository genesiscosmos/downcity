/** 本地 Plugin 注册与加载协议。 */

import type { PluginRepository } from "@/repositories/PluginRepository.js";
import type { LocalPluginRegistration } from "@/types/LocalPlugin.js";

/** 本地 Plugin Loader 构造参数。 */
export interface LocalPluginLoaderOptions {
  /** Plugin 定义与 profile 使用的文件仓储。 */
  plugin_repository: PluginRepository;
  /** 当前宿主提供的内置或应用级 Plugin 注册。 */
  plugin_registrations?: readonly LocalPluginRegistration[];
}
