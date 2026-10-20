/**
 * HTTP 请求级 Power 通道：独立 NDJSON 执行流及结果提交。
 * 通道绑定当前认证凭据、Session 和来源分区，普通消息订阅不能执行 Action。
 */
import { createHash } from "node:crypto";
import type { Hono, Context } from "hono";
import type { AgentSessionPromptInput, AgentSessionTurnHandle } from "@downcity/agent";
import type { PromptPowerResult } from "@downcity/type";
import { ServerPromptPowerChannel } from "@/city/transport/session/PromptPowerChannel.js";
import type { RemotePromptInput } from "@/types/remote/PromptPowerTransport.js";

/** HTTP 通道路由安装；返回 Prompt 解码入口，禁止 wire 描述直接进入 Agent。 */
export function register_prompt_power_routes(app: Hono, get_session: (id: string, origin?: string) => Promise<unknown>) {
  const channels = new Map<string, ServerPromptPowerChannel>();
  const owner_key = (c: Context) => createHash("sha256").update(c.req.header("authorization") ?? "").update("\0").update(c.req.header("cookie") ?? "").digest("hex");
  const session_key = (c: Context) => JSON.stringify([owner_key(c), c.req.param("session_id"), c.req.query("origin_type") || "work"]);
  const channel_key = (c: Context, id: string) => `${session_key(c)}:${id}`;

  app.get("/api/sdk/sessions/:session_id/power-executions/events", async (c) => {
    await get_session(c.req.param("session_id"), c.req.query("origin_type"));
    const encoder = new TextEncoder();
    let channel: ServerPromptPowerChannel;
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        channel = new ServerPromptPowerChannel(session_key(c), (event) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        });
        const key = channel_key(c, channel.id);
        channels.set(key, channel);
        cleanup = () => {
          channels.delete(key);
          c.req.raw.signal.removeEventListener("abort", cleanup);
          channel.close();
          try { controller.close(); } catch { /* 流可能已经由客户端取消。 */ }
        };
        channel.abort_controller.signal.addEventListener("abort", cleanup, { once: true });
        c.req.raw.signal.addEventListener("abort", cleanup, { once: true });
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "ready", channel_id: channel.id })}\n`));
        if (c.req.raw.signal.aborted) cleanup();
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  });

  app.post("/api/sdk/sessions/:session_id/power-executions/:channel_id/results", async (c) => {
    const channel = channels.get(channel_key(c, c.req.param("channel_id")));
    if (!channel) return c.json({ success: false, error: "Power channel unavailable" }, 404);
    const text = await c.req.text();
    if (Buffer.byteLength(text) > 1048576) return c.json({ success: false, error: "Power result exceeds 1 MiB" }, 413);
    try {
      channel.result(JSON.parse(text) as PromptPowerResult);
      return c.json({ success: true });
    } catch (error) { return c.json({ success: false, error: String(error) }, 400); }
  });

  app.post("/api/sdk/sessions/:session_id/power-executions/:channel_id/close", (c) => {
    const key = channel_key(c, c.req.param("channel_id"));
    channels.get(key)?.close();
    channels.delete(key);
    return c.json({ success: true });
  });

  return async (c: Context, input: RemotePromptInput, prompt: (input: AgentSessionPromptInput) => Promise<AgentSessionTurnHandle>) => {
    const { powers, execution_channel_id, ...base } = input;
    if (!powers?.length) {
      if (execution_channel_id) throw new Error("Power channel requires Powers");
      return await prompt(base);
    }
    const key = channel_key(c, execution_channel_id ?? "");
    const channel = channels.get(key);
    if (!channel) throw new Error("Power execution channel unavailable");
    try {
      const runtime_powers = channel.prepare(input, session_key(c));
      const turn = await prompt({ ...base, powers: runtime_powers });
      void turn.finished.then(() => channel.close(), () => channel.close());
      return turn;
    } catch (error) { channel.close(); throw error; }
  };
}
