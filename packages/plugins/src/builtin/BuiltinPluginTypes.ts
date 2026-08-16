/**
 * Downcity 官方 Plugin 注册集合。
 *
 * 本模块负责把官方 Plugin 组合成统一 definition + factory 协议。它不依赖 City、Embassy 或
 * Federation，只消费宿主提供的 AI 能力和本地路径。
 */

import path from "node:path";
import type { JsonObject, Plugin } from "@downcity/agent";
import {
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  ChatPlugin,
  type ChatPluginConfig,
  type ChatPluginChannelConfig,
} from "@/chat.js";
import { FeishuChannel, QqChannel, TelegramChannel } from "@/chat.js";
import { ContactPlugin } from "@/contact.js";
import {
  ImagePlugin,
  type ImagePluginJobCreateResult,
  type ImagePluginJobResult,
  type ImagePluginJobResultInput,
  type ImagePluginModel,
  type ImagePluginResolvedInput,
} from "@/image.js";
import {
  BuiltinMemoryProvider,
  FileMemoryStorageAdapter,
  MemoryPlugin,
  get_default_file_memory_root_path,
} from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import {
  SoundPlugin,
  type SoundPluginAsrInput,
  type SoundPluginAsrResult,
  type SoundPluginModel,
  type SoundPluginTtsInput,
  type SoundPluginTtsResult,
} from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { PlaywrightBrowserProvider, WebPlugin } from "@/web.js";
import { WorkboardPlugin } from "@/workboard.js";
import type {
  BuiltinMemoryPluginConfig,
  BuiltinWebPluginConfig,
} from "@/builtin/types/BuiltinPluginConfig.js";

/** 官方 Plugin definition 的最小结构协议。 */
export interface BuiltinPluginDefinition {
  /** Plugin 的稳定 ID。 */
  id: string;

  /** Plugin 的用户可见标题。 */
  title: string;

  /** Plugin 的用途说明。 */
  description: string;
  /** Plugin profile 的可选 JSON Schema 与默认配置。 */
  config?: {
    /** 校验 profile 并驱动管理表单的完整 JSON Schema。 */
    schema: JsonObject;
    /** `default` profile 不存在时使用的完整默认配置。 */
    defaults?: JsonObject;
  };
}

/** 官方 Plugin factory 的统一输入。 */
export interface BuiltinPluginCreateInput {
  /** 当前 Agent 对 Plugin 的已校验完整配置。 */
  config: JsonObject;

}

/** 官方 Plugin 注册协议。 */
export interface BuiltinPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  readonly definition: BuiltinPluginDefinition;
  /** 创建一个 Agent 独享的 Plugin 实例。 */
  create(input: BuiltinPluginCreateInput): Plugin;
}

/** Image 和 Sound Plugin 使用的宿主 AI 能力。 */
export interface BuiltinPluginAi {
  /** 列出当前用户可使用的图片、ASR 与 TTS 模型。 */
  list_models(): Promise<{
    /** 完整模型集合。 */
    items: Array<{
      /** 模型的全局稳定 ID。 */
      id: string;
      /** 模型的用户可见名称。 */
      name: string;
      /** 模型用途说明。 */
      description?: string;
      /** 模型支持的能力集合。 */
      modalities: string[];
      /** 模型筛选标签。 */
      tags?: string[];
      /** 模型扩展元数据。 */
      meta?: JsonObject;
    }>;
  }>;

  /** 创建图片生成任务。 */
  image_create(input: ImagePluginResolvedInput): Promise<ImagePluginJobCreateResult>;

  /** 查询图片生成结果。 */
  image_result(input: ImagePluginJobResultInput): Promise<ImagePluginJobResult>;

  /** 执行音频转写。 */
  asr(input: SoundPluginAsrInput): Promise<SoundPluginAsrResult>;

  /** 执行语音合成。 */
  tts(input: SoundPluginTtsInput): Promise<SoundPluginTtsResult>;
}

/** 创建官方 Plugin 注册集合所需的宿主能力。 */
export interface BuiltinPluginRegistrationsOptions {
  /** `~/.downcity` 等用户级数据根目录。 */
  platform_root_path: string;

  /** Contact Plugin 对外报告的 HTTP 地址。 */
  contact_http?: {
    /** HTTP 监听地址。 */
    host?: string;
    /** HTTP 监听端口。 */
    port?: number;
  };

  /** 延迟获取当前用户 AI 能力；只有对应 Action 执行时才调用。 */
  resolve_ai?: () => Promise<BuiltinPluginAi>;
}

const memory_plugin_config_schema: JsonObject = {
  type: "object",
  title: "Memory Plugin",
  description: "Long-term memory provider and storage configuration.",
  properties: {
    provider: { type: "string", const: "builtin" },
    storage: { type: "string", const: "file" },
    root_path: { type: "string", minLength: 1 },
  },
  required: ["provider", "storage"],
  additionalProperties: false,
};

const web_plugin_config_schema: JsonObject = {
  type: "object",
  title: "Web Plugin",
  description: "Browser connection and observation configuration.",
  properties: {
    cdp_url: { type: "string", minLength: 1 },
    default_url: { type: "string", minLength: 1 },
    timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 },
    max_observation_chars: { type: "integer", minimum: 1, maximum: 100000 },
  },
  required: ["cdp_url"],
  additionalProperties: false,
};

