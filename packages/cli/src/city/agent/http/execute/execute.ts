/**
 * 执行入口路由模块。
 *
 * 职责说明：
 * 1. 接收 `/api/execute` 请求。
 * 2. 完成请求解析、context 注入、agent 执行与结果回写。
 * 3. 统一处理接口层错误返回。
 */

import { Hono } from "hono";
import type { CliAgentContext } from "@/city/agent/CliAgentContext.js";
import type { AgentSession } from "@downcity/agent";

/**
 * 执行入口路由参数。
 */
type ExecuteRouterOptions = {
  /**
   * 读取当前 agent runtime。
   */
  get_context: () => CliAgentContext;
};

/**
 * 创建执行入口路由。
 */
export function createExecuteRouter(
  options: ExecuteRouterOptions,
): Hono {
  const router = new Hono();
  const session_ids_by_chat_key = new Map<string, string>();

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
      const agentState = options.get_context();
      const chat_key = `${agentState.id}:${agentState.workspace_id}:${chatId}`;
      let session_id = session_ids_by_chat_key.get(chat_key);
      let session: AgentSession;
      if (session_id) {
        session = await agentState.sessions.get(session_id, "chat", {
          workspace: agentState.workspace,
        });
      } else {
        session = await agentState.sessions.create({
          workspace: agentState.workspace,
        });
        session_id = session.id;
        session_ids_by_chat_key.set(chat_key, session_id);
      }
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
