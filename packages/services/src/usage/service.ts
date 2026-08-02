/**
 * Downcity 官方 Usage 服务。
 *
 * 通过全局 hook 记录 service 调用事件。
 * 兼容 Node.js 和 Cloudflare Workers（使用 Web Crypto API）。
 */

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { InstallableService, type ServiceInstallContext, type Context } from "@downcity/city";

/**
 * Usage 服务配置。
 */
export interface UsageServiceOptions {
  /**
   * 是否记录失败的用户侧 service 调用。
   *
   * 默认只记录成功调用；开启后会通过 error hook 记录失败事件。
   */
  record_errors?: boolean;
}

/**
 * Usage 事件表。
 */
export const usageEvents = sqliteTable("service_usage_events", {
  event_id: text("event_id").primaryKey(),
  bureau_id: text("bureau_id").notNull(),
  user_id: text("user_id").notNull(),
  service: text("service").notNull(),
  model_id: text("model_id").notNull(),
  status: text("status").notNull(),
  metadata_json: text("metadata_json").notNull(),
  created_at: text("created_at").notNull(),
});

/**
 * Usage 服务实例。
 */
export class UsageService extends InstallableService {
  readonly id = "usage";
  readonly name = "Usage";
  readonly version = "0.1.0";
  readonly schema = { events: usageEvents };

  constructor(private readonly options: UsageServiceOptions = {}) {
    super();
    this.instruction = [
      "通过全局 hook 记录真实用户侧 service 调用事件。",
      "默认只记录成功调用；record_errors=true 时也会记录失败调用。",
      "常用读取方式是管理端查看 events/summary，用户侧查看 me。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    const events = ctx.table<UsageEventRow>("events");

    ctx.hook.after(async (serviceCtx) => {
      if (!shouldRecordUsage(serviceCtx)) return;
      await events.insert(createUsageEvent(serviceCtx, "success"));
    });

    if (this.options.record_errors) {
      ctx.hook.onError(async (serviceCtx) => {
        if (!shouldRecordUsage(serviceCtx)) return;
        await events.insert(createUsageEvent(serviceCtx, "error"));
      });
    }

    ctx.route({
      method: "GET",
      path: "/events",
      auth: ["admin"],
      async handler(requestCtx) {
        return requestCtx.jsonResponse({ items: await events.select() });
      },
    });

    ctx.route({
      method: "GET",
      path: "/summary",
      auth: ["admin"],
      async handler(requestCtx) {
        return requestCtx.jsonResponse({
          items: summarizeUsage(await events.select()),
        });
      },
    });

    ctx.route({
      method: "GET",
      path: "/me",
      auth: ["user"],
      async handler(requestCtx) {
        return requestCtx.jsonResponse({
          items: await events.select({
            user_id: requestCtx.user?.user_id ?? "",
            bureau_id: requestCtx.bureau?.bureau_id ?? "",
          }),
        });
      },
    });
  }
}

/**
 * 只记录真实用户侧调用。
 *
 * 管理端操作没有 user/bureau 上下文，usage 服务自己的查询也不应反过来
 * 产生 usage 事件，否则统计接口会污染自身结果。
 */
function shouldRecordUsage(ctx: Context): boolean {
  return Boolean(ctx.user?.user_id && ctx.bureau?.bureau_id && ctx.service?.id !== "usage");
}

/**
 * Usage 事件行类型。
 */
interface UsageEventRow extends Record<string, unknown> {
  event_id: string;
  bureau_id: string;
  user_id: string;
  service: string;
  model_id: string;
  status: string;
  metadata_json: string;
  created_at: string;
}

/**
 * 创建 usage 事件记录。
 */
function createUsageEvent(ctx: Context, status: "success" | "error"): UsageEventRow {
  return {
    event_id: `usage_${randomId()}`,
    bureau_id: ctx.bureau?.bureau_id ?? "",
    user_id: ctx.user?.user_id ?? "",
    service: ctx.service?.id ?? "",
    model_id: ctx.variant?.id ?? "",
    status,
    metadata_json: JSON.stringify({
      variant: ctx.variant?.id,
      started_at: ctx.started_at?.toISOString(),
      ended_at: ctx.ended_at?.toISOString(),
      error: ctx.error?.message,
    }),
    created_at: new Date().toISOString(),
  };
}

/**
 * 汇总 usage 事件。
 */
function summarizeUsage(rows: UsageEventRow[]) {
  const byKey = new Map<string, { bureau_id: string; service: string; status: string; count: number }>();
  for (const row of rows) {
    const key = `${row.bureau_id}\u0000${row.service}\u0000${row.status}`;
    const current = byKey.get(key) ?? { bureau_id: row.bureau_id, service: row.service, status: row.status, count: 0 };
    current.count += 1;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.bureau_id}:${a.service}:${a.status}`.localeCompare(`${b.bureau_id}:${b.service}:${b.status}`),
  );
}

/**
 * 生成随机 ID（兼容 Node 和 Workers）。
 */
function randomId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
