/**
 * Downcity 官方 City Plugin 注册集合。
 *
 * 每个官方 Plugin 直接提供一个唯一实例；City 持有实例生命周期，Desktop 使用同一
 * Plugin 实例在 start 阶段直接装配 Mainview/Config action。
 */

import { fileURLToPath } from "node:url";
import type { CityPluginRegistration } from "@downcity/city/plugin";
import { ChatPlugin } from "@/chat.js";
import { MemoryPlugin } from "@/memory.js";
import { SkillPlugin } from "@/skill.js";
import { SoundPlugin } from "@/sound.js";
import { TaskPlugin } from "@/task.js";
import { WebPlugin } from "@/web.js";

/** 官方 Plugin definition 与 @downcity/city/plugin 的统一注册协议一致。 */
export type BuiltinPluginDefinition = CityPluginRegistration;

/** 官方 Plugin 注册由 CityPluginRegistration 直接表达。 */
export type BuiltinPluginRegistration = CityPluginRegistration;

/** 创建 Downcity 官方 Plugin 注册集合。 */
export function create_builtin_plugin_registrations(): BuiltinPluginRegistration[] {
  return [
    {
      readme: builtin_readme_path("skill"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      plugin: new SkillPlugin(),
    },
    {
      readme: builtin_readme_path("task"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      plugin: new TaskPlugin(),
    },
    {
      readme: builtin_readme_path("chat"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      plugin: new ChatPlugin(),
    },
    {
      readme: builtin_readme_path("memory"),
      has_config: false,
      has_sidebar: false,
      has_mainview: false,
      plugin: new MemoryPlugin(),
    },
    {
      readme: builtin_readme_path("web"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      plugin: new WebPlugin(),
    },
    {
      readme: builtin_readme_path("sound"),
      has_config: true,
      has_sidebar: false,
      has_mainview: false,
      plugin: new SoundPlugin({}),
    },
  ];
}

/** 返回随 package 发布的官方 Plugin Markdown 用户文档绝对路径。 */
function builtin_readme_path(plugin_id: string): string {
  return fileURLToPath(new URL(`../../readmes/${plugin_id}.readme.md`, import.meta.url));
}
