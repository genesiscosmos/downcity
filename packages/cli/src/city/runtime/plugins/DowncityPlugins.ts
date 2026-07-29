/**
 * Downcity 内建 Plugin constructor 数组。
 *
 * 关键点（中文）
 * - 每个 constructor 自带静态 Manifest，CLI 与第三方 Plugin 使用同一索引和实例化逻辑。
 * - Chat 的静态 Resource Resolver 与运行期 Resource 消费都由 Chat adapter 表达。
 * - City 专属依赖通过 constructor 闭包注入，不进入第三方 Plugin 公共初始化参数。
 */

import {
  ChatPlugin,
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  CHAT_PLUGIN_RESOURCE_JSON_SCHEMA,
  FeishuChannel,
  QqChannel,
  TelegramChannel,
  parse_chat_plugin_config,
  parse_chat_plugin_resource,
  resolve_chat_plugin_resource,
  type ChatPluginResource,
} from "@downcity/plugins/chat";
import { ContactPlugin } from "@downcity/plugins/contact";
import {
  ImagePlugin,
  type ImagePluginModel,
  type ImagePluginResolvedInput,
} from "@downcity/plugins/image";
import { MemoryPlugin } from "@downcity/plugins/memory";
import { SkillPlugin } from "@downcity/plugins/skill";
import {
  SoundPlugin,
  type SoundPluginAsrInput,
  type SoundPluginModel,
  type SoundPluginTtsInput,
} from "@downcity/plugins/sound";
import { TaskPlugin } from "@downcity/plugins/task";
import { WebPlugin } from "@downcity/plugins/web";
import { WorkboardPlugin } from "@downcity/plugins/workboard";
import { CityUserManager } from "@/city/shared/CityUserManager.js";
import type {
  PluginInitializationInput,
  PluginManifest,
  PluginType,
} from "@/city/types/plugin/PluginInstallation.js";
import type { PluginResourceResolver } from "@/city/types/plugin/PluginResource.js";

const city_user_manager = new CityUserManager();

const skill_manifest: PluginManifest = {
  name: "skill",
  title: "Skill Catalog And Loader",
  description: "Lists and reads local skills, and injects discovery guidance.",
};

const web_manifest: PluginManifest = {
  name: "web",
  title: "Web Methodology",
  description: "Injects web research and browser-use methodology for Agents.",
};

const workboard_manifest: PluginManifest = {
  name: "workboard",
  title: "Workboard Snapshot",
  description: "Collects structured Agent runtime activity snapshots.",
};

const chat_manifest: PluginManifest = {
  name: "chat",
  title: "Chat",
  description: "Connects Agents to Telegram, Feishu, and QQ channels.",
  config: { schema: CHAT_PLUGIN_CONFIG_JSON_SCHEMA, defaults: {} },
  resources: { schema: CHAT_PLUGIN_RESOURCE_JSON_SCHEMA },
};

const contact_manifest: PluginManifest = {
  name: "contact",
  title: "Contact",
  description: "Manages trusted relationships and exchanges with remote Agents.",
};

const task_manifest: PluginManifest = {
  name: "task",
  title: "Task",
  description: "Manages reusable tasks and their trigger runtime.",
};

const memory_manifest: PluginManifest = {
  name: "memory",
  title: "Memory",
  description: "Stores, searches, and revises Agent memories.",
};

const image_manifest: PluginManifest = {
  name: "image",
  title: "Image",
  description: "Discovers image models, generates images, and reads results.",
};

const sound_manifest: PluginManifest = {
  name: "sound",
  title: "Sound",
  description: "Discovers speech models and provides ASR and TTS.",
};

class CitySkillPlugin extends SkillPlugin {
  static readonly manifest = skill_manifest;
  constructor(_input: PluginInitializationInput) { super(); }
}

class CityWebPlugin extends WebPlugin {
  static readonly manifest = web_manifest;
  constructor(_input: PluginInitializationInput) { super(); }
}

class CityWorkboardPlugin extends WorkboardPlugin {
  static readonly manifest = workboard_manifest;
  constructor(_input: PluginInitializationInput) { super(); }
}

class CityChatPlugin extends ChatPlugin {
  static readonly manifest = chat_manifest;
  static readonly resolve_resource: PluginResourceResolver = async ({ resource }) =>
    await resolve_chat_plugin_resource(resource);

