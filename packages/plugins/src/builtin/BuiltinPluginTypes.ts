/**
 * Downcity 官方 Plugin 注册集合。
 *
 * 本模块负责把官方 Plugin 组合成统一 definition + factory 协议。它不依赖 City、Embassy 或
 * Federation，只消费宿主提供的 AI 能力和本地路径。
 */

import type { JsonObject, Plugin } from "@downcity/agent";
import {
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  ChatPlugin,
  type ChatPluginConfig,
  type ChatPluginChannelConfig,
} from "@/chat.js";
import { FeishuChannel, QqChannel, TelegramChannel } from "@/chat.js";
import { ContactPlugin } from "@/contact.js";
import { ImagePlugin } from "@/image.js";
import {
  MemoryPlugin,
} from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import { SoundPlugin } from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { WebPlugin } from "@/web.js";
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

/** 官方 Plugin 注册协议。 */
export interface BuiltinPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  readonly definition: BuiltinPluginDefinition;
  /** 创建一个 Agent 独享的 Plugin 实例。 */
  /** 使用已校验的完整 profile 创建 Plugin。 */
  create(profile: JsonObject): Plugin;
}

/** 创建官方 Plugin 注册集合所需的宿主能力。 */
export interface BuiltinPluginRegistrationsOptions {
  /** Contact Plugin 对外报告的 HTTP 地址。 */
  contact_http?: {
    /** HTTP 监听地址。 */
    host?: string;
    /** HTTP 监听端口。 */
    port?: number;
  };

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
    browser: { type: "string", enum: ["playwright"], default: "playwright" },
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
      create(profile) {
        const config = profile as unknown as ChatPluginConfig;
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
      create(profile) {
        const config = profile as unknown as BuiltinMemoryPluginConfig;
        return new MemoryPlugin(config);
      },
    },
    {
      definition: {
        id: "web",
        title: "Web",
        description: "Provides structured browser sessions through a configured CDP endpoint.",
        config: { schema: web_plugin_config_schema, defaults: { browser: "playwright" } },
      },
      create(profile) {
        const config = profile as unknown as BuiltinWebPluginConfig;
        return new WebPlugin(config);
      },
    },
    {
      definition: {
        id: "image",
        title: "Image",
        description: "Discovers image models, generates images, and reads results.",
        config: {
          schema: {
            type: "object",
            properties: { default_model: { type: "string", minLength: 1 } },
            additionalProperties: false,
          },
          defaults: {},
        },
      },
      create: (profile) => new ImagePlugin(profile),
    },
    {
      definition: {
        id: "sound",
        title: "Sound",
        description: "Discovers speech models and provides ASR and TTS.",
        config: {
          schema: {
            type: "object",
            properties: {
              default_asr_model: { type: "string", minLength: 1 },
              default_tts_model: { type: "string", minLength: 1 },
              auto_asr: { type: "boolean", default: false },
              language: { type: "string", minLength: 1 },
              voice: { type: "string", minLength: 1 },
              format: { type: "string", minLength: 1 },
            },
            additionalProperties: false,
          },
          defaults: {},
        },
      },
      create: (profile) => new SoundPlugin(profile),
    },
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
