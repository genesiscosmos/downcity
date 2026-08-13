/**
 * Desktop 本地 CityEnvironment 组合入口。
 *
 * Electron main 在这里把共享 Store 中的 Embassy 登录态、Federation 模型和官方
 * Plugin 注入 City。该模块不依赖 CLI，也不创建或持有 Agent。
 */

import {
  LocalCityEnvironment,
  resolve_local_root_path,
  type LocalCityStore,
  type LocalPluginType,
} from "@downcity/city";
import { Embassy, type EmbassyUser } from "@downcity/federation";
import {
  create_builtin_plugin_types,
  type BuiltinPluginAi,
} from "@downcity/plugins";

const default_federation_url = "https://base.downcity.ai";

/** Desktop 读取的最小 Embassy 用户 Session。 */
interface DesktopEmbassySession {
  /** Session 所属 Federation URL。 */
  federation_url: string;
  /** Federation 签发的用户 Token。 */
  user_token: string;
}

/** 共享安全配置中与 Desktop 身份恢复有关的最小投影。 */
interface DesktopDowncityConfig {
  /** 当前选中的 Federation URL。 */
  selected_federation_url?: string;
  /** 按 Federation URL 索引的用户 Session。 */
  sessions?: Record<string, DesktopEmbassySession>;
}

/** 创建 Electron main 使用的本地 CityEnvironment。 */
export function create_desktop_city_environment(
  store: LocalCityStore,
): LocalCityEnvironment {
  return new LocalCityEnvironment({
    root_path: store.root_path,
    data_source: store,
    plugin_types: create_desktop_builtin_plugin_types(store),
    model_resolver: async (model_id, env) => {
      const user = create_embassy_user(store, env);
      const catalog = await user.ai.catalog();
      const model = catalog.get(model_id);
      if (!model || !model.modalities.some((item) => ["text", "stream", "openai"].includes(item))) {
        throw new Error(`Agent execution model not found in Federation: ${model_id}`);
      }
      return model;
    },
  });
}

/** 创建 Desktop 宿主提供的官方 Plugin constructor。 */
function create_desktop_builtin_plugin_types(store: LocalCityStore): LocalPluginType[] {
  return create_builtin_plugin_types({
    platform_root_path: resolve_local_root_path(store.root_path),
    resolve_ai: async () => create_builtin_plugin_ai(create_embassy_user(store, process.env)),
  }) as LocalPluginType[];
}

/** 把 Embassy User AI 子域投影成官方 Plugin 的最小协议。 */
function create_builtin_plugin_ai(user: EmbassyUser): BuiltinPluginAi {
  return {
    async list_models() {
      const catalog = await user.ai.catalog();
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
      return await user.ai.image_create({
        ...input,
        model: require_model(input, "image_create"),
      });
    },
    async image_result(input) {
      return await user.ai.image_result(input);
    },
    async asr(input) {
      return await user.ai.asr({ ...input, model: require_model(input, "asr") });
    },
    async tts(input) {
      return await user.ai.tts({ ...input, model: require_model(input, "tts") });
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

/** 按环境覆盖和共享持久化 Session 创建 Embassy User。 */
function create_embassy_user(
  store: LocalCityStore,
  env: Readonly<Record<string, string | undefined>>,
): EmbassyUser {
  const config = store.get_secure_setting<DesktopDowncityConfig>("downcity.config") ?? {};
  const federation_url = normalize_federation_url(
    read_string(env.DOWNCITY_FEDERATION_URL)
      || read_string(config.selected_federation_url)
      || default_federation_url,
  );
  const session = config.sessions?.[federation_url];
  const user_token = read_string(env.DOWNCITY_USER_TOKEN) || read_string(session?.user_token);
  if (!user_token) {
    throw new Error("Federation user token is required. Run `city federation login` first.");
  }
  return new Embassy({ federation_url, user_token }).user;
}

/** 规范化 Federation URL，并保留本机默认端口规则。 */
function normalize_federation_url(value: string): string {
  const raw = read_string(value);
  const has_protocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
  const is_local = raw.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/u.test(raw);
  const url = new URL(has_protocol ? raw : `${is_local ? "http" : "https"}://${raw}`);
  if (!url.port && (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname))) {
    url.port = "43127";
  }
  return url.toString().replace(/\/+$/u, "");
}

/** 读取可选字符串。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
