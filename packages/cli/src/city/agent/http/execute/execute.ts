/**
 * 执行入口路由模块。
 *
 * 职责说明：
 * 1. 接收 `/api/execute` 请求。
 * 2. 完成请求解析、context 注入、agent 执行与结果回写。
 * 3. 统一处理接口层错误返回。
 */

import { Hono } from "hono";
import type { AgentWorkspace } from "@downcity/agent/internal";

/**
 * 执行入口路由参数。
 */
type ExecuteRouterOptions = {
  /**
   * 读取当前 agent runtime。
   */
  get_agent: () => AgentWorkspace;
};

/**
 * 创建执行入口路由。
 */
export function createExecuteRouter(
  options: ExecuteRouterOptions,
): Hono {
  const router = new Hono();

  router.post("/api/execute", async (c) => {
    let body_text = "";
    try {
      body_text = await c.req.text();
    } catch {
      return c.json(
        { success: false, message: "Unable to read request body" },
        400,
      );
    }

    if (!body_text) {
      return c.json({ success: false, message: "Request body is empty" }, 400);
    }

    let body: {
      instructions?: string;
      chatId?: string;
      user_id?: string;
      actorId?: string;
      message_id?: string;
    };
    try {
      body = JSON.parse(body_text) as typeof body;
    } catch {
      return c.json(
        {
          success: false,
          message: `JSON parse failed: ${body_text.substring(0, 50)}...`,
        },
        400,
      );
    }

    const instructions = body?.instructions;
    const chatId =
      typeof body?.chatId === "string" && body.chatId.trim()
        ? body.chatId.trim()
        : "default";
    if (!instructions) {
      return c.json(
        { success: false, message: "Missing instructions field" },
        400,
      );
    }

    try {
      const session_id = `api:chat:${chatId}`;
      const agentState = options.get_agent();
      const session = agentState.sessions.runtime(session_id);
      const turn = await session.prompt({
        query: String(instructions),
      });
      const result = await turn.finished;

      return c.json({
        success: result.success,
        ...(result.error ? { error: result.error } : {}),
        text: result.text,
      });
    } catch (error) {
      return c.json({ success: false, message: String(error) }, 500);
    }
  });

  return router;
}
