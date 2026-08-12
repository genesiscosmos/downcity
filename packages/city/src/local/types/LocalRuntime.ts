/**
 * LocalCityStore 运行时装配类型。
 *
 * 这些类型描述宿主注入的模型解析能力和本地 Plugin constructor，不包含持久化记录。
 */

import type { AgentModel, JsonObject, Plugin } from "@downcity/agent";
import type {
  LocalPluginManifest,
  LocalPluginResourceItem,
} from "@/local/types/LocalPlugin.js";
import type { LocalCityStoreOptions } from "@/local/types/LocalCity.js";

/** LocalCityStore 构造参数。 */
export interface LocalCityStoreRuntimeOptions extends LocalCityStoreOptions {
  /** 覆盖默认 Embassy AI 模型创建逻辑的宿主模型解析器。 */
  model_resolver?: LocalModelResolver;
}

/** 本地 Store 根据模型 ID 和完整环境创建可执行模型的能力。 */
export type LocalModelResolver = (
  /** Agent 持久化配置中记录的模型 ID。 */
  model_id: string,
  /** 当前 Agent 与 Workspace 合并后的完整环境变量。 */
  env: NodeJS.ProcessEnv,
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
