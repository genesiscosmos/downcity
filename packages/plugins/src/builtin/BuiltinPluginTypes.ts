/**
 * Downcity 官方 Plugin constructor 集合。
 *
 * 本模块负责把官方 Plugin 组合成统一 constructor 协议。它不依赖 City、Embassy 或
 * Federation，只消费宿主提供的 AI 能力和本地路径。
 */

import path from "node:path";
import type { JsonObject, Plugin } from "@downcity/agent";
import {
  ChatPlugin,
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  parse_chat_plugin_config,
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

/** 官方 Plugin manifest 的最小结构协议。 */
export interface BuiltinPluginManifest {
  /** Plugin 的稳定名称。 */
  name: string;

  /** Plugin 的用户可见标题。 */
  title: string;

  /** Plugin 的用途说明。 */
  description: string;

  /** Plugin 行为配置协议。 */
  config?: {
    /** 配置 JSON Schema。 */
    schema?: JsonObject;
    /** 默认配置。 */
    defaults?: JsonObject;
  };

}

/** 官方 Plugin constructor 的统一输入。 */
export interface BuiltinPluginConstructorInput {
  /** 当前 Agent 对 Plugin 的完整配置。 */
  config: JsonObject;

}

/** 官方 Plugin constructor 协议。 */
export interface BuiltinPluginType {
  /** 创建一个 Agent 独享的 Plugin 实例。 */
  new(input: BuiltinPluginConstructorInput): Plugin;

  /** Plugin 的静态 manifest。 */
  readonly manifest: BuiltinPluginManifest;

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

/** 创建官方 Plugin constructor 集合所需的宿主能力。 */
export interface BuiltinPluginTypesOptions {
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

/** 创建 Downcity 官方 Plugin constructor 集合。 */
export function create_builtin_plugin_types(
  options: BuiltinPluginTypesOptions,
): BuiltinPluginType[] {
  const platform_root_path = path.resolve(options.platform_root_path);

  class LocalSkillPlugin extends SkillPlugin {
    static readonly manifest = simple_manifest(
      "skill",
      "Skill Catalog And Loader",
      "Lists and reads local skills, and injects discovery guidance.",
    );
  }

  class LocalWorkboardPlugin extends WorkboardPlugin {
    static readonly manifest = simple_manifest(
      "workboard",
      "Workboard Snapshot",
      "Collects structured Agent runtime activity snapshots.",
    );
  }

  class LocalContactPlugin extends ContactPlugin {
    static readonly manifest = simple_manifest(
      "contact",
      "Contact",
      "Manages trusted relationships and exchanges with remote Agents.",
    );

    constructor() {
      super({
        host: options.contact_http?.host,
        port: options.contact_http?.port,
      });
    }
  }

  class LocalTaskPlugin extends TaskPlugin {
    static readonly manifest = simple_manifest(
      "task",
      "Task",
      "Manages reusable tasks and their trigger runtime.",
    );
  }

  class LocalChatPlugin extends ChatPlugin {
    static readonly manifest: BuiltinPluginManifest = {
      name: "chat",
      title: "Chat",
      description: "Connects Agents to Telegram, Feishu, and QQ channels.",
      config: { schema: CHAT_PLUGIN_CONFIG_JSON_SCHEMA, defaults: {} },
    };

    constructor(input: BuiltinPluginConstructorInput) {
      const config = parse_chat_plugin_config(input.config);
      super({ queue: config.queue, channels: create_chat_channels(config.channels ?? []) });
    }
  }

  class LocalMemoryPlugin extends MemoryPlugin {
    static readonly manifest: BuiltinPluginManifest = {
      name: "memory",
      title: "Memory",
      description: "Provides provider-neutral long-term memory, recall, revision, and deletion.",
      config: {
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "storage"],
          properties: {
            provider: { type: "string", const: "builtin" },
            storage: { type: "string", const: "file" },
            root_path: { type: "string", minLength: 1 },
          },
        },
        defaults: { provider: "builtin", storage: "file" },
      },
    };

    constructor(input: BuiltinPluginConstructorInput) {
      const provider = read_required_string(input.config, "provider", "Memory Plugin");
      const storage = read_required_string(input.config, "storage", "Memory Plugin");
      if (provider !== "builtin") throw new Error(`Unsupported Memory Provider: ${provider}`);
      if (storage !== "file") throw new Error(`Unsupported Memory Storage Adapter: ${storage}`);
      const root_path = read_optional_string(input.config, "root_path");
      if (root_path && !path.isAbsolute(root_path)) {
        throw new Error("Memory Plugin root_path must be absolute");
      }
      super({
        provider: new BuiltinMemoryProvider({
          create_storage: ({ agent_id }) => new FileMemoryStorageAdapter({
            root_path: root_path || get_default_file_memory_root_path({
              platform_root_path,
              agent_id,
            }),
          }),
        }),
      });
    }
  }

  class LocalWebPlugin extends WebPlugin {
    static readonly manifest: BuiltinPluginManifest = {
      name: "web",
      title: "Web",
      description: "Provides structured browser sessions through a configured CDP endpoint.",
      config: {
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["cdp_url"],
          properties: {
            cdp_url: { type: "string", minLength: 1 },
            default_url: { type: "string" },
            timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 },
            max_observation_chars: { type: "integer", minimum: 1, maximum: 100000 },
          },
        },
        defaults: {},
      },
    };

    constructor(input: BuiltinPluginConstructorInput) {
      const cdp_url = read_required_string(input.config, "cdp_url", "Web Plugin");
      const default_url = read_optional_string(input.config, "default_url");
      const timeout_ms = read_optional_number(input.config, "timeout_ms");
      const max_observation_chars = read_optional_number(input.config, "max_observation_chars");
      super({
        browser: new PlaywrightBrowserProvider({
          cdp_url,
          ...(default_url ? { default_url } : {}),
          ...(timeout_ms !== undefined ? { timeout_ms } : {}),
          ...(max_observation_chars !== undefined ? { max_observation_chars } : {}),
        }),
      });
    }
  }

  class LocalImagePlugin extends ImagePlugin {
    static readonly manifest = simple_manifest(
      "image",
      "Image",
      "Discovers image models, generates images, and reads results.",
    );

    constructor() {
      super({
        list_models: async () => filter_image_models(await require_ai(options)),
        image_create: async (input) => await (await require_ai(options)).image_create(input),
        image_result: async (input) => await (await require_ai(options)).image_result(input),
      });
    }
  }

  class LocalSoundPlugin extends SoundPlugin {
    static readonly manifest = simple_manifest(
      "sound",
      "Sound",
      "Discovers speech models and provides ASR and TTS.",
    );

    constructor() {
      super({
        list_models: async () => filter_sound_models(await require_ai(options)),
        asr: async (input) => await (await require_ai(options)).asr(input),
        tts: async (input) => await (await require_ai(options)).tts(input),
      });
    }
  }

  return [
    LocalSkillPlugin,
    LocalWorkboardPlugin,
    LocalContactPlugin,
    LocalTaskPlugin,
    LocalChatPlugin,
    LocalMemoryPlugin,
    LocalWebPlugin,
    LocalImagePlugin,
    LocalSoundPlugin,
  ] as unknown as BuiltinPluginType[];
}

/** 创建没有配置协议的简单 manifest。 */
function simple_manifest(
  name: string,
  title: string,
  description: string,
): BuiltinPluginManifest {
  return { name, title, description };
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
async function require_ai(options: BuiltinPluginTypesOptions): Promise<BuiltinPluginAi> {
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

/** 从 Plugin 配置读取必填字符串。 */
function read_required_string(config: JsonObject, key: string, owner: string): string {
  const value = read_optional_string(config, key);
  if (!value) throw new TypeError(`${owner} requires ${key}`);
  return value;
}

/** 从 Plugin 配置读取可选字符串。 */
function read_optional_string(config: JsonObject, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 从 Plugin 配置读取可选有限数值。 */
function read_optional_number(config: JsonObject, key: string): number | undefined {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
