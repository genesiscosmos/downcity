/**
 * CLI 本地 CityEnvironment 组合入口。
 *
 * CLI 在这里把 Embassy 用户 AI 能力和官方 Plugin 注入 `@downcity/city`，Store 与
 * City 核心均不依赖 Federation 或具体 Plugin。
 */

import {
  LocalCityEnvironment,
  type LocalCityDataSource,
  resolve_local_root_path,
  type LocalPluginType,
} from "@downcity/city";
import {
  create_builtin_plugin_types,
  type BuiltinPluginAi,
} from "@downcity/plugins";
import { EmbassySessionResolver } from "@/city/shared/EmbassySessionResolver.js";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";

/** 创建 CLI 与 Desktop 可共享语义的官方 Plugin constructor 集合。 */
export function create_cli_builtin_plugin_types(input: {
  /** Downcity 用户级数据根目录。 */
  root_path?: string;
  /** Contact Plugin 报告的 HTTP 地址。 */
  host?: string;
  /** Contact Plugin 报告的 HTTP 端口。 */
  port?: number;
} = {}): LocalPluginType[] {
  const resolver = new EmbassySessionResolver();
  return create_builtin_plugin_types({
    platform_root_path: resolve_local_root_path(input.root_path),
    contact_http: { host: input.host, port: input.port },
    resolve_ai: async () => await create_builtin_plugin_ai(resolver),
  }) as LocalPluginType[];
}

/** 创建 CLI 进程使用的本地 CityEnvironment。 */
export function create_cli_city_environment(input: {
  /** Downcity 用户级数据根目录。 */
  root_path?: string;
  /** Contact Plugin 报告的 HTTP 地址。 */
  host?: string;
  /** Contact Plugin 报告的 HTTP 端口。 */
  port?: number;
  /** 当前 CLI City 使用的本地只读配置数据源。 */
  data_source?: LocalCityDataSource;
} = {}): LocalCityEnvironment {
  return new LocalCityEnvironment({
    root_path: input.root_path,
    data_source: input.data_source,
    plugin_types: create_cli_builtin_plugin_types(input),
    model_resolver: async (model_id, env) => await createCityAiAgentModel({
      modelId: model_id,
      env: { ...env },
    }),
  });
}

/** 把 Embassy User AI 子域投影为官方 Plugin 的最小协议。 */
async function create_builtin_plugin_ai(
  resolver: EmbassySessionResolver,
): Promise<BuiltinPluginAi> {
  const { embassy_user } = await resolver.create_user_client();
  return {
    async list_models() {
      const catalog = await embassy_user.ai.catalog();
      return { items: catalog.all().map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        modalities: [...model.modalities],
        tags: model.tags ? [...model.tags] : undefined,
        meta: JSON.parse(JSON.stringify(model.meta ?? {})),
      })) };
    },
    async image_create(input) {
      return await embassy_user.ai.image_create({
        ...input,
        model: require_model(input, "image_create"),
      });
    },
    async image_result(input) {
      return await embassy_user.ai.image_result(input);
    },
    async asr(input) {
      return await embassy_user.ai.asr({ ...input, model: require_model(input, "asr") });
    },
    async tts(input) {
      return await embassy_user.ai.tts({ ...input, model: require_model(input, "tts") });
    },
  };
}

/** 从 Plugin 输入中读取必填模型 ID。 */
function require_model(input: unknown, capability: string): string {
  const model = input && typeof input === "object"
    ? (input as { model?: unknown }).model
    : undefined;
  const model_id = typeof model === "string" ? model.trim() : "";
  if (!model_id) throw new TypeError(`${capability} requires model id`);
  return model_id;
}
