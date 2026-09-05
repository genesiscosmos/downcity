/**
 * Downcity 官方 City Plugin 注册集合。
 *
 * 每个官方 Plugin 直接提供一个唯一实例；City 持有实例生命周期，Desktop 使用同一
 * 注册项中的 main 能力装配 Mainview/Config action。
 */

import { fileURLToPath } from "node:url";
import type { CityPluginRegistration } from "@downcity/city/plugin";
import { CHAT_PLUGIN_MAIN } from "@/chat/main/ChatPluginMain.js";
import {
  IMAGE_PLUGIN_SETTINGS,
  SOUND_PLUGIN_SETTINGS,
  WEB_PLUGIN_SETTINGS,
} from "@/builtin/PluginSettingsDefinitions.js";
import { create_plugin_settings_main } from "@/builtin/main/PluginSettingsMain.js";
import { ChatPlugin } from "@/chat.js";
import { ImagePlugin } from "@/image.js";
import { MemoryPlugin } from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import { SKILL_PLUGIN_MAIN } from "@/skill/main/SkillPluginMain.js";
import { SoundPlugin } from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { TASK_PLUGIN_MAIN } from "@/task/main/TaskPluginMain.js";
import { WebPlugin } from "@/web.js";

/** 官方 Plugin definition 与 @downcity/city/plugin 的统一注册协议一致。 */
export type BuiltinPluginDefinition = CityPluginRegistration;

/** 官方 Plugin 注册由 CityPluginRegistration 直接表达。 */
export type BuiltinPluginRegistration = CityPluginRegistration;

/** 创建 Downcity 官方 Plugin 注册集合。 */
export function create_builtin_plugin_registrations(): BuiltinPluginRegistration[] {
  return [
    {
      id: "skill",
      title: "Skills",
      description: "Lists and reads local skills, and injects discovery guidance.",
      readme: builtin_readme_path("skill"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      main: SKILL_PLUGIN_MAIN,
      plugin: new SkillPlugin(),
    },
    {
      id: "task",
      title: "Task",
      description: "Manages reusable tasks and their trigger runtime.",
      readme: builtin_readme_path("task"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      main: TASK_PLUGIN_MAIN,
      plugin: new TaskPlugin(),
    },
    {
      id: "chat",
      title: "Chat",
      description: "Connects Agents to Telegram, Feishu, and QQ channels.",
      readme: builtin_readme_path("chat"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: CHAT_PLUGIN_MAIN,
      plugin: new ChatPlugin(),
    },
    {
      id: "memory",
      title: "Memory",
      description: "Provides provider-neutral long-term memory, recall, revision, and deletion.",
      readme: builtin_readme_path("memory"),
      has_config: false,
      has_sidebar: false,
      has_mainview: false,
      plugin: new MemoryPlugin(),
    },
    {
      id: "web",
      title: "Web",
      description: "Provides web search, document reading, and optional browser sessions.",
      readme: builtin_readme_path("web"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(WEB_PLUGIN_SETTINGS),
      plugin: new WebPlugin(),
    },
    {
      id: "image",
      title: "Image",
      description: "Discovers image models, generates images, and reads results.",
      readme: builtin_readme_path("image"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(IMAGE_PLUGIN_SETTINGS),
      plugin: new ImagePlugin({}),
    },
    {
      id: "sound",
      title: "Sound",
      description: "Discovers speech models and provides ASR and TTS.",
      readme: builtin_readme_path("sound"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      main: create_plugin_settings_main(SOUND_PLUGIN_SETTINGS),
      plugin: new SoundPlugin({}),
    },
  ];
}

/** 返回随 package 发布的官方 Plugin Markdown 用户文档绝对路径。 */
function builtin_readme_path(plugin_id: string): string {
  return fileURLToPath(new URL(`../../readmes/${plugin_id}.readme.md`, import.meta.url));
}
