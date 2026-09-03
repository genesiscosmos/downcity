/**
 * Desktop Chat Composer 输入到 Session Prompt 的转换边界。
 *
 * Renderer 只提交完整的 Tiptap JSON 文档；这里按照节点原始顺序投影为 Session
 * `text`、`context` 与 `file` parts，避免在 IPC 两侧维护第二份聊天输入协议。
 */

import type { AgentSessionPromptInput, SessionPromptPart } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";

/** 引用节点进入 Session Context 时使用的稳定语义标签。 */
const CHAT_REFERENCE_CONTEXT_TAG = "reference";

/** 把一份 Tiptap Chat Input 转换成 SDK Session Prompt parts。 */
export function chat_input_to_session_query(input: JSONContent): AgentSessionPromptInput["query"] {
  if (!input || input.type !== "doc" || !Array.isArray(input.content)) {
    throw new Error("chat input must be a Tiptap document");
  }
  const parts: SessionPromptPart[] = [];
  let pending_text = "";

  const flush_text = () => {
    const text = pending_text.trim();
    pending_text = "";
    if (text) parts.push({ type: "text", text });
  };

  const visit = (node: JSONContent) => {
    if (node.type === "text") {
      pending_text += String(node.text || "");
      return;
    }
    if (node.type === "hardBreak") {
      pending_text += "\n";
      return;
    }
    if (node.type === "chatReference") {
      flush_text();
      const context = String(node.attrs?.text || "");
      if (context.trim()) {
        parts.push({ type: "context", tag: CHAT_REFERENCE_CONTEXT_TAG, context });
      }
      return;
    }
    if (node.type === "chatAttachment") {
      flush_text();
      const url = String(node.attrs?.data_url || "");
      if (!url.startsWith("data:")) throw new Error("attachment must use a data URL");
      parts.push({
        type: "file",
        media_type: String(node.attrs?.media_type || "application/octet-stream"),
        url,
        filename: String(node.attrs?.filename || "attachment"),
      });
      return;
    }

    node.content?.forEach(visit);
    if (node.type === "paragraph") pending_text += "\n";
  };

  visit(input);
  flush_text();
  if (parts.length === 0) throw new Error("message is required");
  return parts;
}
