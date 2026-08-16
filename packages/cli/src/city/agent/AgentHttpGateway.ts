/**
 * AgentHttpGateway：City 托管的 Agent HTTP 网关。
 *
 * 职责说明（中文）
 * - 作为 City 多 Agent Gateway 的单 Agent 子应用，承载控制面、Plugin 与 SDK 路由。
 * - HTTP Server 生命周期归 CLI City 管理。
 * - HTTP route 实现放在 City 内部，Agent 只提供 Agent / sessionCollection。
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Hono as HonoType } from "hono";
import { createExecuteRouter } from "@/city/agent/http/execute/execute.js";
import { healthRouter } from "@/city/agent/http/health/health.js";
import { createPluginsRouter } from "@/city/agent/http/plugins/plugins.js";
import { createStaticRouter } from "@/city/agent/http/static/static.js";
import { createControlRouter } from "@/city/agent/http/control/ControlRouter.js";
import type { AgentWorkspace } from "@downcity/agent";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import {
  createRouteAuthGuardMiddleware,
  SERVER_AUTH_ROUTE_POLICIES,
} from "@/city/runtime/auth/RoutePolicy.js";

/** CLI Agent HTTP 子应用的组合参数。 */
interface AgentHttpGatewayOptions {
  /** 当前 agent context 读取函数。 */
  get_agent: () => AgentWorkspace;
  /** 可选 SDK transport 子路由（来自 `@downcity/city` 的 `AgentHTTP.router()`）。 */
  sdk_router?: HonoType;
  /** CLI 组合根创建并拥有的鉴权服务。 */
  auth_service: AuthService;
}

/**
 * 创建 Agent HTTP 网关 Hono 应用。
 */
export function create_agent_http_gateway_app(
  options: AgentHttpGatewayOptions,
): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", createRouteAuthGuardMiddleware(
    options.auth_service,
    SERVER_AUTH_ROUTE_POLICIES,
  ));

  // 关键点（中文）：HTTP 协议面由 City 装配，Agent 只提供 Agent。
  app.route("/", createStaticRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", healthRouter);
  app.route("/", createPluginsRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", createExecuteRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", createControlRouter({
    get_agent: options.get_agent,
  }));
  if (options.sdk_router) {
    app.route("/", options.sdk_router);
  }
  options.get_agent().register_plugin_http_routes(app);

  return app;
}
