/**
 * RemoteAgent runtime HTTP 路由。
 *
 * 关键点（中文）
 * - 与 SessionRoutes 一起构成独立 AgentHTTP 的完整 RemoteAgent HTTP 调用面。
 * - 只暴露 Agent 级 power action；Shell approval 已归属具体 Session。
 * - CLI 可叠加自己的控制面路由，但不依赖这些路由承载平台语义。
 */

import type { Hono } from "hono";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { JsonValue } from "@downcity/agent";

/**
 * 注册 RemoteAgent 顶层 runtime 路由。
 */
export function register_runtime_routes(app: Hono, powers: AgentPowerRuntime): void {
  app.post("/api/powers/action", async (c) => {
    try {
      const body = await c.req.json().catch(() => null) as {
        power_name?: unknown;
        action_name?: unknown;
        payload?: unknown;
      } | null;
      const power_name = String(body?.power_name || "").trim();
      const action_name = String(body?.action_name || "").trim();
      if (!power_name) {
        return c.json({ success: false, error: "power_name is required" }, 400);
      }
      if (!action_name) {
        return c.json({ success: false, error: "action_name is required" }, 400);
      }
      const result = await powers.run_action({
        power: power_name,
        action: action_name,
        ...(body?.payload !== undefined
          ? { payload: body.payload as JsonValue }
          : {}),
      });
      return c.json(
        { ...result, power_name: power_name, action_name: action_name },
        result.success ? 200 : 400,
      );
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });
}
