/**
 * 绑定单个 Agent 的 interactions HTTP SDK 路由。
 *
 * 复用 Session transport 的 NDJSON ready 帧；只投影 canonical 变化，不保存交互状态。
 * 主体由 AgentHTTP 实例确定，响应引用不得覆盖 Agent；私密答案只进入 submit_private。
 * 本模块不记录请求体，私密入口的错误固定且响应禁止缓存。
 */
import type { Hono } from "hono";
import type { Agent } from "@downcity/agent";
import { validate_interaction_list_input, validate_interaction_response_input } from "@/remote/InteractionValidation.js";

/** 注册单一 Agent 的列表、订阅、普通响应及专用私密提交入口。 */
export function register_sdk_interaction_routes(app: Hono, agent: Agent): void {
  const interactions = agent.interactions;
  app.get("/api/sdk/interactions", async (c) => {
    let input;
    try {
      const query = c.req.query();
      input = validate_interaction_list_input({
        ...query,
        ...(query.limit !== undefined ? { limit: query.limit.trim() ? Number(query.limit) : NaN } : {}),
      });
    } catch {
      return c.json({ success: false, error: "Invalid Agent interactions list input" }, 400);
    }
    try {
      c.header("Cache-Control", "no-store");
      return c.json({ success: true, interactions: await interactions.list(input) });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : "Agent interactions list failed" }, 500);
    }
  });

  app.get("/api/sdk/interactions/events", (c) => {
    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;
    let cleanup = (): void => {};
    const stream = new ReadableStream<Uint8Array>({
      cancel() { cleanup(); },
      start(controller) {
        let closed = false;
        let unsubscribe = (): void => {};
        const close = (): void => {
          if (closed) return;
          closed = true;
          cleanup();
          try { controller.close(); } catch { /* 读取端可能已经取消。 */ }
        };
        cleanup = () => { unsubscribe(); signal.removeEventListener("abort", close); };
        const write_line = (value: unknown): void => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); }
          catch { close(); }
        };
        try {
          unsubscribe = interactions.subscribe(write_line);
          if (signal.aborted) { close(); return; }
          signal.addEventListener("abort", close, { once: true });
          write_line({ type: "sdk-events-ready" });
        } catch {
          close();
        }
      },
    });
    return new Response(stream, { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  });

  app.post("/api/sdk/interactions/respond", async (c) => {
    let input;
    try { input = validate_interaction_response_input(await c.req.json()); }
    catch { return c.json({ success: false, error: "Invalid Agent interaction response input" }, 400); }
    try {
      c.header("Cache-Control", "no-store");
      return c.json({ success: true, result: await interactions.respond(input) });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : "Agent interaction response failed" }, 500);
    }
  });

  app.post("/api/sdk/interactions/submit-private", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const input = validate_interaction_response_input(await c.req.json());
      return c.json({ success: true, result: await interactions.submit_private(input) });
    } catch {
      // 不把解析、校验、宿主或底层 Session 抛出的原始异常传给日志中间件。
      return c.json({ success: false, error: "Private Agent interaction submission failed" }, 400);
    }
  });
}
