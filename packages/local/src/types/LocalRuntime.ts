/**
 * 本地 Plugin 加载类型。
 *
 * 这些类型描述 Plugin constructor、Resource 解析与安装入口，不负责 Agent 装配。
 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type {
  LocalPluginManifest,
  LocalPluginResourceItem,
} from "@/types/LocalPlugin.js";
import type { PluginRepository } from "@/repositories/PluginRepository.js";

/** 本地 Plugin Loader 构造参数。 */
export interface LocalPluginLoaderOptions {
  /** Downcity 用户级数据根目录；默认使用 `~/.downcity`。 */
  root_path?: string;

  /** Plugin 运行时读取 Resource 与 Installation 使用的仓储。 */
  plugin_repository: PluginRepository;

  /** 当前宿主提供的官方或应用级 Plugin constructor。 */
  plugin_types?: readonly LocalPluginType[];
}

/** 本地 Plugin constructor 的统一输入。 */
export interface LocalPluginConstructorInput {
  /** 当前 Agent 对该 Plugin 的完整绑定配置。 */
  config: JsonObject;
  /** 当前绑定引用并完成解析的全部 Plugin Resource。 */
  resources: LocalPluginResourceItem[];
}

/** 本地 Plugin Resource 解析器输入。 */
export interface LocalPluginResourceResolverInput {
  /** Plugin 定义的待解析 Resource 输入。 */
  resource: JsonObject;
}

/** Plugin constructor 与静态 Manifest 的本地统一协议。 */
export interface LocalPluginType {
  /** 根据绑定配置和已解析 Resource 创建 Plugin 实例。 */
  new(input: LocalPluginConstructorInput): Plugin;
  /** Plugin 的静态 Manifest。 */
  readonly manifest: LocalPluginManifest;
  /** 创建或刷新 Resource 时使用的可选解析能力。 */
  readonly resolve_resource?: (
    input: LocalPluginResourceResolverInput,
  ) => Promise<JsonObject> | JsonObject;
}
