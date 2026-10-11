/**
 * Power 路由模块。
 *
 * 职责说明：
 * 1. 提供 power catalog / state / availability 接口。
 * 2. 提供 power 注册状态查询与卸载接口。
 * 3. 提供统一 Power Action 桥接接口。
 */

import { Hono } from "hono";
import type { CliAgentContext } from "@/city/agent/CliAgentContext.js";

/**
 * Power 路由参数。
 */
type PowersRouterOptions = {
  /**
   * 读取当前 agent 执行上下文。
   */
  get_context: () => CliAgentContext;
};

/**
 * 创建 power 路由。
 */
export function createPowersRouter(
  options: PowersRouterOptions,
): Hono {
  const router = new Hono();

  router.get("/api/powers/catalog", (c) => {
    return c.json({
      success: true,
      powers: options.get_context().powers.list(),
    });
  });

  router.get("/api/powers/list", (c) => {
    return c.json({
      success: true,
      powers: options.get_context().list_power_states(),
    });
  });

  router.post("/api/powers/availability", async (c) => {
    const body = await c.req.json().catch(() => null);
    const power_name = String(body?.power_name || "").trim();

    if (!power_name) {
      return c.json({ success: false, error: "power_name is required" }, 400);
    }

    const availability =
      await options.get_context().powers.availability(power_name);
    return c.json({
      success: true,
      power_name,
      availability,
    });
  });

  router.post("/api/powers/action", async (c) => {
    const body = await c.req.json().catch(() => null);
    const power_name = String(body?.power_name || "").trim();
    const action_name = String(body?.action_name || "").trim();

    if (!power_name) {
      return c.json({ success: false, error: "power_name is required" }, 400);
    }
    if (!action_name) {
      return c.json({ success: false, error: "action_name is required" }, 400);
    }

    const result = await options.get_context().powers.run_action({
      power: power_name,
      action: action_name,
      payload: body?.payload,
    });
    return c.json(
      {
        ...result,
        power_name,
        action_name,
      },
      result.success ? 200 : 400,
    );
  });

  return router;
}
