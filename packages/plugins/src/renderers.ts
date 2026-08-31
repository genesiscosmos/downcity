/** Downcity 官方 Plugin Mainview 的 Renderer 专用注册表。 */

import type { PluginRendererComponent } from "@downcity/plugin/react";
import { CHAT_PLUGIN_RENDERER } from "@/chat/renderer/ChatPluginRenderer.js";
import {
  IMAGE_PLUGIN_SETTINGS,
  SOUND_PLUGIN_SETTINGS,
  WEB_PLUGIN_SETTINGS,
} from "@/builtin/PluginSettingsDefinitions.js";
import { create_plugin_settings_renderer } from "@/builtin/renderer/PluginSettingsRenderer.js";

/** 官方 Plugin ID 到唯一 Mainview 组件的稳定映射。 */
export const BUILTIN_PLUGIN_RENDERERS: Readonly<Record<string, PluginRendererComponent>> = {
  chat: CHAT_PLUGIN_RENDERER,
  web: create_plugin_settings_renderer(WEB_PLUGIN_SETTINGS),
  image: create_plugin_settings_renderer(IMAGE_PLUGIN_SETTINGS),
  sound: create_plugin_settings_renderer(SOUND_PLUGIN_SETTINGS),
};
