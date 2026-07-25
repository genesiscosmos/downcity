/**
 * 单 agent control API 会话路由。
 *
 * 关键点（中文）
 * - 聚合控制面会话消息、system prompt 与执行相关接口。
 * - 仅负责编排请求与响应；消息读取、时间线映射、执行拼装复用 helper。
 * - 会话控制接口统一暴露在 `/api/control/*` 下。
 */

import type { SystemModelMessage } from "ai";
import {
  resolveSessionSystemMessages,
  to_session_message_timeline_events,
  type AgentSession,
  type SessionMessage,
} from "@downcity/agent";
import type { ControlSessionExecuteRequestBody } from "@/city/agent/control/types/ControlSessionExecute.js";
import type { ControlRouteRegistrationParams } from "@/city/agent/http/control/types/ControlRoutes.js";
import {
  buildControlRouteAliases,
  decodeMaybe,
  toLimit,
} from "@/city/agent/control/CommonHelpers.js";
import { list_control_session_summaries } from "@/city/agent/control/Helpers.js";
import { executeBySessionId } from "@/city/agent/control/ExecuteBySession.js";

const CITY_CHAT_SESSION_ID = "city-chat-main";

/** 从最新 Active 开始向前读取，返回指定数量的最近可见 Message。 */
async function read_recent_session_messages(
  session: AgentSession,
  limit: number,
): Promise<{ items: SessionMessage[]; total: number }> {
  let page = await session.messages();
  const items = [...page.items];
  const total = page.total;
  while (items.length < limit && page.has_more && page.next_before_sequence) {
    page = await session.messages({
      before_sequence: page.next_before_sequence,
    });
    items.unshift(...page.items);
  }
  return {
    items: items.slice(-limit),
    total,
  };
}

function normalizeSystemText(input: string | null | undefined): string {
  return String(input || "").trim();
}

function toSystemMessageText(message: SystemModelMessage): string {
  const content = message.content as unknown;
  if (typeof content === "string") return normalizeSystemText(content);
  if (!Array.isArray(content)) return "";
  const parts = content as Array<{ text?: unknown }>;
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const text = normalizeSystemText(String(part.text || ""));
    if (!text) continue;
    texts.push(text);
  }
  return texts.join("\n").trim();
}

/**
 * 把 system messages 转成 control UI 可渲染结构。
 */
function toSystemPromptPayload(messages: SystemModelMessage[]): {
  sections: Array<{
    key: string;
    title: string;
    items: Array<{ index: number; content: string }>;
  }>;
  totalMessages: number;
  totalChars: number;
} {
  const items = messages
    .map((message, index) => ({
      index: index + 1,
      content: toSystemMessageText(message),
    }))
    .filter((item) => item.content);
  const totalChars = items.reduce(
    (acc, item) => acc + String(item.content || "").length,
    0,
  );
  return {
    sections: [
      {
        key: "resolved",
        title: "Resolved System Messages",
        items,
      },
    ],
    totalMessages: items.length,
    totalChars,
  };
}

/**
 * 注册上下文相关路由。
 */
export function registerControlSessionRoutes(
  params: ControlRouteRegistrationParams,
): void {
  const { app } = params;

  for (const routePath of buildControlRouteAliases("/sessions")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const limit = toLimit(c.req.query("limit"));
        const executingSessionIds = new Set<string>(
          runtime.sessions.list_executing_session_ids(),
        );
        const sessions = await list_control_session_summaries(
          runtime.sessions,
          limit,
        );
        const hasCityChatSession = sessions.some(
          (item) => String(item.sessionId || "").trim() === CITY_CHAT_SESSION_ID,
        );
        const enrichedSessions = hasCityChatSession
          ? sessions
          : [
              {
                sessionId: CITY_CHAT_SESSION_ID,
                messageCount: 0,
                updatedAt: Date.now(),
                lastRole: "system" as const,
                lastText: "City chat",
                channel: "city",
                ...(executingSessionIds.has(CITY_CHAT_SESSION_ID) ? { executing: true } : {}),
              },
              ...sessions,
            ];
        return c.json({
          success: true,
          sessions: enrichedSessions,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/sessions/:sessionId/messages")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const limit = toLimit(c.req.query("limit"), 200);
        const sessionId = decodeMaybe(String(c.req.param("sessionId") || "").trim());
        if (!sessionId) {
          return c.json({ success: false, error: "Missing sessionId" }, 400);
        }

        const session = await runtime.sessions.get(sessionId);
        const history = await read_recent_session_messages(session, limit);
        const sliced = history.items.flatMap((message) =>
          to_session_message_timeline_events(message)
        );
        return c.json({
          success: true,
          sessionId,
          total: sliced.length,
          rawTotal: history.total,
          messages: sliced,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/sessions/:sessionId/messages")) {
    app.delete(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const sessionId = decodeMaybe(String(c.req.param("sessionId") || "").trim());
        if (!sessionId) {
          return c.json({ success: false, error: "Missing sessionId" }, 400);
        }

        await runtime.sessions.clear_messages(sessionId);
        return c.json({
          success: true,
          sessionId,
          cleared: true,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/sessions/:sessionId/chat-history")) {
    app.delete(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const sessionId = decodeMaybe(String(c.req.param("sessionId") || "").trim());
        if (!sessionId) {
          return c.json({ success: false, error: "Missing sessionId" }, 400);
        }

        const result = await runtime.plugins.runAction({
          plugin: "chat",
          action: "history_clear",
          payload: { sessionId },
        });
        if (!result.success) {
          throw new Error(result.error || result.message || "Chat history clear failed");
        }

        return c.json({
          success: true,
          sessionId,
          cleared: true,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/system-prompt")) {
    app.get(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const sessionId =
          decodeMaybe(String(c.req.query("sessionId") || "").trim()) ||
          CITY_CHAT_SESSION_ID;
        const systemMessages = await resolveSessionSystemMessages({
          projectRoot: runtime.rootPath,
          sessionId,
          profile: "chat",
          staticSystemPrompts: [...runtime.systems],
          context: params.getAgentContext(),
        });
        return c.json({
          success: true,
          sessionId,
          ...toSystemPromptPayload(systemMessages),
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const routePath of buildControlRouteAliases("/sessions/:sessionId/execute")) {
    app.post(routePath, async (c) => {
      try {
        const runtime = params.getAgentContext();
        const sessionId = decodeMaybe(String(c.req.param("sessionId") || "").trim());
        const body = (await c.req.json().catch(() => ({}))) as Partial<ControlSessionExecuteRequestBody>;
        const instructions = String(body.instructions || "").trim();
        if (!sessionId) {
          return c.json({ success: false, error: "Missing sessionId" }, 400);
        }
        if (!instructions) {
          return c.json({ success: false, error: "Missing instructions" }, 400);
        }

        const result = await executeBySessionId({
          agentState: runtime,
          sessionId,
          instructions,
          attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
        });
        return c.json({
          success: true,
          sessionId,
          result,
        });
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    });
  }

}
