/**
 * Plugin HTTP 注入类型。
 *
 * 关键点（中文）
 * - plugin 只声明自己的路由与鉴权策略。
 * - server 装配、代理和鉴权执行仍由宿主负责。
 */

import type { Hono } from "hono";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { AuthRoutePolicy } from "@downcity/type";

/**
 * Plugin HTTP 注入参数。
 */
export interface PluginHttpRegistration {
  /** 该组路由对应的鉴权策略列表。 */
  auth_policies?: AuthRoutePolicy[];
  /** 向 runtime Hono 应用注册路由。 */
  register(params: {
    /** 当前 Hono 应用实例。 */
    app: Hono;
    /** 获取当前统一执行上下文。 */
    get_context: () => PluginContext;
    /** 当前 plugin 稳定名称。 */
    plugin_name: string;
  }): void;
}

/**
 * Plugin HTTP 注入定义。
 */
export interface PluginHttpDefinition {
  /** server HTTP 路由注入（可选）。 */
  server?: PluginHttpRegistration;
}
