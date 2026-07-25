/**
 * QQ Gateway 发送辅助函数。
 *
 * 关键点（中文）
 * - 这里统一处理消息投递地址、超时、自动重试与自愈触发。
 * - `QQGatewayClient` 只保留发送入口与状态持有，不再直接展开长流程。
 */

import type { Logger } from "@downcity/agent";
import type { QQSendMessageBody } from "@/chat/channels/qq/types/QqChannel.js";
import {
  isRetryableQqSendFailure,
  resolveQqApiErrorText,
  waitBeforeQqSendRetry,
} from "./QQSendSupport.js";

/**
 * 单次发送请求构造结果。
 */
export interface QqSendRequest {
  /**
   * 请求 URL。
   */
  url: string;
  /**
   * 请求体。
   */
  body: QQSendMessageBody;
}

/**
 * QQ 发送重试流程参数。
 */
export interface SendQqMessageWithRetryParams {
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * OpenAPI 基础地址。
   */
  apiBase: string;
  /**
   * 会话 ID。
   */
  chatId: string;
  /**
   * 会话类型。
   */
  chatType: string;
  /**
   * 原始消息 ID。
   */
  message_id: string;
  /**
   * 文本内容。
   */
  text: string;
  /**
   * QQ 消息序号。
   */
  msgSeq: number;
  /**
   * 最大重试次数。
   */
  maxAttempts: number;
  /**
   * 单次 HTTP 超时时间。
   */
  requestTimeoutMs: number;
  /**
   * 获取鉴权 token 的回调。
   */
  getAuthToken: () => Promise<string>;
  /**
   * 发送失败后清理 token 缓存的回调。
   */
  clearAccessTokenCache: () => void;
  /**
   * 发送失败后主动关闭 ws 的回调。
   */
  closeSocketForRecovery: (reason: string) => void;
  /**
   * 发送失败后触发重连的回调。
   */
  scheduleReconnect: (reason: string, delay_ms?: number) => void;
}

function buildQqSendRequest(params: {
  /**
   * OpenAPI 基础地址。
   */
  apiBase: string;
  /**
   * 会话 ID。
   */
  chatId: string;
  /**
   * 会话类型。
   */
  chatType: string;
  /**
   * 原始消息 ID。
   */
  message_id: string;
  /**
   * 文本内容。
   */
  text: string;
  /**
   * QQ 消息序号。
   */
  msgSeq: number;
}): QqSendRequest {
  let url = "";
  const body: QQSendMessageBody = {
    content: params.text,
    msg_type: 0,
    msg_id: params.message_id,
    msg_seq: params.msgSeq,
  };

  switch (params.chatType) {
    case "group":
      url = `${params.apiBase}/v2/groups/${params.chatId}/messages`;
      break;
    case "c2c":
      url = `${params.apiBase}/v2/users/${params.chatId}/messages`;
      break;
    case "channel":
      url = `${params.apiBase}/channels/${params.chatId}/messages`;
      break;
    default:
      throw new Error(`未知的聊天类型: ${params.chatType}`);
  }

  return { url, body };
}

async function postQqMessageOnce(params: {
  /**
   * 日志器。
   */
  logger: Logger;
  /**
   * 请求 URL。
   */
  url: string;
  /**
   * 请求体。
   */
  body: QQSendMessageBody;
  /**
   * 单次 HTTP 超时时间。
   */
  requestTimeoutMs: number;
  /**
   * 获取鉴权 token 的回调。
   */
  getAuthToken: () => Promise<string>;
}): Promise<{ status: number; responseText: string }> {
  const authToken = await params.getAuthToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, params.requestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken,
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
  } catch (error) {
    const errorText = String(error);
    if (errorText.toLowerCase().includes("abort")) {
      throw new Error(`QQ send failed: timeout after ${params.requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  if (!response.ok) {
    params.logger.error(`发送消息失败: ${response.status} - ${responseText}`);
    throw new Error(`QQ send failed: HTTP ${response.status}: ${responseText}`);
  }

  const apiError = resolveQqApiErrorText(responseText);
  if (apiError) {
    throw new Error(`QQ send failed: ${apiError}`);
  }
  return { status: response.status, responseText };
}

/**
 * 带自动重试与自愈触发的 QQ 消息发送。
 */
export async function sendQqMessageWithRetry(
  params: SendQqMessageWithRetryParams,
): Promise<void> {
  const request = buildQqSendRequest({
    apiBase: params.apiBase,
    chatId: params.chatId,
    chatType: params.chatType,
    message_id: params.message_id,
    text: params.text,
    msgSeq: params.msgSeq,
  });

  params.logger.debug(`发送消息到: ${request.url}`);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= params.maxAttempts; attempt++) {
    try {
      const { status, responseText } = await postQqMessageOnce({
        logger: params.logger,
        url: request.url,
        body: request.body,
        requestTimeoutMs: params.requestTimeoutMs,
        getAuthToken: params.getAuthToken,
      });
      params.logger.debug(
        `消息发送成功: ${status}${responseText ? ` - ${responseText}` : ""}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const errorText = String(error);
      const shouldRetry =
        attempt < params.maxAttempts && isRetryableQqSendFailure(errorText);
      if (!shouldRetry) {
        throw error;
      }

      params.logger.warn("QQ 回发失败，准备自动重试", {
        attempt,
        maxAttempts: params.maxAttempts,
        chatType: params.chatType,
        chatId: params.chatId,
        message_id: params.message_id,
        error: errorText,
      });
      params.clearAccessTokenCache();
      params.closeSocketForRecovery("send_failed_retry");
      params.scheduleReconnect("send_failed_retry", 0);
      await waitBeforeQqSendRetry(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
