/**
 * ChatActionInput：chat plugin runtime 的 CLI 输入映射模块。
 *
 * 关键点（中文）
 * - 这里统一处理命令行到 action payload 的转换。
 * - 所有校验错误都尽量在输入层 fail-fast，避免进入执行层后才发现参数非法。
 * - `chat send` 的 frontmatter / <file> 协议也在这里完成标准化解析。
 */

import type { PluginActionCommandInput } from "@downcity/agent";
import type {
  ChatDeleteActionPayload,
  ChatHistoryActionPayload,
  ChatInfoActionPayload,
  ChatListActionPayload,
  ChatReactActionPayload,
} from "@/chat/types/ChatPluginActionPayload.js";
import { resolveChatKey } from "@/chat/Action.js";
import { resolveChatChannelNameOrThrow } from "@/chat/runtime/ChatChannelFacade.js";
import {
  getBooleanOpt,
  getStringOpt,
  parseOptionalTimestampOrThrow,
  parsePositiveIntOptionOrThrow,
  readHistoryDirectionOrThrow,
} from "./ChatActionInputSupport.js";
export {
  mapChatSendCommandInput,
} from "./ChatSendActionInput.js";

export function mapChatChannelCommandInput(
  input: PluginActionCommandInput,
): { channel?: ReturnType<typeof resolveChatChannelNameOrThrow> } {
  const channelRaw = getStringOpt(input.opts, "channel");
  if (!channelRaw) return {};
  return {
    channel: resolveChatChannelNameOrThrow(channelRaw),
  };
}

export function mapChatListCommandInput(
  input: PluginActionCommandInput,
): ChatListActionPayload {
  const channelRaw = getStringOpt(input.opts, "channel");
  const limitRaw = getStringOpt(input.opts, "limit");
  const q = getStringOpt(input.opts, "q");
  const channel = channelRaw ? resolveChatChannelNameOrThrow(channelRaw) : undefined;
  const limit = limitRaw ? parsePositiveIntOptionOrThrow(limitRaw, "limit") : undefined;
  return {
    ...(channel ? { channel } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
    ...(q ? { q } : {}),
  };
}

export function mapChatInfoCommandInput(
  input: PluginActionCommandInput,
): ChatInfoActionPayload {
  const chat_key = getStringOpt(input.opts, "chat_key");
  const session_id = getStringOpt(input.opts, "session_id");
  return {
    ...(chat_key ? { chat_key } : {}),
    ...(session_id ? { session_id } : {}),
  };
}

export function mapChatHistoryCommandInput(
  input: PluginActionCommandInput,
): ChatHistoryActionPayload {
  const chat_key = getStringOpt(input.opts, "chat_key");
  const session_id = getStringOpt(input.opts, "session_id");
  const direction = readHistoryDirectionOrThrow(
    getStringOpt(input.opts, "direction"),
  );
  const limitRaw = getStringOpt(input.opts, "limit");
  const beforeTs = parseOptionalTimestampOrThrow(
    getStringOpt(input.opts, "beforeTs"),
    "beforeTs",
  );
  const afterTs = parseOptionalTimestampOrThrow(
    getStringOpt(input.opts, "afterTs"),
    "afterTs",
  );
  const limit = limitRaw ? parsePositiveIntOptionOrThrow(limitRaw, "limit") : undefined;

  if (
    typeof beforeTs === "number" &&
    typeof afterTs === "number" &&
    afterTs >= beforeTs
  ) {
    throw new Error("Invalid range: afterTs must be less than beforeTs.");
  }

  return {
    ...(chat_key ? { chat_key } : {}),
    ...(session_id ? { session_id } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
    ...(direction ? { direction } : {}),
    ...(typeof beforeTs === "number" ? { beforeTs } : {}),
    ...(typeof afterTs === "number" ? { afterTs } : {}),
  };
}

export function mapChatReactCommandInput(
  input: PluginActionCommandInput,
): ChatReactActionPayload {
  const chat_key = resolveChatKey({
    chat_key: getStringOpt(input.opts, "chat_key"),
  });
  if (!chat_key) {
    throw new Error(
      "Missing chat_key. Provide --chat-key or ensure DC_CTX_CHAT_KEY is injected in current shell context.",
    );
  }

  const emoji = getStringOpt(input.opts, "emoji");
  const message_id = getStringOpt(input.opts, "message_id");
  const big = getBooleanOpt(input.opts, "big");
  return {
    chat_key,
    ...(emoji ? { emoji } : {}),
    ...(message_id ? { message_id } : {}),
    ...(big ? { big: true } : {}),
  };
}

export function mapChatDeleteCommandInput(
  input: PluginActionCommandInput,
): ChatDeleteActionPayload {
  const chat_key = getStringOpt(input.opts, "chat_key");
  const session_id = getStringOpt(input.opts, "session_id");
  return {
    ...(chat_key ? { chat_key } : {}),
    ...(session_id ? { session_id } : {}),
  };
}
