/**
 * CityBuiltinPlugins：City 宿主侧内建 plugin 装配。
 *
 * 关键点（中文）
 * - City 运行期直接 new 每个 plugin，所有 constructor 参数都由 City 宿主层注入。
 * - `@downcity/plugins` 只提供 plugin class，不参与 City 全局账号、City 登录态或运行配置解析。
 * - 静态 CLI catalog 使用同一套 City 装配入口，但不注入需要 City 登录态的 image/sound。
 */

import type { BasePlugin } from "@downcity/agent";
import type { DowncityConfig } from "@/city/types/config/DowncityConfig.js";
import {
  ChatPlugin,
  FeishuChannel,
  QqChannel,
  TelegramChannel,
} from "@downcity/plugins/chat";
import { ContactPlugin } from "@downcity/plugins/contact";
import { ImagePlugin } from "@downcity/plugins/image";
import { MemoryPlugin } from "@downcity/plugins/memory";
import { SkillPlugin } from "@downcity/plugins/skill";
import { SoundPlugin } from "@downcity/plugins/sound";
import { TaskPlugin } from "@downcity/plugins/task";
import { WebPlugin } from "@downcity/plugins/web";
import { WorkboardPlugin } from "@downcity/plugins/workboard";
import type {
  ImagePluginModel,
  ImagePluginResolvedInput,
} from "@downcity/plugins/image";
import type {
  SoundPluginAsrInput,
  SoundPluginModel,
  SoundPluginTtsInput,
} from "@downcity/plugins/sound";
import { CityUserManager } from "@/city/shared/CityUserManager.js";
import { CityChatAccountStore } from "@/city/runtime/plugins/CityChatAccountStore.js";

const city_user_manager = new CityUserManager();

/**
 * 读取 AIService 调用必须显式提供的模型 ID。
 */
function require_model_id(input: unknown, capability: string): string {
  const record = input && typeof input === "object"
    ? input as { model?: unknown }
    : {};
  const model_id = typeof record.model === "string" ? record.model.trim() : "";
  if (!model_id) {
    throw new TypeError(`${capability} requires model id`);
  }
  return model_id;
}

/**
 * 创建 City 注入给 ChatPlugin 的 channel 实例。
 */
function create_city_chat_channels(config?: DowncityConfig) {
  const channels = config?.plugins?.chat?.channels;
  const telegram = channels?.telegram;
  const feishu = channels?.feishu;
  const qq = channels?.qq;

  return [
    new TelegramChannel({
      enabled: telegram?.enabled === true,
      channelAccountId: telegram?.channelAccountId,
    }),
    new FeishuChannel({
      enabled: feishu?.enabled === true,
      channelAccountId: feishu?.channelAccountId,
    }),
    new QqChannel({
      enabled: qq?.enabled === true,
      channelAccountId: qq?.channelAccountId,
    }),
  ];
}

/**
 * 创建不依赖 City 登录态的 City 内建 plugin 集合。
 *
 * 关键点（中文）：该集合用于 CLI catalog 与 agent runtime 的公共基础部分，保持所有 plugin 都走 constructor。
 */
export function createCityStaticBuiltinPlugins(input: {
  /**
   * 当前 Agent 配置；未提供时所有 chat channel 保持禁用。
   */
  config?: DowncityConfig;
  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;
  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
} = {}): BasePlugin[] {
  return [
    new SkillPlugin(),
    new WebPlugin(),
    new WorkboardPlugin(),
    new ChatPlugin({
      account_store: new CityChatAccountStore(),
      queue: input.config?.plugins?.chat?.queue,
      channels: create_city_chat_channels(input.config),
    }),
    new ContactPlugin({
      host: input.host ?? input.config?.start?.host,
      port: input.port ?? input.config?.start?.port,
    }),
    new TaskPlugin(),
    new MemoryPlugin(),
  ];
}

/**
 * 创建 City agent 运行期应启用的完整内建 plugin 集合。
 */
export async function createCityBuiltinPlugins(input: {
  /**
   * 宿主显式注入的 env，用于支持 DOWNCITY_CITY_* 覆盖项。
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * 当前运行 Agent 从全局 DB 读取的配置。
   */
  config: DowncityConfig;
  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;
  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
}): Promise<BasePlugin[]> {
  const { city } = await city_user_manager.createUserClient({
    env: input.env ?? process.env,
  });

  return [
    ...createCityStaticBuiltinPlugins({
      config: input.config,
      host: input.host,
      port: input.port,
    }),
    new ImagePlugin({
      list_models: async () => {
        const catalog = await city.ai.catalog();
        return catalog.forModality("image").map((model): ImagePluginModel => ({
          id: model.id,
          name: model.name,
          description: model.description,
          modalities: model.modalities,
          tags: model.tags,
          meta: JSON.parse(JSON.stringify(model.meta ?? {})),
        }));
      },
      image_create: async (image_input: ImagePluginResolvedInput) =>
        await city.ai.image_create({
          ...image_input,
          model: require_model_id(image_input, "image_create"),
        }),
      image_result: async (image_input) =>
        await city.ai.image_result(image_input),
    }),
    new SoundPlugin({
      list_models: async () => {
        const catalog = await city.ai.catalog();
        return catalog.all()
          .filter((model) =>
            model.modalities.includes("asr") || model.modalities.includes("tts")
          )
          .map((model): SoundPluginModel => ({
            id: model.id,
            name: model.name,
            description: model.description,
            modalities: model.modalities,
            tags: model.tags,
            meta: JSON.parse(JSON.stringify(model.meta ?? {})),
          }));
      },
      asr: async (asr_input: SoundPluginAsrInput) =>
        await city.ai.asr({
          ...asr_input,
          model: require_model_id(asr_input, "asr"),
        }),
      tts: async (tts_input: SoundPluginTtsInput) =>
        await city.ai.tts({
          ...tts_input,
          model: require_model_id(tts_input, "tts"),
        }),
    }),
  ];
}
