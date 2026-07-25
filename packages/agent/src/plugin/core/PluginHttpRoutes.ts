/**
 * PluginHttpRoutes：通用 plugin HTTP 声明装配工具。
 *
 * 关键点（中文）
 * - 这里只消费调用方传入的 plugin 集合，不关心 plugin 来源。
 * - HTTP route 与鉴权策略由 plugin 自己声明，宿主只负责收集和注册。
 */

import type { Hono } from "hono";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
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
 * 收集全部 plugin HTTP 鉴权策略。
 */
export function list_plugin_auth_policies(plugins: Iterable<Plugin>): AuthRoutePolicy[] {
  return dedupeAuthPolicies(
    [...plugins].flatMap((plugin) => plugin.http?.server?.auth_policies || []),
  );
}

/**
 * 注册全部 plugin HTTP 路由。
 */
export function register_plugin_http_routes(params: {
  app: Hono;
  get_context: () => PluginContext;
  plugins: Iterable<Plugin>;
}): void {
  for (const plugin of params.plugins) {
    plugin.http?.server?.register({
      app: params.app,
      get_context: params.get_context,
      plugin_name: plugin.name,
    });
  }
}
