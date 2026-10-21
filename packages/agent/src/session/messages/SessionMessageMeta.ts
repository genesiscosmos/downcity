/**
 * 用户消息请求记账（`messages.meta`）的构建与读取。
 *
 * 背景（中文）
 * - 本条消息「由谁发起」以及本次请求独有的绑定，属于消息级只读数据，不是用户撰写的内容。
 *   它保存在 `SessionUserMessage.meta`，不进入 `parts`，因此既不参与模型上下文，
 *   也不会被消息编辑器恢复、渲染或原样回传。
 * - 写成 data Part 曾被用于承载这些数据；那会让身份与用户可编辑的内容同构，
 *   编辑器往返就能覆盖真实发起方。本模块是该数据的唯一写入契约。
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

/**
 * 读取任意消息的请求记账。
 *
 * 只有用户消息可能携带它；Agent 消息、缺失消息与解码后没有记账的消息都返回 undefined。
 */
export function read_session_message_meta(
  message: SessionMessage | null | undefined,
): SessionMessageMeta | undefined {
  return message?.role === "user" ? message.meta : undefined;
}