  constructor(input: PluginInitializationInput) {
    const config = parse_chat_plugin_config(input.config);
    const resources = input.resources.map(parse_chat_plugin_resource);
    super({ queue: config.queue, channels: create_chat_channels(resources) });
  }
}

class CityTaskPlugin extends TaskPlugin {
  static readonly manifest = task_manifest;
  constructor(_input: PluginInitializationInput) { super(); }
}

class CityMemoryPlugin extends MemoryPlugin {
  static readonly manifest = memory_manifest;
  constructor(_input: PluginInitializationInput) { super(); }
}

/** 创建当前 City Runtime 可直接由 CLI 实例化的内建 Plugin 类型。 */
export function create_downcity_plugin_types(input: {
  /** 宿主显式注入的环境变量。 */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;

  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;

  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
} = {}): PluginType[] {
  let city_promise: ReturnType<CityUserManager["createUserClient"]> | undefined;
  const get_city = async () => {
    city_promise ??= city_user_manager.createUserClient({ env: input.env ?? process.env });
    return (await city_promise).city;
  };

  class CityContactPlugin extends ContactPlugin {
    static readonly manifest = contact_manifest;
    constructor(_plugin_input: PluginInitializationInput) {
      super({ host: input.host, port: input.port });
    }
  }

  class CityImagePlugin extends ImagePlugin {
    static readonly manifest = image_manifest;
    constructor(_plugin_input: PluginInitializationInput) {
      super({
        list_models: async () => {
          const city = await get_city();
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
        image_create: async (image_input: ImagePluginResolvedInput) => {
          const city = await get_city();
          return await city.ai.image_create({
            ...image_input,
            model: require_model_id(image_input, "image_create"),
          });
        },
        image_result: async (image_input) => {
          const city = await get_city();
          return await city.ai.image_result(image_input);
        },
      });
    }
  }

  class CitySoundPlugin extends SoundPlugin {
    static readonly manifest = sound_manifest;
    constructor(_plugin_input: PluginInitializationInput) {
      super({
        list_models: async () => {
          const city = await get_city();
          const catalog = await city.ai.catalog();
          return catalog.all()
            .filter((model) => model.modalities.includes("asr") || model.modalities.includes("tts"))
            .map((model): SoundPluginModel => ({
              id: model.id,
              name: model.name,
              description: model.description,
              modalities: model.modalities,
              tags: model.tags,
              meta: JSON.parse(JSON.stringify(model.meta ?? {})),
            }));
        },
        asr: async (asr_input: SoundPluginAsrInput) => {
          const city = await get_city();
          return await city.ai.asr({
            ...asr_input,
            model: require_model_id(asr_input, "asr"),
          });
        },
        tts: async (tts_input: SoundPluginTtsInput) => {
          const city = await get_city();
          return await city.ai.tts({
            ...tts_input,
            model: require_model_id(tts_input, "tts"),
          });
        },
      });
    }
  }

  return [
    CitySkillPlugin,
    CityWebPlugin,
    CityWorkboardPlugin,
    CityChatPlugin,
    CityContactPlugin,
    CityTaskPlugin,
    CityMemoryPlugin,
    CityImagePlugin,
    CitySoundPlugin,
  ];
}

/** 把已解析 Chat Resource Item 转换为 Chat 运行对象。 */
function create_chat_channels(resources: ChatPluginResource[]) {
  const resource_types = new Set<string>();
  return resources.map((resource) => {
    if (resource_types.has(resource.type)) {
      throw new Error(`Chat Plugin Resource type is duplicated: ${resource.type}`);
    }
    resource_types.add(resource.type);
    if (resource.type === "telegram") {
      return new TelegramChannel({
        id: resource.id,
        name: resource.name,
        bot_token: resource.bot_token,
      });
    }
    if (resource.type === "feishu") {
      return new FeishuChannel({
        id: resource.id,
        name: resource.name,
        app_id: resource.app_id,
        app_secret: resource.app_secret,
        domain: resource.domain,
      });
    }
    return new QqChannel({
      id: resource.id,
      name: resource.name,
      app_id: resource.app_id,
      app_secret: resource.app_secret,
      sandbox: resource.sandbox,
    });
  });
}

/** 读取 AI Service 调用必须显式提供的模型 ID。 */
function require_model_id(input: unknown, capability: string): string {
  const record = input && typeof input === "object" ? input as { model?: unknown } : {};
  const model_id = typeof record.model === "string" ? record.model.trim() : "";
  if (!model_id) throw new TypeError(`${capability} requires model id`);
  return model_id;
}
