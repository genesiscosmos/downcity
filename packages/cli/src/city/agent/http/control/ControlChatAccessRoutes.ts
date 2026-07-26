/**
 * Agent Chat Access Control API。
 *
 * 关键点（中文）
 * - 路由只承担 HTTP 参数适配，数据和业务规则统一由 Chat Plugin Action 处理。
 * - City Auth 保护这些控制面接口，但 Chat Access 本身不是 City Auth 的一部分。
 */

import type { Hono } from "hono";
import type { Agent, JsonValue } from "@downcity/agent";
import type { AgentTokenPrincipal } from "@/city/types/auth/AgentToken.js";
import { CHAT_ACCESS_ACTIONS } from "@downcity/plugins/chat";
import { buildControlRouteAliases } from "@/city/agent/control/CommonHelpers.js";
import type {
  ChatAccessResolveRequestBody,
  ChatAccessControlContextReader,
  ChatAccessRevokeGrantBody,
  ChatAccessSetGrantBody,
} from "@/city/agent/http/control/types/ChatAccessRoutes.js";
import { AUTH_PRINCIPAL_CONTEXT_KEY } from "@/city/runtime/auth/AuthMiddleware.js";

const CHAT_PLUGIN_NAME = "chat";
const CONTROL_OPERATOR = "city-control";

function resolve_control_operator(context: unknown): string {
  const reader = context as ChatAccessControlContextReader;
  const principal = reader.get?.(AUTH_PRINCIPAL_CONTEXT_KEY) as Partial<AgentTokenPrincipal> | undefined;
  const token_id = String(principal?.token_id || "").trim();
  return token_id ? `city-token:${token_id}` : CONTROL_OPERATOR;
}

function normalize_scope(value: unknown): "direct" | "group" | "all" | undefined {
  const scope = String(value || "").trim();
  if (scope === "direct" || scope === "group" || scope === "all") return scope;
  return undefined;
}

/** 执行当前 Agent 的 Chat Access Action。 */
async function run_chat_access_action(input: {
  /** 当前 Agent Context。 */
  context: Agent;
  /** Chat Plugin Action 名称。 */
  action: string;
  /** 传给 Action 的 JSON 数据。 */
  payload?: JsonValue;
}): Promise<JsonValue | undefined> {
  const result = await input.context.plugins.run_action({
    plugin: CHAT_PLUGIN_NAME,
    action: input.action,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });
  if (!result.success) {
    throw new Error(result.error || result.message || "Chat Access action failed");
  }
  return result.data;
}

/** 注册当前 Agent 的 Chat Access 控制面路由。 */
export function register_control_chat_access_routes(input: {
  /** Hono 应用实例。 */
  app: Hono;
  /** 获取当前 Agent Context。 */
  get_agent: () => Agent;
}): void {
  const { app, get_agent } = input;

  for (const route_path of buildControlRouteAliases("/chat/access")) {
    app.get(route_path, async (context) => {
      try {
        const data = await run_chat_access_action({
          context: get_agent(),
          action: CHAT_ACCESS_ACTIONS.snapshot,
        });
        return context.json({ success: true, data });
      } catch (error) {
        return context.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const route_path of buildControlRouteAliases("/chat/access/requests/:request_id/approve")) {
    app.post(route_path, async (context) => {
      try {
        const body = (await context.req.json().catch(() => ({}))) as ChatAccessResolveRequestBody;
        const scope = normalize_scope(body.scope);
        const data = await run_chat_access_action({
          context: get_agent(),
          action: CHAT_ACCESS_ACTIONS.approve,
          payload: {
            request_id: String(context.req.param("request_id") || ""),
            ...(scope ? { scope } : {}),
            operator: resolve_control_operator(context),
          },
        });
        return context.json({ success: true, data });
      } catch (error) {
        return context.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const route_path of buildControlRouteAliases("/chat/access/requests/:request_id/deny")) {
    app.post(route_path, async (context) => {
      try {
        const body = (await context.req.json().catch(() => ({}))) as ChatAccessResolveRequestBody;
        const scope = normalize_scope(body.scope);
        const data = await run_chat_access_action({
          context: get_agent(),
          action: CHAT_ACCESS_ACTIONS.deny,
          payload: {
            request_id: String(context.req.param("request_id") || ""),
            ...(scope ? { scope } : {}),
            operator: resolve_control_operator(context),
          },
        });
        return context.json({ success: true, data });
      } catch (error) {
        return context.json({ success: false, error: String(error) }, 500);
      }
    });
  }

  for (const route_path of buildControlRouteAliases("/chat/access/principals/:principal_id/grants")) {
    app.post(route_path, async (context) => {
      try {
        const body = (await context.req.json().catch(() => ({}))) as ChatAccessSetGrantBody;
        const scope = normalize_scope(body.scope);
        const effect = body.effect === "allow" || body.effect === "deny" ? body.effect : undefined;
        if (!scope || !effect) {
          return context.json({ success: false, error: "scope and effect are required" }, 400);
        }
        const data = await run_chat_access_action({
          context: get_agent(),
          action: CHAT_ACCESS_ACTIONS.set,
          payload: {
            principal_id: String(context.req.param("principal_id") || ""),
            scope,
            effect,
            operator: resolve_control_operator(context),
          },
        });
        return context.json({ success: true, data });
      } catch (error) {
        return context.json({ success: false, error: String(error) }, 500);
      }
    });

    app.delete(route_path, async (context) => {
      try {
        const body = (await context.req.json().catch(() => ({}))) as ChatAccessRevokeGrantBody;
        const scope = normalize_scope(body.scope);
        if (!scope) {
          return context.json({ success: false, error: "scope is required" }, 400);
        }
        const data = await run_chat_access_action({
          context: get_agent(),
          action: CHAT_ACCESS_ACTIONS.revoke,
          payload: {
            principal_id: String(context.req.param("principal_id") || ""),
            scope,
            operator: resolve_control_operator(context),
          },
        });
        return context.json({ success: true, data });
      } catch (error) {
        return context.json({ success: false, error: String(error) }, 500);
      }
    });
  }
}
