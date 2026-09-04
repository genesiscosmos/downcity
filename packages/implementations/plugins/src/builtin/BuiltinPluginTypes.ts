/**
 * Downcity 官方 City Plugin 注册集合。
 *
 * 每个官方 Plugin 只提供一个统一 main 模块；City 根据 Profile 创建并共享执行实例，
 * Desktop 使用同一个模块注册 Mainview/Config action。
 */

import { fileURLToPath } from "node:url";
import {
  define_city_plugin,
  type CityPluginModule,
  type CityPluginRegistration,
  type PluginMainModule,
} from "@downcity/city/plugin";
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
import { MemoryPlugin } from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import { SKILL_PLUGIN_MAIN } from "@/skill/main/SkillPluginMain.js";
import { SoundPlugin } from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { TASK_PLUGIN_MAIN } from "@/task/main/TaskPluginMain.js";
import { WebPlugin, type WebPluginOptions } from "@/web.js";

/** 官方 Plugin definition 与 @downcity/city/plugin 的统一注册协议一致。 */
export type BuiltinPluginDefinition = Omit<CityPluginRegistration, "module">;

/** 官方 Plugin 注册由 CityPluginRegistration 直接表达。 */
export type BuiltinPluginRegistration = CityPluginRegistration;

/** 创建 Downcity 官方 Plugin 注册集合。 */
export function create_builtin_plugin_registrations(): BuiltinPluginRegistration[] {
  return [
    registration({
      id: "skill",
      title: "Skills",
      description: "Lists and reads local skills, and injects discovery guidance.",
      readme: builtin_readme_path("skill"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      main: SKILL_PLUGIN_MAIN,
      create: () => new SkillPlugin(),
    }),
    registration({
      id: "task",
      title: "Task",
      description: "Manages reusable tasks and their trigger runtime.",
      readme: builtin_readme_path("task"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      main: TASK_PLUGIN_MAIN,
      create: () => new TaskPlugin(),
    }),
    registration({
      id: "chat",
      title: "Chat",
      description: "Connects Agents to Telegram, Feishu, and QQ channels.",
      readme: builtin_readme_path("chat"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: CHAT_PLUGIN_MAIN,
      create: ({ profile }) => {
        const config = profile.config as unknown as ChatPluginConfig;
        return new ChatPlugin({
          owner_agent_id: config.owner_agent_id,
          owner_workspace_id: config.owner_workspace_id,
          queue: config.queue,
          channels: create_chat_channels(config.channels ?? []),
        });
      },
    }),
    registration({
      id: "memory",
      title: "Memory",
      description: "Provides provider-neutral long-term memory, recall, revision, and deletion.",
      readme: builtin_readme_path("memory"),
      has_config: false,
      has_sidebar: false,
      has_mainview: false,
      create: ({ storage }) => new MemoryPlugin({ storage_root_path: storage.path }),
    }),
    registration({
      id: "web",
      title: "Web",
      description: "Provides web search, document reading, and optional browser sessions.",
      readme: builtin_readme_path("web"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(WEB_PLUGIN_SETTINGS),
      create: ({ profile }) => new WebPlugin(profile.config as unknown as WebPluginOptions),
    }),
    registration({
      id: "image",
      title: "Image",
      description: "Discovers image models, generates images, and reads results.",
      readme: builtin_readme_path("image"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(IMAGE_PLUGIN_SETTINGS),
      create: ({ profile }) => new ImagePlugin({ ...profile.config }),
    }),
    registration({
      id: "sound",
      title: "Sound",
      description: "Discovers speech models and provides ASR and TTS.",
      readme: builtin_readme_path("sound"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(SOUND_PLUGIN_SETTINGS),
      create: ({ profile }) => new SoundPlugin({ ...profile.config }),
    }),
  ];
}

/** 组合执行 factory 与可选 UI main 生命周期。 */
function registration(input: BuiltinPluginDefinition & {
  /** 可选 Mainview/Config main。 */
  readonly main?: PluginMainModule;
  /** City 共享实例 factory。 */
  readonly create: CityPluginModule["create"];
}): BuiltinPluginRegistration {
  const { main, create, ...definition } = input;
  return {
    ...definition,
    module: define_city_plugin({
      activate: async (context) => await main?.activate(context),
      ...(main?.deactivate
        ? { deactivate: async (context) => await main.deactivate?.(context) }
        : {}),
      create,
    }),
  };
}

/** 返回随 package 发布的官方 Plugin Markdown 用户文档绝对路径。 */
function builtin_readme_path(plugin_id: string): string {
  return fileURLToPath(new URL(`../../readmes/${plugin_id}.readme.md`, import.meta.url));
}

/** 创建 Chat Profile 对应的运行渠道。 */
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
