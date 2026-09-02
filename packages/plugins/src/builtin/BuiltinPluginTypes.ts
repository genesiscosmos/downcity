/**
 * Downcity 官方 Plugin 注册集合。
 *
 * 本模块负责把官方 Plugin 按应用配置装配成 Agent 独享实例。应用提供
 * Embassy 服务，Plugin 自身只持有明确的服务接口。
 */

import { fileURLToPath } from "node:url";
import type { Plugin } from "@downcity/agent";
import type { PluginHostContext } from "@downcity/agent";
import type { PluginMainModule } from "@downcity/plugin";
import { CHAT_PLUGIN_MAIN } from "@/chat/main/ChatPluginMain.js";
import {
  IMAGE_PLUGIN_SETTINGS,
  SOUND_PLUGIN_SETTINGS,
  WEB_PLUGIN_SETTINGS,
} from "@/builtin/PluginSettingsDefinitions.js";
import { create_plugin_settings_main } from "@/builtin/main/PluginSettingsMain.js";
import {
  ChatPlugin,
  type ChatPluginConfig,
  type ChatPluginChannelConfig,
} from "@/chat.js";
import { FeishuChannel, QqChannel, TelegramChannel } from "@/chat.js";
import { ImagePlugin } from "@/image.js";
import {
  MemoryPlugin,
} from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import { SKILL_PLUGIN_MAIN } from "@/skill/main/SkillPluginMain.js";
import { SoundPlugin } from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { TASK_PLUGIN_MAIN } from "@/task/main/TaskPluginMain.js";
import {
  WebPlugin,
  type WebPluginOptions,
} from "@/web.js";

/** 官方 Plugin definition 的最小结构协议。 */
export interface BuiltinPluginDefinition {
  /** Plugin 的稳定 ID。 */
  id: string;

  /** Plugin 的用户可见标题。 */
  title: string;

  /** Plugin 的用途说明。 */
  description: string;

  /** 宿主可读取的独立 Markdown 用户文档绝对路径。 */
  readme: string;

  /** 官方 Plugin 是否提供 Agent 能力。 */
  has_agent: boolean;

  /** 官方 Plugin 是否提供宿主 main。 */
  has_main: boolean;

  /** 官方 Plugin 是否提供专属 Sidebar。 */
  has_sidebar: boolean;

  /** 官方 Plugin 是否提供业务 Mainview。 */
  has_mainview: boolean;

  /** 官方 Plugin 是否提供设置中心 Config。 */
  has_config: boolean;
}

/** 官方 Plugin 注册协议。 */
export interface BuiltinPluginRegistration {
  /** Plugin 的唯一静态定义。 */
  readonly definition: BuiltinPluginDefinition;
  /** 使用 City 读取的 Profile 创建一个 Agent 独享的 Plugin 实例。 */
  create_agent(context: PluginHostContext): Plugin | Promise<Plugin>;

  /** 可选的宿主 main 生命周期对象。 */
  main?: PluginMainModule;

}

/** 创建 Downcity 官方 Plugin 注册集合。 */
export function create_builtin_plugin_registrations(): BuiltinPluginRegistration[] {
  return [
    {
      definition: {
        id: "skill",
        title: "Skills",
        description: "Lists and reads local skills, and injects discovery guidance.",
        readme: builtin_readme_path("skill"),
        has_agent: true,
        has_main: true,
        has_sidebar: true,
        has_mainview: true,
        has_config: false,
      },
      main: SKILL_PLUGIN_MAIN,
      create_agent: () => new SkillPlugin(),
    },
    {
      definition: {
        id: "task",
        title: "Task",
        description: "Manages reusable tasks and their trigger runtime.",
        readme: builtin_readme_path("task"),
        has_agent: true,
        has_main: true,
        has_sidebar: true,
        has_mainview: true,
        has_config: false,
      },
      main: TASK_PLUGIN_MAIN,
      create_agent: (context) => new TaskPlugin({ notifications: context.notifications }),
    },
    {
      definition: {
        id: "chat",
        title: "Chat",
        description: "Connects Agents to Telegram, Feishu, and QQ channels.",
        readme: builtin_readme_path("chat"),
        has_agent: true,
        has_main: true,
        has_sidebar: false,
        has_mainview: false,
        has_config: true,
      },
      main: CHAT_PLUGIN_MAIN,
      create_agent(context) {
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
        readme: builtin_readme_path("memory"),
        has_agent: true,
        has_main: false,
        has_sidebar: false,
        has_mainview: false,
        has_config: false,
      },
      create_agent(context) {
        return new MemoryPlugin({ root_path: context.data_path });
      },
    },
    {
      definition: {
        id: "web",
        title: "Web",
        description: "Provides web search, document reading, and optional browser sessions.",
        readme: builtin_readme_path("web"),
        has_agent: true,
        has_main: true,
        has_sidebar: false,
        has_mainview: false,
        has_config: true,
      },
      main: create_plugin_settings_main(WEB_PLUGIN_SETTINGS),
      create_agent(context) {
        const config = context.profile as unknown as WebPluginOptions;
        return new WebPlugin(config);
      },
    },
    {
      definition: {
        id: "image",
        title: "Image",
        description: "Discovers image models, generates images, and reads results.",
        readme: builtin_readme_path("image"),
        has_agent: true,
        has_main: true,
        has_sidebar: false,
        has_mainview: false,
        has_config: true,
      },
      main: create_plugin_settings_main(IMAGE_PLUGIN_SETTINGS),
      create_agent: (context) => new ImagePlugin({
        ...context.profile,
      }),
    },
    {
      definition: {
        id: "sound",
        title: "Sound",
        description: "Discovers speech models and provides ASR and TTS.",
        readme: builtin_readme_path("sound"),
        has_agent: true,
        has_main: true,
        has_sidebar: false,
        has_mainview: false,
        has_config: true,
      },
      main: create_plugin_settings_main(SOUND_PLUGIN_SETTINGS),
      create_agent: (context) => new SoundPlugin({
        ...context.profile,
      }),
    },
  ];
}

/** 返回随 package 发布的官方 Plugin Markdown 用户文档绝对路径。 */
function builtin_readme_path(plugin_id: string): string {
  return fileURLToPath(new URL(`../../readmes/${plugin_id}.readme.md`, import.meta.url));
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
