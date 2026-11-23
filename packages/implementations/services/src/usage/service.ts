/**
 * Downcity 用户用量聚合服务。
 *
 * UsageService 不拥有事实表。它并行读取 AIService 的技术用量和 CreditsService
 * 的账务消费，合并为当前 Downtown 用户的每日用量响应。
 */

import { InstallableService, httpError, type ServiceInstallContext } from "@downcity/downtown";
import { CREDITS_PER_USD } from "../types/Amount.js";
import { usage_documentation } from "./documentation.js";
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
    super(undefined, {
      description: "Read-only aggregation of independently recorded Credits charges, AI technical usage and account registrations.",
      requirements: ["ai_usage_reader with daily, recent and admin reads", "credits_usage_reader with daily and admin charges", "account_usage_reader with registrations", "User Token or Admin Session as declared by each action"],
      availability: () => {
        if (!this._authenticator) return { status: "unavailable", reason: "Usage authentication runtime is not installed." };
        const readers = this.options;
        if (typeof readers.ai_usage_reader.aggregate_user_daily_usage !== "function"
          || typeof readers.ai_usage_reader.list_user_recent_usage !== "function"
          || typeof readers.ai_usage_reader.aggregate_admin_usage !== "function"
          || typeof readers.credits_usage_reader.aggregate_user_daily_charges !== "function"
          || typeof readers.credits_usage_reader.aggregate_admin_charges !== "function"
          || typeof readers.account_usage_reader.list_usage_account_registrations !== "function") {
          return { status: "unavailable", reason: "One or more required reader methods are missing." };
        }
        return { status: "unknown", reason: "Reader interfaces are installed; underlying reader readiness cannot be established without executing queries." };
      },
    });
    if (!options?.ai_usage_reader || !options?.credits_usage_reader || !options?.account_usage_reader) {
      throw new TypeError("UsageService requires ai_usage_reader, credits_usage_reader and account_usage_reader");
    }
    this.instruction = [
      "聚合当前用户的已入账 Credits 消费与 AI 技术用量。",
      "Credits 与 AI Usage 是独立事实，不能互相反推。",
      "用户通过 me 查询最长 400 个当地自然日的每日数据。",
      "用户通过 me/recent 分页查询最近的单次 AI Token 用量。",
      "持有有效 Admin Session 的 Downtown 管理员通过 admin/overview、admin/users 和 admin/retention 查询跨用户分析。",
      "配置：构造时显式注入 AI、Credits、Accounts 三个 Reader；本服务不建事实表，也不调用模型。",
      "鉴权：me 与 me/recent 要求 User Token，并强制使用认证用户；管理端入口仅接受 Admin Session。",
      "流程：提供 from/to 当地日期和 IANA timezone 查询每日用量；recent 按返回的 next_cursor 连续分页。",
      "限制：日期区间包含首尾且最多 400 天；recent 默认 20 条、上限 50；数据源失败会返回错误，不以零冒充完整数据。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    ctx.route({
      method: "GET",
      path: "/me",
      documentation: usage_documentation["/me"],
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
      documentation: usage_documentation["/me/recent"],
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
      documentation: usage_documentation["/admin/overview"],
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
      documentation: usage_documentation["/admin/users"],
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
      documentation: usage_documentation["/admin/retention"],
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