/** 创建 Downcity 官方 Plugin 注册集合。 */
export function create_builtin_plugin_registrations(
  options: BuiltinPluginRegistrationsOptions,
): BuiltinPluginRegistration[] {
  const platform_root_path = path.resolve(options.platform_root_path);
  return [
    simple_registration(
      "skill",
      "Skill Catalog And Loader",
      "Lists and reads local skills, and injects discovery guidance.",
      () => new SkillPlugin(),
    ),
    simple_registration(
      "workboard",
      "Workboard Snapshot",
      "Collects structured Agent runtime activity snapshots.",
      () => new WorkboardPlugin(),
    ),
    simple_registration(
      "contact",
      "Contact",
      "Manages trusted relationships and exchanges with remote Agents.",
      () => new ContactPlugin({
        host: options.contact_http?.host,
        port: options.contact_http?.port,
      }),
    ),
    simple_registration(
      "task",
      "Task",
      "Manages reusable tasks and their trigger runtime.",
      () => new TaskPlugin(),
    ),
    {
      definition: {
        id: "chat",
        title: "Chat",
        description: "Connects Agents to Telegram, Feishu, and QQ channels.",
        config: {
          schema: CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
          defaults: {},
        },
      },
      create(input) {
        const config = input.config as unknown as ChatPluginConfig;
        return new ChatPlugin({
          queue: config.queue,
          channels: create_chat_channels(config.channels ?? []),
        });
      },
    },
    {
      definition: {
        id: "memory",
        title: "Memory",
        description: "Provides provider-neutral long-term memory, recall, revision, and deletion.",
        config: {
          schema: memory_plugin_config_schema,
          defaults: { provider: "builtin", storage: "file" },
        },
      },
      create(input) {
        const config = input.config as unknown as BuiltinMemoryPluginConfig;
        const root_path = config.root_path;
        if (root_path && !path.isAbsolute(root_path)) {
          throw new Error("Memory Plugin root_path must be absolute");
        }
        return new MemoryPlugin({
          provider: new BuiltinMemoryProvider({
            create_storage: ({ agent_id }) => new FileMemoryStorageAdapter({
              root_path: root_path || get_default_file_memory_root_path({
                platform_root_path,
                agent_id,
              }),
            }),
          }),
        });
      },
    },
    {
      definition: {
        id: "web",
        title: "Web",
        description: "Provides structured browser sessions through a configured CDP endpoint.",
        config: { schema: web_plugin_config_schema },
      },
      create(input) {
        const config = input.config as unknown as BuiltinWebPluginConfig;
        return new WebPlugin({
          browser: new PlaywrightBrowserProvider({
            cdp_url: config.cdp_url,
            ...(config.default_url ? { default_url: config.default_url } : {}),
            ...(config.timeout_ms !== undefined ? { timeout_ms: config.timeout_ms } : {}),
            ...(config.max_observation_chars !== undefined
              ? { max_observation_chars: config.max_observation_chars }
              : {}),
          }),
        });
      },
    },
    simple_registration(
      "image",
      "Image",
      "Discovers image models, generates images, and reads results.",
      () => new ImagePlugin({
        list_models: async () => filter_image_models(await require_ai(options)),
        image_create: async (input) => await (await require_ai(options)).image_create(input),
        image_result: async (input) => await (await require_ai(options)).image_result(input),
      }),
    ),
    simple_registration(
      "sound",
      "Sound",
      "Discovers speech models and provides ASR and TTS.",
      () => new SoundPlugin({
        list_models: async () => filter_sound_models(await require_ai(options)),
        asr: async (input) => await (await require_ai(options)).asr(input),
        tts: async (input) => await (await require_ai(options)).tts(input),
      }),
    ),
  ];
}

/** 创建没有配置协议的简单注册。 */
function simple_registration(
  id: string,
  title: string,
  description: string,
  create: () => Plugin,
): BuiltinPluginRegistration {
  return { definition: { id, title, description }, create };
}

/** 创建 Chat Resource 对应的运行渠道。 */
function create_chat_channels(configs: ChatPluginChannelConfig[]) {
  const channel_types = new Set<string>();
  return configs.map((config) => {
    if (channel_types.has(config.type)) {
      throw new Error(`Chat Plugin channel type is duplicated: ${config.type}`);
    }
    channel_types.add(config.type);
    if (config.type === "telegram") {
      return new TelegramChannel({
        id: config.id,
        name: config.name,
        bot_token: config.bot_token,
      });
    }
    if (config.type === "feishu") {
      return new FeishuChannel({
        id: config.id,
        name: config.name,
        app_id: config.app_id,
        app_secret: config.app_secret,
        domain: config.domain,
      });
    }
    return new QqChannel({
      id: config.id,
      name: config.name,
      app_id: config.app_id,
      app_secret: config.app_secret,
      sandbox: config.sandbox,
    });
  });
}

/** 读取宿主 AI 能力，缺失时给出明确错误。 */
async function require_ai(options: BuiltinPluginRegistrationsOptions): Promise<BuiltinPluginAi> {
  if (!options.resolve_ai) {
    throw new Error("Official AI Plugin requires a signed-in Embassy user");
  }
  return await options.resolve_ai();
}

/** 从模型目录筛选图片模型。 */
async function filter_image_models(ai: BuiltinPluginAi): Promise<ImagePluginModel[]> {
  const catalog = await ai.list_models();
  return catalog.items
    .filter((model) => model.modalities.includes("image"))
    .map((model) => ({ ...model }));
}

/** 从模型目录筛选语音模型。 */
async function filter_sound_models(ai: BuiltinPluginAi): Promise<SoundPluginModel[]> {
  const catalog = await ai.list_models();
  return catalog.items
    .filter((model) => model.modalities.includes("asr") || model.modalities.includes("tts"))
    .map((model) => ({ ...model }));
}
