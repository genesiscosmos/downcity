/**
 * Feedback 服务 HTTP 路由装配模块。
 *
 * 关键说明（中文）
 * - 这里只负责把公开 action 映射到 HTTP 路由
 * - 反馈创建、查询、答复和状态更新全部收敛在 FeedbackService 内部
 */

import type { ServiceInstallContext } from "@downcity/city";
import { require_service_user_identity } from "../shared/service-identity.js";
import type { FeedbackService } from "./service.js";
import type {
  FeedbackCreateInput,
  FeedbackQueryInput,
  FeedbackReplyInput,
  FeedbackStatusUpdateInput,
} from "./types.js";

/**
 * 注册 Feedback 服务的 HTTP 路由。
 */
export function register_feedback_routes(service: FeedbackService, ctx: ServiceInstallContext): void {
  ctx.route({
    method: "POST",
    path: "/send",
    auth: ["user"],
    handler: async (c) => {
      const identity = require_service_user_identity(c);
      const body = await c.json<FeedbackCreateInput>();
      return c.jsonResponse(await service.create(identity.user_id, identity.bureau_id, body));
    },
  });

  ctx.route({
    method: "GET",
    path: "/me",
    auth: ["user"],
    handler: async (c) => {
      const identity = require_service_user_identity(c);
      const input = await c.json<FeedbackQueryInput>();
      return c.jsonResponse({
        items: await service.listUserMessages(identity.user_id, identity.bureau_id, input),
      });
    },
  });

  ctx.route({
    method: "GET",
    path: "/messages",
    auth: ["admin"],
    handler: async (c) => {
      const input = await c.json<FeedbackQueryInput>();
      return c.jsonResponse({ items: await service.listMessages(input) });
    },
  });

  ctx.route({
    method: "POST",
    path: "/reply",
    auth: ["admin"],
    handler: async (c) => {
      const body = await c.json<FeedbackReplyInput>();
      return c.jsonResponse(await service.reply(body));
    },
  });

  ctx.route({
    method: "POST",
    path: "/status",
    auth: ["admin"],
    handler: async (c) => {
      const body = await c.json<FeedbackStatusUpdateInput>();
      return c.jsonResponse(await service.updateStatus(body));
    },
  });
}
