/** Downcity 官方 Power Mainview 的 Renderer 专用注册表。 */

import type { PowerRendererDefinition } from "@downcity/city/power/react";
import { PRESENTATION_POWER_RENDERER } from "@/presentation/renderer/PresentationRenderer.js";
import { MESSENGER_POWER_RENDERER } from "@/messenger/renderer/MessengerPowerRenderer.js";
import { MEMORY_POWER_RENDERER } from "@/memory/renderer/MemoryPowerRenderer.js";
import { SKILL_POWER_RENDERER } from "@/skill/renderer/SkillPowerRenderer.js";
import { WEB_POWER_RENDERER } from "@/web/renderer/WebPowerRenderer.js";
import { MCP_POWER_RENDERER } from "@/mcp/renderer/McpPowerRenderer.js";

/** 官方 Power ID 到 Renderer 定义的稳定映射。 */
export const BUILTIN_POWER_RENDERERS: Readonly<Record<string, PowerRendererDefinition>> = {
  presentation: PRESENTATION_POWER_RENDERER,
  skill: SKILL_POWER_RENDERER,
  messenger: MESSENGER_POWER_RENDERER,
  memory: MEMORY_POWER_RENDERER,
  web: WEB_POWER_RENDERER,
  mcp: MCP_POWER_RENDERER,
};
