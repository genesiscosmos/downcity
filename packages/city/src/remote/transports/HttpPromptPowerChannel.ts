/** HTTP 请求级 Power 执行流；握手后立即返回，后台读取控制消息。 */
import type { OpenPromptPowerChannel, PromptPowerChannel } from "@/types/remote/PromptPowerTransport.js";
import type { PromptPowerEvent } from "@downcity/type";

/** 建立经过认证的 NDJSON 通道，并在 ready 前拒绝失败。 */
export async function open_http_power_channel(
  url: string,
  headers: Headers,
  input: OpenPromptPowerChannel,
): Promise<PromptPowerChannel> {
  const controller = new AbortController();
  const handshake_timer = setTimeout(() => controller.abort(new Error("Power channel ready timeout")), 15000);
  let closed = false;
  let resolve_ready!: (channel: PromptPowerChannel) => void;
  let reject_ready!: (error: unknown) => void;
  const ready = new Promise<PromptPowerChannel>((resolve, reject) => { resolve_ready = resolve; reject_ready = reject; });
  void (async () => {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Power channel HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let channel_id: string | undefined;
    const post = async (suffix: string, body?: unknown) => {
      const target = new URL(url);
      target.pathname = target.pathname.replace(/\/events$/, `/${encodeURIComponent(channel_id!)}/${suffix}`);
      const result = await fetch(target, { method: "POST", headers: new Headers([...headers, ["Content-Type", "application/json"]]), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw new Error(`Power channel result HTTP ${result.status}`);
      const payload = await result.json() as { success?: boolean; error?: string };
      if (!payload.success) throw new Error(payload.error || "Power channel request failed");
    };
    try {
      while (!closed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 2097152) throw new Error("Power event frame too large");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as PromptPowerEvent | { type: "ready"; channel_id: string };
          if (event.type === "ready") {
            if (channel_id) throw new Error("Duplicate Power channel ready");
            channel_id = event.channel_id;
            clearTimeout(handshake_timer);
            resolve_ready({
              id: channel_id,
              result: async (result) => { if (!closed) await post("results", result); },
              close: async () => {
                if (closed) return;
                closed = true;
                controller.abort();
                await post("close").catch(() => {});
              },
            });
          } else {
            if (!channel_id) throw new Error("Power event before ready");
            input.on_event(event);
          }
        }
      }
      if (!closed) throw new Error("Power execution stream closed");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  })().catch((error) => {
    clearTimeout(handshake_timer);
    reject_ready(error);
    if (!closed) { closed = true; controller.abort(); input.on_close(error); }
  });
  return await ready;
}
