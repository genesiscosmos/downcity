/**
 * contact chat 运行时。
 *
 * 关键点（中文）
 * - 一个 contact 固定一条长期对话历史。
 * - 远端收到 chat 后运行本地 agent session，并返回 assistant 文本。
 */

import type { PluginContext } from "@downcity/agent";
import type { ContactChatResponse } from "@/contact/types/ContactChat.js";
import {
  appendContactMessage,
  findContactByInboundToken,
} from "./ContactStore.js";

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
  const reply = result.text.trim();
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
