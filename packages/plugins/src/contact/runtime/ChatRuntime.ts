/**
 * contact chat 运行时。
 *
 * 关键点（中文）
 * - 一个 contact 固定一条长期对话历史。
 * - 远端收到 chat 后运行本地 agent session，并返回 assistant 文本。
 */

import type { PluginContext } from "@downcity/agent";
import type { ContactChatResponse } from "@/contact/types/ContactChat.js";
import type { SessionRecordV1 } from "@downcity/agent";
import {
  appendContactMessage,
  findContactByInboundToken,
} from "./ContactStore.js";

function extractMessageText(message: SessionRecordV1 | null | undefined): string {
  const parts = Array.isArray((message as { parts?: unknown } | null)?.parts)
    ? ((message as { parts: unknown[] }).parts)
    : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: unknown; text?: unknown };
      return item.type === "text" ? String(item.text || "") : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 处理远端 contact chat 消息。
 */
export async function receiveContactChatMessage(params: {
  /**
   * 当前 agent context。
   */
  context: PluginContext;
  /**
   * 入站 contact token。
   */
  token: string;
  /**
   * 消息正文。
   */
  message: string;
}): Promise<ContactChatResponse> {
  const contact = await findContactByInboundToken(params.context.workspace_path, params.token);
  if (!contact || contact.status !== "trusted") {
    return {
      success: false,
      reply: "",
      contactId: "",
      error: "Invalid contact token",
    };
  }

  const now = Date.now();
  await appendContactMessage(params.context.workspace_path, contact.id, {
    role: "remote",
    text: params.message,
    created_at: now,
  });

  const session_id = `contact_${contact.id}`;
  const turn = await params.context.sessions.runtime(session_id).prompt({
    query: params.message,
  });
  const result = await turn.finished;
  const reply = extractMessageText(result.assistant_message);
  await appendContactMessage(params.context.workspace_path, contact.id, {
    role: "local",
    text: reply,
    created_at: Date.now(),
  });

  return {
    success: true,
    reply,
    contactId: contact.id,
  };
}
