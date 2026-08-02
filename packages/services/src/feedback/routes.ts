/**
 * Feedback 服务 HTTP 路由装配模块。
 *
 * 关键说明（中文）
 * - 这里只负责把公开 action 映射到 HTTP 路由
 * - 反馈创建、查询、答复和状态更新全部收敛在 FeedbackService 内部
 */

import { httpError, type ServiceInstallContext, type ServiceRouteContext } from "@downcity/city";
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
      const body = await c.json<FeedbackCreateInput>();
      return c.jsonResponse(await service.create(read_user_id(c), read_bureau_id(c), body));
    },
  });

  ctx.route({
    method: "GET",
    path: "/me",
    auth: ["user"],
    handler: async (c) => {
      const input = await c.json<FeedbackQueryInput>();
      return c.jsonResponse({
        items: await service.listUserMessages(read_user_id(c), read_bureau_id(c), input),
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

/**
 * 读取当前用户 ID。
 */
function read_user_id(ctx: ServiceRouteContext): string {
  const user_id = ctx.user?.user_id ?? "";
  if (!user_id) throw httpError(401, "user token required");
  return user_id;
}

/**
 * 读取当前 Bureau ID。
 */
function read_bureau_id(ctx: ServiceRouteContext): string {
  const bureau_id = ctx.bureau?.bureau_id ?? "";
  if (!bureau_id) throw httpError(401, "Bureau user token required");
  return bureau_id;
}
