/** Downcity 官方 Power Mainview 的 Renderer 专用注册表。 */

import type { PowerRendererDefinition } from "@downcity/city/power/react";
import { PRESENTATION_POWER_RENDERER } from "@/presentation/renderer/PresentationRenderer.js";
import { MESSENGER_POWER_RENDERER } from "@/messenger/renderer/MessengerPowerRenderer.js";
import { MEMORY_POWER_RENDERER } from "@/memory/renderer/MemoryPowerRenderer.js";
import { SKILL_POWER_RENDERER } from "@/skill/renderer/SkillPowerRenderer.js";
import { WEB_POWER_RENDERER } from "@/web/renderer/WebPowerRenderer.js";
import { NOTIFICATION_POWER_RENDERER } from "@/notification/renderer/NotificationPowerRenderer.js";

/** Inbox 宿主适配工厂；Desktop 注入原有 Interaction 表单和受信私密入口。 */
export { NOTIFICATION_POWER_RENDERER, create_notification_power_renderer } from "@/notification/renderer/NotificationPowerRenderer.js";
export type { NotificationInteractionItem, NotificationListResult, NotificationRendererOptions } from "@/notification/types/NotificationRenderer.js";

/** 官方 Power ID 到 Renderer 定义的稳定映射。 */
export const BUILTIN_POWER_RENDERERS: Readonly<Record<string, PowerRendererDefinition>> = {
  notification: NOTIFICATION_POWER_RENDERER,
  presentation: PRESENTATION_POWER_RENDERER,
  skill: SKILL_POWER_RENDERER,
  messenger: MESSENGER_POWER_RENDERER,
  memory: MEMORY_POWER_RENDERER,
  web: WEB_POWER_RENDERER,
};
