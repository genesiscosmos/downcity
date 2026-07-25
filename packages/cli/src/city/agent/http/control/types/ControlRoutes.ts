/**
 * Control 路由注册类型定义。
 *
 * 关键点（中文）
 * - 统一描述单 agent 控制面路由的公共依赖。
 * - 各路由模块共享同一份入参，避免重复声明与漂移。
 */

import type { Hono } from "hono";
import type { Agent } from "@downcity/agent";

/**
 * Control 路由注册入参。
 */
export interface ControlRouteRegistrationParams {
  /**
   * Hono 应用实例。
   */
  app: Hono;

  /**
   * 读取当前统一执行上下文。
   */
  get_agent: () => Agent;
}
