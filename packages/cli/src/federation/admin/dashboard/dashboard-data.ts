/**
 * fed Admin Dashboard 数据读取模块。
 *
 * 关键说明（中文）
 * - 只读取现有 admin endpoints，不要求后端提供 Dashboard 专用 API。
 * - 每个 endpoint 独立容错，方便 Dashboard 在 service 缺失时仍可展示。
 */

import { FederationAdmin } from "@downcity/city";
import type {
  dashboard_raw_data,
  dashboard_record,
  dashboard_service_id,
  dashboard_service_state,
  dashboard_service_state_map,
} from "@/federation/types/AdminDashboard.js";

/**
 * 读取 Dashboard 原始数据。
 */
export async function fetch_dashboard_raw_data(a: FederationAdmin): Promise<dashboard_raw_data> {
  const services = create_initial_service_state();
  const accounts_users = await read_endpoint(services, "accounts", "users", async () =>
    (await a.service("accounts").get<{ items: dashboard_record[] }>("users")).items
  );
  const accounts_sessions = await read_endpoint(services, "accounts", "sessions", async () =>
    (await a.service("accounts").get<{ items: dashboard_record[] }>("sessions")).items
  );
  const usage_events = await read_endpoint(services, "usage", "events", async () =>
    (await a.service("usage").get<{ items: dashboard_record[] }>("events")).items
  );
  const credits_users = await read_endpoint(services, "credits", "users", async () =>
    await a.credits.list_users({ limit: 200 }) as unknown as dashboard_record[]
  );
  const credits_topups = await read_endpoint(services, "credits", "topups", async () =>
    await a.credits.transactions.list({ kind: "topup", limit: 200 }) as unknown as dashboard_record[]
  );
  const payment_payments = await read_endpoint(services, "payment", "payments", async () =>
    (await a.service("payment").get<{ items: dashboard_record[] }>("payments")).items
  );
  const payment_events = await read_endpoint(services, "payment", "events", async () =>
    (await a.service("payment").get<{ items: dashboard_record[] }>("events")).items
  );

  return {
    fetched_at: new Date().toISOString(),
    services,
    accounts_users,
    accounts_sessions,
    usage_events,
    credits_users,
    credits_topups,
    payment_payments,
    payment_events,
  };
}

/**
 * 创建初始服务状态。
 */
function create_initial_service_state(): dashboard_service_state_map {
  return {
    accounts: create_service_state(),
    usage: create_service_state(),
    credits: create_service_state(),
    payment: create_service_state(),
  };
}

/**
 * 创建单个服务状态。
 */
function create_service_state(): dashboard_service_state {
  return {
    status: "missing",
    fetched_endpoints: [],
    message: "",
  };
}

/**
 * 读取单个 endpoint。
 */
async function read_endpoint(
  services: dashboard_service_state_map,
  service_id: dashboard_service_id,
  endpoint: string,
  task: () => Promise<dashboard_record[]>,
): Promise<dashboard_record[]> {
  const state = services[service_id];
  try {
    const rows = await task();
    state.fetched_endpoints.push(endpoint);
    state.status = state.status === "error" ? "partial" : "ready";
    return rows;
  } catch (error) {
    state.status = state.fetched_endpoints.length > 0 ? "partial" : "missing";
    state.message = read_error_message(error);
    return [];
  }
}

/**
 * 读取错误信息。
 */
function read_error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
