/** Downcity 官方 Plugin Mainview 的 Renderer 专用注册表。 */

import type { PluginRendererDefinition } from "@downcity/city/plugin/react";
import { CHAT_PLUGIN_RENDERER } from "@/chat/renderer/ChatPluginRenderer.js";
import { SKILL_PLUGIN_RENDERER } from "@/skill/renderer/SkillPluginRenderer.js";
import { TASK_PLUGIN_RENDERER } from "@/task/renderer/TaskPluginRenderer.js";
import {
  SOUND_PLUGIN_SETTINGS,
} from "@/builtin/PluginSettingsDefinitions.js";
import { create_plugin_settings_renderer } from "@/builtin/renderer/PluginSettingsRenderer.js";
import { WEB_PLUGIN_RENDERER } from "@/web/renderer/WebPluginSettingsRenderer.js";

/** 官方 Plugin ID 到 Renderer 定义的稳定映射。 */
export const BUILTIN_PLUGIN_RENDERERS: Readonly<Record<string, PluginRendererDefinition>> = {
  skill: SKILL_PLUGIN_RENDERER,
  task: TASK_PLUGIN_RENDERER,
  chat: CHAT_PLUGIN_RENDERER,
  web: WEB_PLUGIN_RENDERER,
  sound: create_plugin_settings_renderer(SOUND_PLUGIN_SETTINGS),
};
