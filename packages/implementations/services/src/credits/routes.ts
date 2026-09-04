/**
 * Credits Service HTTP 路由。
 *
 * 用户只能读取自己的 Credits；Card 创建、Topup 与 Charge 由可信管理端执行。
 */

import type { ServiceInstallContext, ServiceRouteContext } from "@downcity/federation";
import type { CreditsService } from "./service.js";
import type {
  CreditsChargeInput,
  CreditsEphemeralCardCreateInput,
  CreditsTopupInput,
} from "./types/Input.js";
import { read_required_text } from "./utils.js";

interface CreditsQueryBody extends Record<string, unknown> {
  /** 可选用户 ID。 */
  user_id?: string;
  /** 可选 Transaction 类型。 */
  kind?: string;
  /** 可选 Transaction ID。 */
  transaction_id?: string;
  /** 是否包含历史 Card。 */
  include_history?: boolean;
  /** 返回条数上限。 */
  limit?: string | number;
}

/** 注册 Credits Service 路由。 */
export function register_credits_routes(service: CreditsService, ctx: ServiceInstallContext): void {
  ctx.route({
    method: "GET",
    path: "/me",
    auth: ["user"],
    handler: async (c) => c.jsonResponse(await service.read_account(read_user_id(c))),
  });
  ctx.route({
    method: "GET",
    path: "/transactions/me",
    auth: ["user"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({ items: await service.list_transactions({ user_id: read_user_id(c), kind: query.kind, limit: query.limit }) });
    },
  });
  ctx.route({
    method: "GET",
    path: "/history/me",
    auth: ["user"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({ items: await service.history({ user_id: read_user_id(c), transaction_id: query.transaction_id, limit: query.limit }) });
    },
  });
  ctx.route({
    method: "GET",
    path: "/users",
    auth: ["admin"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({ items: await service.list_users({ limit: query.limit }) });
    },
  });
  ctx.route({
    method: "GET",
    path: "/users/get",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.read_account(read_required_text(read_query(c).user_id, "user_id"))),
  });
  ctx.route({
    method: "GET",
    path: "/cards/primary",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.cards.get_primary(
      read_required_text(read_query(c).user_id, "user_id"),
    )),
  });
  ctx.route({
    method: "GET",
    path: "/cards/ephemeral/get",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.cards.get_ephemeral(
      read_required_text(new URL(c.request.url).searchParams.get("card_id"), "card_id"),
    )),
  });
  ctx.route({
    method: "GET",
    path: "/cards/ephemeral",
    auth: ["admin"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({
        items: await service.cards.list_ephemeral({
          user_id: query.user_id,
          include_history: read_boolean(query.include_history),
          limit: query.limit,
        }),
      });
    },
  });
  ctx.route({
    method: "GET",
    path: "/transactions",
    auth: ["admin"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({ items: await service.list_transactions(query) });
    },
  });
  ctx.route({
    method: "GET",
    path: "/transactions/get",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.get_transaction(
      read_required_text(read_query(c).transaction_id, "transaction_id"),
    )),
  });
  ctx.route({
    method: "GET",
    path: "/history",
    auth: ["admin"],
    handler: async (c) => {
      const query = read_query(c);
      return c.jsonResponse({ items: await service.history(query) });
    },
  });
  ctx.route({
    method: "POST",
    path: "/cards/ephemeral/create",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.cards.create_ephemeral(
      await c.json<CreditsEphemeralCardCreateInput & Record<string, unknown>>(),
    )),
  });
  ctx.route({
    method: "POST",
    path: "/topups/create",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.topup(
      await c.json<CreditsTopupInput & Record<string, unknown>>(),
    )),
  });
  ctx.route({
    method: "POST",
    path: "/charges/create",
    auth: ["admin"],
    handler: async (c) => c.jsonResponse(await service.charge(
      await c.json<CreditsChargeInput & Record<string, unknown>>(),
    )),
  });
}

function read_user_id(ctx: ServiceRouteContext): string {
  return read_required_text(ctx.user?.user_id, "user_id");
}

function read_query(ctx: ServiceRouteContext): CreditsQueryBody {
  const url = new URL(ctx.request.url);
  return {
    user_id: url.searchParams.get("user_id") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    transaction_id: url.searchParams.get("transaction_id") ?? undefined,
    include_history: url.searchParams.get("include_history") === "true",
    limit: url.searchParams.get("limit") ?? undefined,
  };
}

function read_boolean(value: unknown): boolean {
  return value === true || value === "true";
}
