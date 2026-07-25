/**
 * Agent Control API 路由聚合入口。
 *
 * 关键点（中文）
 * - 本文件只做模块装配，不再承载具体业务逻辑。
 * - 单 agent control API 子路由按 overview/session/task/auth 四类拆分，便于继续维护。
 * - 单 agent control API 统一暴露在 `/api/control/*` 下。
 */

import type { ControlRouteRegistrationParams } from "@/city/agent/http/control/types/ControlRoutes.js";
import { register_control_chat_access_routes } from "@/city/agent/http/control/ControlChatAccessRoutes.js";
import { registerControlSessionRoutes } from "@/city/agent/http/control/SessionRoutes.js";
import { registerControlOverviewRoutes } from "@/city/agent/http/control/OverviewRoutes.js";
import { registerControlTaskRoutes } from "@/city/agent/http/control/TaskRoutes.js";

/**
 * 注册单 agent control API 路由。
 */
export function registerControlApiRoutes(
  params: ControlRouteRegistrationParams,
): void {
  register_control_chat_access_routes({
    app: params.app,
    get_agent: params.get_agent,
  });
  registerControlOverviewRoutes(params);
  registerControlSessionRoutes(params);
  registerControlTaskRoutes(params);
}
