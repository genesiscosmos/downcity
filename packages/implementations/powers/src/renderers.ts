/** Downcity 官方 Power Mainview 的 Renderer 专用注册表。 */

import type { PowerRendererDefinition } from "@downcity/city/power/react";
import { CHAT_POWER_RENDERER } from "@/chat/renderer/ChatPowerRenderer.js";
import { SKILL_POWER_RENDERER } from "@/skill/renderer/SkillPowerRenderer.js";
import { TASK_POWER_RENDERER } from "@/task/renderer/TaskPowerRenderer.js";
import { WEB_POWER_RENDERER } from "@/web/renderer/WebPowerSettingsRenderer.js";

/** 官方 Power ID 到 Renderer 定义的稳定映射。 */
export const BUILTIN_POWER_RENDERERS: Readonly<Record<string, PowerRendererDefinition>> = {
  skill: SKILL_POWER_RENDERER,
  task: TASK_POWER_RENDERER,
  chat: CHAT_POWER_RENDERER,
  web: WEB_POWER_RENDERER,
};
