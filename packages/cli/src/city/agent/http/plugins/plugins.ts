/**
 * Plugin 路由模块。
 *
 * 职责说明：
 * 1. 提供 plugin catalog / state / availability 接口。
 * 2. 提供 plugin 注册状态查询与卸载接口。
 * 3. 提供统一 Plugin Action 桥接接口。
 */

import { Hono } from "hono";
import type { AgentWorkspace } from "@downcity/agent/internal";

/**
 * Plugin 路由参数。
 */
type PluginsRouterOptions = {
  /**
   * 读取当前 agent 执行上下文。
   */
  get_agent: () => AgentWorkspace;
};

/**
 * 创建 plugin 路由。
 */
export function createPluginsRouter(
  options: PluginsRouterOptions,
): Hono {
  const router = new Hono();

  router.get("/api/plugins/catalog", (c) => {
    return c.json({
      success: true,
      plugins: options.get_agent().plugins.list(),
    });
  });

  router.get("/api/plugins/list", (c) => {
    return c.json({
      success: true,
      plugins: options.get_agent().list_plugin_states(),
    });
  });

  router.post("/api/plugins/availability", async (c) => {
    const body = await c.req.json().catch(() => null);
    const plugin_name = String(body?.plugin_name || "").trim();

    if (!plugin_name) {
      return c.json({ success: false, error: "plugin_name is required" }, 400);
    }

    const availability =
      await options.get_agent().plugins.availability(plugin_name);
    return c.json({
      success: true,
      plugin_name,
      availability,
    });
  });

  router.post("/api/plugins/action", async (c) => {
    const body = await c.req.json().catch(() => null);
    const plugin_name = String(body?.plugin_name || "").trim();
    const action_name = String(body?.action_name || "").trim();

    if (!plugin_name) {
      return c.json({ success: false, error: "plugin_name is required" }, 400);
    }
    if (!action_name) {
      return c.json({ success: false, error: "action_name is required" }, 400);
    }

    const result = await options.get_agent().plugins.run_action({
      plugin: plugin_name,
      action: action_name,
      payload: body?.payload,
    });
    return c.json(
      {
        ...result,
        plugin_name,
        action_name,
      },
      result.success ? 200 : 400,
    );
  });

  return router;
}
