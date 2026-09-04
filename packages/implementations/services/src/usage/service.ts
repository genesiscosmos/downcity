/**
 * Downcity 用户用量聚合服务。
 *
 * UsageService 不拥有事实表。它并行读取 AIService 的技术用量和 CreditsService
 * 的账务消费，合并为当前 Federation 用户的每日用量响应。
 */

import { InstallableService, httpError, type ServiceInstallContext } from "@downcity/federation";
import { CREDITS_PER_USD } from "../types/Amount.js";
import { merge_daily_usage } from "./aggregation.js";
import {
  build_admin_usage_overview,
  build_admin_usage_retention,
  build_admin_usage_users,
} from "./admin-aggregation.js";
import type { UsageServiceOptions } from "./types/Usage.js";
import {
  create_recent_usage_cursor,
  validate_admin_usage_query,
  validate_recent_usage_query,
  validate_usage_query,
} from "./validation.js";

/** 当前用户 Credits 与 AI 技术用量聚合服务。 */
export class UsageService extends InstallableService {
  readonly id = "usage";
  readonly name = "Usage";
  readonly version = "0.4.0";

  constructor(private readonly options: UsageServiceOptions) {
    super();
    if (!options?.ai_usage_reader || !options?.credits_usage_reader || !options?.account_usage_reader) {
      throw new TypeError("UsageService requires ai_usage_reader, credits_usage_reader and account_usage_reader");
    }
    this.instruction = [
      "聚合当前用户的已入账 Credits 消费与 AI 技术用量。",
      "Credits 与 AI Usage 是独立事实，不能互相反推。",
      "用户通过 me 查询最长 400 个当地自然日的每日数据。",
      "用户通过 me/recent 分页查询最近的单次 AI Token 用量。",
      "持有有效 Admin Session 的 Federation 管理员通过 admin/overview、admin/users 和 admin/retention 查询跨用户分析。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    ctx.route({
      method: "GET",
      path: "/me",
      auth: ["user"],
      handler: async (request_ctx) => {
        const user_id = request_ctx.user?.user_id;
        if (!user_id) throw httpError(401, "Unauthorized");
        const url = new URL(request_ctx.request.url);
        const query = validate_usage_query({
          user_id,
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          timezone: url.searchParams.get("timezone"),
        });
        const [ai, credits] = await Promise.all([
          this.options.ai_usage_reader.aggregate_user_daily_usage(query)
            .catch(() => { throw httpError(500, "AI_USAGE_QUERY_FAILED: AI usage query failed"); }),
          this.options.credits_usage_reader.aggregate_user_daily_charges(query)
            .catch(() => { throw httpError(500, "CREDITS_USAGE_QUERY_FAILED: Credits usage query failed"); }),
        ]);
        try {
          return request_ctx.jsonResponse(merge_daily_usage({
            timezone: query.timezone,
            from: query.from,
            to: query.to,
            credits_per_usd: CREDITS_PER_USD,
            ai,
            credits,
          }));
        } catch {
          throw httpError(500, "USAGE_QUERY_FAILED: usage response could not be constructed");
        }
      },
    });

    ctx.route({
      method: "GET",
      path: "/me/recent",
      auth: ["user"],
      handler: async (request_ctx) => {
        const user_id = request_ctx.user?.user_id;
        if (!user_id) throw httpError(401, "Unauthorized");
        const url = new URL(request_ctx.request.url);
        const query = validate_recent_usage_query({
          user_id,
          limit: url.searchParams.get("limit"),
          cursor: url.searchParams.get("cursor"),
        });
        const result = await this.options.ai_usage_reader.list_user_recent_usage(query)
          .catch(() => { throw httpError(500, "RECENT_AI_USAGE_QUERY_FAILED: recent AI usage query failed"); });
        const last_item = result.items.at(-1);
        if (result.has_more && !last_item) {
          throw httpError(500, "RECENT_AI_USAGE_QUERY_FAILED: recent AI usage page is invalid");
        }
        return request_ctx.jsonResponse({
          items: result.items,
          next_cursor: result.has_more && last_item
            ? create_recent_usage_cursor(last_item)
            : null,
        });
      },
    });

    ctx.route({
      method: "GET",
      path: "/admin/overview",
      auth: ["admin"],
      handler: async (request_ctx) => {
        const query = read_admin_query(request_ctx.request.url);
        const activity_query = { ...query, from: minimum_date(query.from, shift_date(query.to, -29)) };
        const [ai, activity_ai, credits] = await Promise.all([
          this.options.ai_usage_reader.aggregate_admin_usage(query),
          this.options.ai_usage_reader.aggregate_admin_usage(activity_query),
          this.options.credits_usage_reader.aggregate_admin_charges(query),
        ]).catch(() => { throw httpError(500, "ADMIN_USAGE_QUERY_FAILED: admin usage query failed"); });
        return request_ctx.jsonResponse(build_admin_usage_overview({ ...query, ai, activity_ai, credits }));
      },
    });

    ctx.route({
      method: "GET",
      path: "/admin/users",
      auth: ["admin"],
      handler: async (request_ctx) => {
        const query = read_admin_query(request_ctx.request.url);
        const [ai, credits] = await Promise.all([
          this.options.ai_usage_reader.aggregate_admin_usage(query),
          this.options.credits_usage_reader.aggregate_admin_charges(query),
        ]).catch(() => { throw httpError(500, "ADMIN_USAGE_QUERY_FAILED: admin usage query failed"); });
        return request_ctx.jsonResponse(build_admin_usage_users({ ...query, ai, credits }));
      },
    });

    ctx.route({
      method: "GET",
      path: "/admin/retention",
      auth: ["admin"],
      handler: async (request_ctx) => {
        const query = read_admin_query(request_ctx.request.url);
        const [ai, accounts] = await Promise.all([
          this.options.ai_usage_reader.aggregate_admin_usage(query),
          this.options.account_usage_reader.list_usage_account_registrations(),
        ]).catch(() => { throw httpError(500, "ADMIN_RETENTION_QUERY_FAILED: admin retention query failed"); });
        return request_ctx.jsonResponse(build_admin_usage_retention({ ...query, ai, accounts }));
      },
    });
  }
}

function read_admin_query(request_url: string) {
  const url = new URL(request_url);
  return validate_admin_usage_query({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    timezone: url.searchParams.get("timezone"),
  });
}

function shift_date(date: string, offset_days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset_days);
  return value.toISOString().slice(0, 10);
}

function minimum_date(left: string, right: string): string {
  return left < right ? left : right;
}
