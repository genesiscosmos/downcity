/**
 * Downcity 官方 Plugin 注册集合。
 *
 * 本模块负责把官方 Plugin 按应用配置装配成 Agent 独享实例。应用提供
 * Embassy 服务，Plugin 自身只持有明确的服务接口。
 */

import type { JsonObject, Plugin } from "@downcity/agent";
import type { PluginHostContext } from "@downcity/agent";
import {
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  ChatPlugin,
  type ChatPluginConfig,
  type ChatPluginChannelConfig,
} from "@/chat.js";
import { FeishuChannel, QqChannel, TelegramChannel } from "@/chat.js";
import { ContactPlugin } from "@/contact.js";
import {
  IMAGE_PLUGIN_CONFIG_JSON_SCHEMA,
  ImagePlugin,
} from "@/image.js";
import {
  MemoryPlugin,
} from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import {
  SOUND_PLUGIN_CONFIG_JSON_SCHEMA,
  SoundPlugin,
} from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import {
  WEB_PLUGIN_CONFIG_JSON_SCHEMA,
  WebPlugin,
  type WebPluginOptions,
} from "@/web.js";
import { WorkboardPlugin } from "@/workboard.js";

/** 官方 Plugin definition 的最小结构协议。 */
export interface BuiltinPluginDefinition {
  /** Plugin 的稳定 ID。 */
  id: string;

  /** Plugin 的用户可见标题。 */
  title: string;

  /** Plugin 的用途说明。 */
  description: string;
  /** Plugin profile 的可选 JSON Schema。 */
  config?: {
    /** 校验 profile 并驱动管理表单的完整 JSON Schema。 */
    schema: JsonObject;
  };
}

/** 官方 Plugin 注册协议。 */
export interface BuiltinPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  readonly definition: BuiltinPluginDefinition;
  /** 使用 City 已校验的 profile 创建一个 Agent 独享的 Plugin 实例。 */
  setup(context: PluginHostContext): Plugin | Promise<Plugin>;
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
        },
      },
      setup(context) {
        const config = context.profile as unknown as ChatPluginConfig;
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
      },
      setup(context) {
        return new MemoryPlugin({ root_path: context.data_path });
      },
    },
    {
      definition: {
        id: "web",
        title: "Web",
        description: "Provides web search, document reading, and optional browser sessions.",
        config: { schema: WEB_PLUGIN_CONFIG_JSON_SCHEMA },
      },
      setup(context) {
        const config = context.profile as unknown as WebPluginOptions;
        return new WebPlugin(config);
      },
    },
    {
      definition: {
        id: "image",
        title: "Image",
        description: "Discovers image models, generates images, and reads results.",
        config: {
          schema: IMAGE_PLUGIN_CONFIG_JSON_SCHEMA,
        },
      },
      setup: (context) => new ImagePlugin({
        ...context.profile,
      }),
    },
    {
      definition: {
        id: "sound",
        title: "Sound",
        description: "Discovers speech models and provides ASR and TTS.",
        config: {
          schema: SOUND_PLUGIN_CONFIG_JSON_SCHEMA,
        },
      },
      setup: (context) => new SoundPlugin({
        ...context.profile,
      }),
    },
  ];
}

/** 获取并适配官方 ImagePlugin 所需的 Embassy 图片服务。 */
/** 创建没有配置协议的简单注册。 */
function simple_registration(
  id: string,
  title: string,
  description: string,
  setup: () => Plugin,
): BuiltinPluginRegistration {
  return { definition: { id, title, description }, setup };
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
