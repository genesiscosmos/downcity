/**
 * 请求级 callback 适配：从 canonical User data Part 恢复每次请求，编译为独立完成接收方。
 * 每次请求拥有独立 delivery_id，回调确认和重试复用 SessionCompletions 的可靠日志。
 */
import { createHash } from "node:crypto";
import type { EffectHook, JsonValue, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";
import type { SessionCallbacks } from "@/types/agent/SessionCallback.js";

/** 只匹配宿主写入的结构化 callback 数据，不解析用户正文中的指令。 */
export function compile_session_callbacks(callbacks: SessionCallbacks): EffectHook[] {
  for (const name of Object.keys(callbacks)) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error(`Invalid Session callback name: ${name}`);
  }
  return Object.entries(callbacks).map(([name, callback]) => Object.assign(
    async (value: JsonValue, context: ToolCallContext) => {
      const event = value as unknown as SessionTurnCommittedHookValue;
      for (const message of event.messages) {
        if (message.role !== "user") continue;
        for (const part of message.parts) {
          if (part.type !== "data" || part.data_type !== "session_callback") continue;
          const binding = part.data as { /** 稳定回调名。 */ name: string; /** 业务参数。 */ data: JsonValue; /** 原始请求标识。 */ request_id: string };
          if (binding.name !== name) continue;
          const delivery_id = createHash("sha256").update(JSON.stringify([event.session_id, message.message_id, name])).digest("hex");
          await callback({ delivery_id, request_id: binding.request_id, data: binding.data,
            result: { turn_id: event.turn_id, ...event.result } }, context);
        }
      }
    }, { handler_id: `callback:${name}` },
  ));
}
