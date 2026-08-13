/**
 * 本地 CityEnvironment 运行时装配类型。
 *
 * 这些类型描述宿主注入的模型解析能力和本地 Plugin constructor，不包含持久化记录。
 */

import type { AgentModel, JsonObject, Plugin } from "@downcity/agent";
import type {
  LocalPluginManifest,
  LocalPluginResourceItem,
} from "@/local/types/LocalPlugin.js";
import type { LocalCityDataSource } from "@/local/types/LocalCityDataSource.js";

/** LocalCityEnvironment 构造参数。 */
export interface LocalCityEnvironmentOptions {
  /** Downcity 用户级数据根目录；默认使用 `~/.downcity`。 */
  root_path?: string;

  /** Plugin 运行时装配使用的只读持久化数据源。 */
  data_source?: LocalCityDataSource;

  /** 根据模型 ID 创建运行时模型的宿主能力。 */
  model_resolver?: LocalModelResolver;

  /** 当前宿主提供的官方或应用级 Plugin constructor。 */
  plugin_types?: readonly LocalPluginType[];
}

/** 本地 Environment 根据模型 ID 和完整环境创建可执行模型的能力。 */
export type LocalModelResolver = (
  /** Agent 产品配置中记录的模型 ID。 */
  model_id: string,
  /** 当前 Agent 与 Workspace 合并后的完整环境变量。 */
  env: Readonly<Record<string, string>>,
) => Promise<AgentModel>;

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
