/** 本地 Plugin constructor 与加载协议。 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type { LocalPluginManifest } from "@/types/LocalPlugin.js";
import type { PluginRepository } from "@/repositories/PluginRepository.js";

/** 本地 Plugin Loader 构造参数。 */
export interface LocalPluginLoaderOptions {
  /** Plugin 定义与 profile 使用的文件仓储。 */
  plugin_repository: PluginRepository;
  /** 当前宿主提供的官方或应用级 Plugin constructor。 */
  plugin_types?: readonly LocalPluginType[];
}

/** 本地 Plugin constructor 的统一输入。 */
export interface LocalPluginConstructorInput {
  /** 当前 Agent 选中的完整 Plugin profile。 */
  config: JsonObject;
}

/** Plugin constructor 与静态 Manifest 的本地统一协议。 */
export interface LocalPluginType {
  /** 根据已校验 profile 创建 Plugin 实例。 */
  new(input: LocalPluginConstructorInput): Plugin;
  /** Plugin 的静态 Manifest。 */
  readonly manifest: LocalPluginManifest;
}
