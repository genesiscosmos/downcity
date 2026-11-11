/**
 * Session 输入请求记账的构建与读取。
 *
 * 真人输入的身份保存在 User Message.meta；自动执行输入的身份保存在 Inbox Part.meta。
 * 这些字段仅由受信接收边界写入，不参与模型上下文和用户内容编辑。
 */

import type { SessionMessage, SessionMessageMeta } from "@downcity/type";
import type { NormalizedAgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import { describe_prompt_powers } from "@/session/input/PromptPowers.js";

/** 从已归一化调用对象的 prompt 输入构建消息级记账；`from` 始终存在。 */
export function build_session_message_meta(
  input: NormalizedAgentSessionPromptInput,
): SessionMessageMeta {
  return {
    from: structuredClone(input.actor),
    ...(input.powers?.length
      ? {
          powers: JSON.parse(
            JSON.stringify(describe_prompt_powers(input.powers)),
          ) as SessionMessageMeta["powers"],
        }
      : {}),
    ...(input.callback
      ? {
          callback: {
            name: input.callback.name,
            data: input.callback.data ?? null,
            request_id: input.request_id!,
          } as SessionMessageMeta["callback"],
        }
      : {}),
  };
}

/** 读取消息最近一次输入的记账；指定 inbox_id 时只读取对应事件。 */
export function read_session_message_meta(
  message: SessionMessage | null | undefined,
  inbox_id?: string,
): SessionMessageMeta | undefined {
  if (!message) return undefined;
  if (message.role === "user") return message.meta;
  for (const part of [...message.parts].reverse()) {
    if (part.type === "inbox" && part.meta && (!inbox_id || part.inbox_id === inbox_id)) return part.meta;
  }
  return undefined;
}
