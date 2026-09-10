/**
 * Desktop Chat Composer 输入到 Session Prompt 的转换边界。
 *
 * Renderer 只提交完整的 Tiptap JSON 文档；这里按照节点原始顺序投影为 Session
 * `text`、`context` 与 `file` parts，避免在 IPC 两侧维护第二份聊天输入协议。
 */

import type { AgentSessionPromptInput, SessionUserContent } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import { project_chat_composer } from "../../common/chat/chatComposerProjection.ts";
import type { ChatComposerProjectionOptions } from "../../common/types/ChatComposer.ts";

/** 把一份 Tiptap Chat Input 转换成 SDK Session Prompt parts。 */
export function chat_input_to_session_query(input: JSONContent, options?: ChatComposerProjectionOptions): AgentSessionPromptInput["query"] {
  const parts: SessionUserContent[] = project_chat_composer(input, options);
  if (parts.length === 0) throw new Error("message is required");
  return parts;
}
