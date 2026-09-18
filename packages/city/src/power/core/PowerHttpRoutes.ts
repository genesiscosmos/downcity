/**
 * PowerHttpRoutes：通用 power HTTP 声明装配工具。
 *
 * 关键点（中文）
 * - 这里只消费调用方传入的 power 集合，不关心 power 来源。
 * - HTTP route 与鉴权策略由 power 自己声明，宿主只负责收集和注册。
 */

import type { Hono } from "hono";
import type { PowerDefinition } from "@/power/index.js";
import type { PowerContext } from "@/power/index.js";
import type { AuthRoutePolicy } from "@downcity/type";

function dedupeAuthPolicies(policies: AuthRoutePolicy[]): AuthRoutePolicy[] {
  const records = new Map<string, AuthRoutePolicy>();
  for (const policy of policies) {
    const key = `${String(policy.method || "*").trim().toUpperCase()}:${String(policy.path || "").trim()}`;
    if (!key.endsWith(":")) records.set(key, policy);
  }
  return [...records.values()];
}

/**
 * 收集全部 power HTTP 鉴权策略。
 */
export function list_power_auth_policies(powers: Iterable<PowerDefinition>): AuthRoutePolicy[] {
  return dedupeAuthPolicies(
    [...powers].flatMap((power) => power.http?.server?.auth_policies || []),
  );
}

/**
 * 注册全部 power HTTP 路由。
 */
export function register_power_http_routes(params: {
  app: Hono;
  get_context: (power_name: string) => PowerContext;
  powers: Iterable<PowerDefinition>;
}): void {
  for (const power of params.powers) {
    power.http?.server?.register({
      app: params.app,
      get_context: () => params.get_context(power.name),
      power_name: power.name,
    });
  }
}
