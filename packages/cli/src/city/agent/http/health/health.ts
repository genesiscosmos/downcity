/**
 * 健康检查路由模块。
 *
 * 职责说明：
 * 1. 提供基础健康检查接口。
 * 2. 提供当前进程状态接口。
 * 3. 不依赖业务域实现。
 */

import { Hono } from "hono";

/**
 * 健康检查路由。
 */
export const healthRouter = new Hono();

healthRouter.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

healthRouter.get("/api/status", (c) => {
  return c.json({
    name: "downcity",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});
