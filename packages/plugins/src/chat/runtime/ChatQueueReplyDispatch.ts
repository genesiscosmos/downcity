/**
 * ChatQueueReplyDispatch：chat queue worker 的回复分发模块。
 *
 * 关键点（中文）
 * - 收敛 direct / fallback 两类 channel 回发逻辑。
 * - ChatQueueWorker 主类只保留“何时分发”的决策，不再承载具体发消息细节。
 */

import type { Logger } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import { parseDirectDispatchAssistantText } from "./DirectDispatchParser.js";
import { sendActionByChatKey } from "./ChatkeySend.js";
import { sendChatTextByChatKey } from "../Action.js";
import {
  emitChatReplyEffect,
  prepareChatReplyText,
  resolveChatReplyTarget,
} from "./ReplyDispatch.js";

/**
 * 把 assistant 纯文本直接投递到 chat。
 */
export async function dispatchAssistantTextDirect(params: {
  logger: Logger;
  context: PluginContext;
  session_id: string;
  assistantText: string;
  phase?: "step" | "final" | "error";
}): Promise<boolean> {
  const plan = parseDirectDispatchAssistantText({
    assistantText: params.assistantText,
    fallbackChatKey: params.session_id,
  });
  if (!plan) return false;
  let textDispatchSucceeded = false;

  if (plan.text) {
    const target = await resolveChatReplyTarget({
      context: params.context,
      chat_key: plan.text.chat_key,
    });
    const preparedText = await prepareChatReplyText({
      context: params.context,
      input: {
        chat_key: plan.text.chat_key,
        ...(target.channel ? { channel: target.channel } : {}),
        ...(typeof target.chatId === "string" ? { chatId: target.chatId } : {}),
        ...(typeof plan.text.message_id === "string"
          ? { message_id: plan.text.message_id }
          : typeof target.message_id === "string"
            ? { message_id: target.message_id }
            : {}),
        text: plan.text.text,
        phase: params.phase || "final",
        mode: "direct",
      },
    });
    const textResult = await sendChatTextByChatKey({
      context: params.context,
      chat_key: plan.text.chat_key,
      text: preparedText,
      reply_to_message: plan.text.reply_to_message,
      message_id: plan.text.message_id,
      ...(typeof plan.text.delay_ms === "number"
        ? { delay_ms: plan.text.delay_ms }
        : {}),
      ...(typeof plan.text.send_at_ms === "number"
        ? { send_at_ms: plan.text.send_at_ms }
        : {}),
    });
    await emitChatReplyEffect({
      context: params.context,
      input: {
        chat_key: plan.text.chat_key,
        ...(target.channel ? { channel: target.channel } : {}),
        ...(typeof target.chatId === "string" ? { chatId: target.chatId } : {}),
        ...(typeof plan.text.message_id === "string"
          ? { message_id: plan.text.message_id }
          : typeof target.message_id === "string"
            ? { message_id: target.message_id }
            : {}),
        text: preparedText,
        phase: params.phase || "final",
        mode: "direct",
        success: textResult.success,
        ...(textResult.success ? {} : { error: textResult.error || "chat send failed" }),
      },
    });
    if (!textResult.success) {
      params.logger.warn("Direct chat text dispatch failed", {
        session_id: params.session_id,
        targetChatKey: plan.text.chat_key,
        error: textResult.error || "chat send failed",
      });
    } else {
      textDispatchSucceeded = true;
    }
  }

  for (const reaction of plan.reactions) {
    const reactResult = await sendActionByChatKey({
      context: params.context,
      chat_key: reaction.chat_key,
      action: "react",
      message_id: reaction.message_id,
      reactionEmoji: reaction.emoji,
      reactionIsBig: reaction.big,
    });
    if (!reactResult.success) {
      params.logger.warn("Direct chat reaction dispatch failed", {
        session_id: params.session_id,
        targetChatKey: reaction.chat_key,
        error: reactResult.error || "chat react failed",
      });
    }
  }

  return textDispatchSucceeded;
}

/**
 * 强制把文本回发到 channel。
 */
export async function dispatchTextToChannel(params: {
  logger: Logger;
  context: PluginContext;
  session_id: string;
  text: string;
  message_id?: string;
  phase?: "step" | "final" | "error";
}): Promise<boolean> {
  const text = String(params.text || "").trim();
  if (!text) return false;
  const target = await resolveChatReplyTarget({
    context: params.context,
    chat_key: params.session_id,
  });
  const preparedText = await prepareChatReplyText({
    context: params.context,
    input: {
      chat_key: params.session_id,
      ...(target.channel ? { channel: target.channel } : {}),
      ...(typeof target.chatId === "string" ? { chatId: target.chatId } : {}),
      ...(typeof params.message_id === "string"
        ? { message_id: params.message_id }
        : typeof target.message_id === "string"
          ? { message_id: target.message_id }
          : {}),
      text,
      phase: params.phase || "final",
      mode: "fallback",
    },
  });

  const result = await sendChatTextByChatKey({
    context: params.context,
    chat_key: params.session_id,
    text: preparedText,
    reply_to_message: true,
    ...(typeof params.message_id === "string" && params.message_id
      ? { message_id: params.message_id }
      : {}),
  });
  await emitChatReplyEffect({
    context: params.context,
    input: {
      chat_key: params.session_id,
      ...(target.channel ? { channel: target.channel } : {}),
      ...(typeof target.chatId === "string" ? { chatId: target.chatId } : {}),
      ...(typeof params.message_id === "string"
        ? { message_id: params.message_id }
        : typeof target.message_id === "string"
          ? { message_id: target.message_id }
          : {}),
      text: preparedText,
      phase: params.phase || "final",
      mode: "fallback",
      success: result.success,
      ...(result.success ? {} : { error: result.error || "chat send failed" }),
    },
  });

  if (!result.success) {
    params.logger.warn("ChatQueueWorker forced channel dispatch failed", {
      session_id: params.session_id,
      error: result.error || "chat send failed",
    });
    return false;
  }
  return true;
}
