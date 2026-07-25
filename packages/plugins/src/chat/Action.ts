/**
 * Chat command services.
 *
 * 关键点（中文）
 * - chat 语义（chat_key 与 session_id 映射）统一收口在本模块
 * - Session 运行上下文由 action 入口显式传入
 */

import type { PluginContext } from "@downcity/agent";
import type { PluginRunContext } from "@downcity/agent";
import {
  sendActionByChatKey,
  sendTextByChatKey,
} from "./runtime/ChatkeySend.js";
import { deleteChatSessionById } from "./runtime/ChatSessionDelete.js";
import type { ChatDispatchAction } from "./types/ChatDispatcher.js";
import type {
  ChatSessionSnapshot,
  ChatDeleteResponse,
  ChatReactResponse,
  ChatSendResponse,
} from "./types/ChatCommand.js";

/**
 * 读取字符串环境变量。
 *
 * 关键点（中文）
 * - 自动 trim；空字符串视为未设置。
 */
function readEnvString(name: string): string | undefined {
  const value = String(process.env[name] || "").trim();
  return value ? value : undefined;
}

/**
 * 读取数字环境变量。
 *
 * 关键点（中文）
 * - 解析失败返回 undefined，不抛错。
 */
function readEnvNumber(name: string): number | undefined {
  const raw = readEnvString(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return undefined;
  return parsed;
}

/**
 * 解析 chat 上下文快照。
 *
 * 优先级（中文）
 * 1) 显式参数
 * 2) 显式 PluginRunContext
 * 3) 环境变量回退
 */
export function resolveChatSessionSnapshot(input?: {
  session_id?: string;
  chat_key?: string;
  context?: PluginContext;
  run_context?: PluginRunContext;
}): ChatSessionSnapshot {
  const run_context = input?.run_context;

  const explicitSessionId = String(input?.session_id || "").trim();
  const explicitChatKey = String(input?.chat_key || "").trim();
  const requestSessionId =
    typeof run_context?.session_id === "string" && run_context.session_id.trim()
      ? run_context.session_id.trim()
      : undefined;
  const envSessionId = readEnvString("DC_SESSION_ID");
  const envChatKey = readEnvString("DC_CTX_CHAT_KEY");
  const channel = readEnvString("DC_CTX_CHANNEL") || undefined;
  const chatId =
    readEnvString("DC_CTX_TARGET_ID") || readEnvString("DC_CTX_CHAT_ID");
  const messageThreadId =
    readEnvNumber("DC_CTX_THREAD_ID") ||
    readEnvNumber("DC_CTX_MESSAGE_THREAD_ID");
  const chatType =
    readEnvString("DC_CTX_TARGET_TYPE") ||
    readEnvString("DC_CTX_CHAT_TYPE");
  const user_id =
    readEnvString("DC_CTX_ACTOR_ID") ||
    readEnvString("DC_CTX_USER_ID");
  const message_id = readEnvString("DC_CTX_MESSAGE_ID");
  const session_id =
    explicitSessionId ||
    requestSessionId ||
    envSessionId ||
    explicitChatKey ||
    envChatKey;
  const chat_key =
    explicitChatKey ||
    mapSessionIdToChatKey(session_id) ||
    envChatKey;

  const snapshot: ChatSessionSnapshot = {
    ...(session_id ? { session_id } : {}),
    ...(chat_key ? { chat_key } : {}),
    channel,
    chatId,
    messageThreadId,
    chatType,
    user_id,
    message_id,
  };

  return snapshot;
}

/**
 * 将 session_id 映射为可发送的 chat_key。
 *
 * 关键点（中文）
 * - 当前实现下：chat plugin runtime 内部把 session_id 视作可发送 chat_key。
 * - 不再依赖字符串规则推导（session_id 可为随机值）。
 */
export function mapSessionIdToChatKey(session_id?: string): string | undefined {
  const key = String(session_id || "").trim();
  if (!key) return undefined;
  return key;
}

/**
 * 提取最终 session_id。
 */
export function resolve_session_id(input?: {
  session_id?: string;
  chat_key?: string;
  context?: PluginContext;
  run_context?: PluginRunContext;
}): string | undefined {
  const snapshot = resolveChatSessionSnapshot({
    session_id: input?.session_id,
    chat_key: input?.chat_key,
    context: input?.context,
    run_context: input?.run_context,
  });
  const key = String(snapshot.session_id || "").trim();
  return key ? key : undefined;
}

/**
 * 提取最终 chat_key（用于发送路径）。
 */
export function resolveChatKey(input?: {
  chat_key?: string;
  session_id?: string;
  context?: PluginContext;
  run_context?: PluginRunContext;
}): string | undefined {
  const snapshot = resolveChatSessionSnapshot({
    chat_key: input?.chat_key,
    session_id: input?.session_id,
    context: input?.context,
    run_context: input?.run_context,
  });
  const key = String(snapshot.chat_key || "").trim();
  return key ? key : undefined;
}

/**
 * 解析当前发送应绑定的 reply message_id。
 *
 * 关键点（中文）
 * - 只有显式 reply 且未手动传入 message_id 时才尝试补全。
 * - 仅在目标 chat_key 与当前显式请求上下文一致时，才复用 `DC_CTX_MESSAGE_ID`。
 * - 这样可把一次 run 固定到触发它的那条消息，避免处理中被后续新消息覆盖。
 */
function resolveReplyMessageIdForChatSend(params: {
  chat_key: string;
  context: PluginContext;
  reply_to_message: boolean;
  explicitMessageId?: string;
  run_context?: PluginRunContext;
}): string | undefined {
  const explicitMessageId =
    typeof params.explicitMessageId === "string" && params.explicitMessageId.trim()
      ? params.explicitMessageId.trim()
      : undefined;
  if (explicitMessageId) return explicitMessageId;
  if (params.reply_to_message !== true) return undefined;

  const snapshot = resolveChatSessionSnapshot({
    context: params.context,
    run_context: params.run_context,
  });
  const snapshotChatKey = String(snapshot.chat_key || "").trim();
  const snapshotMessageId = String(snapshot.message_id || "").trim();
  if (!snapshotChatKey || !snapshotMessageId) return undefined;
  return snapshotChatKey === params.chat_key ? snapshotMessageId : undefined;
}

/**
 * 规范化 `chat send` 文本。
 *
 * 关键点（中文）
 * - 当文本只包含字面量转义（如 `\n`）且没有真实换行时，自动解码为真实控制字符。
 * - 这样可兼容模型/脚本把多行文本写成 `\\n` 的场景，避免用户看到原样 `\n`。
 */
export function normalizeChatSendText(raw: string): string {
  const text = String(raw ?? "");
  if (!text) return text;

  const hasRealLineBreak = text.includes("\n") || text.includes("\r");
  let normalized = text;

  if (
    !hasRealLineBreak &&
    (text.includes("\\n") || text.includes("\\r") || text.includes("\\t"))
  ) {
    normalized = text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  return normalized;
}

/**
 * 发送前延迟。
 *
 * 关键点（中文）
 * - 支持延迟毫秒（delay_ms）或绝对时间（send_at_ms）
 * - 超长等待按分片 setTimeout，避免超出 Node 单次定时器上限
 */
function resolveTargetWaitMs(params: {
  delay_ms: number;
  send_at_ms?: number;
}): number {
  const delay_ms = params.delay_ms;
  const send_at_ms = params.send_at_ms;
  const rawWaitMs =
    typeof send_at_ms === "number" ? Math.max(0, send_at_ms - Date.now()) : delay_ms;
  if (!Number.isFinite(rawWaitMs) || Number.isNaN(rawWaitMs) || rawWaitMs <= 0) return 0;
  return Math.trunc(rawWaitMs);
}

async function waitByTimeoutChunks(waitMs: number): Promise<void> {
  if (!Number.isFinite(waitMs) || Number.isNaN(waitMs) || waitMs <= 0) return;
  const MAX_TIMEOUT_MS = 2_147_483_647;
  let remaining = Math.trunc(waitMs);
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMEOUT_MS);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, chunk);
    });
    remaining -= chunk;
  }
}

async function waitBeforeSend(params: {
  delay_ms: number;
  send_at_ms?: number;
}): Promise<void> {
  await waitByTimeoutChunks(resolveTargetWaitMs(params));
}

/**
 * 按 chat_key 发送文本。
 *
 * 关键点（中文）
 * - chat plugin runtime 不关心具体平台；由 runtime sender 做 channel 分发。
 * - 返回统一结构，便于上层链路做可观测与错误汇总。
 */
export async function sendChatTextByChatKey(params: {
  context: PluginContext;
  chat_key: string;
  text: string;
  delay_ms?: number;
  send_at_ms?: number;
  /**
   * 延迟发送是否异步调度（不阻塞当前调用）。
   *
   * 关键点（中文）
   * - 仅在存在有效 delay/sendAt 时生效。
   * - 默认 false，保持 CLI/API 的阻塞行为不变。
   */
  nonBlockingDelay?: boolean;
  reply_to_message?: boolean;
  message_id?: string;
  run_context?: PluginRunContext;
}): Promise<ChatSendResponse> {
  const chat_key = String(params.chat_key || "").trim();
  const text = normalizeChatSendText(String(params.text ?? ""));
  const delay_ms =
    typeof params.delay_ms === "number" && Number.isFinite(params.delay_ms)
      ? Math.max(0, Math.trunc(params.delay_ms))
      : 0;
  const send_at_ms =
    typeof params.send_at_ms === "number" && Number.isFinite(params.send_at_ms)
      ? Math.max(0, Math.trunc(params.send_at_ms))
      : undefined;
  if (!chat_key) {
    return {
      success: false,
      error: "Missing chat_key",
    };
  }
  if (delay_ms > 0 && typeof send_at_ms === "number") {
    return {
      success: false,
      chat_key,
      error: "delay_ms and send_at_ms cannot be used together",
    };
  }

  const reply_to_message = params.reply_to_message === true;
  const message_id = resolveReplyMessageIdForChatSend({
    context: params.context,
    chat_key,
    reply_to_message,
    explicitMessageId: params.message_id,
    run_context: params.run_context,
  });
  const targetWaitMs = resolveTargetWaitMs({ delay_ms, send_at_ms });
  if (params.nonBlockingDelay === true && targetWaitMs > 0) {
    // 关键点（中文）：异步调度延迟发送，让调用方可立即结束当前 run。
    void (async () => {
      try {
        await waitByTimeoutChunks(targetWaitMs);
        const delayed = await sendTextByChatKey({
          context: params.context,
          chat_key,
          text,
          reply_to_message,
          ...(message_id ? { message_id } : {}),
        });
        if (!delayed.success) {
          params.context.logger.warn("Delayed chat send failed", {
            chat_key,
            error: delayed.error || "chat send failed",
          });
        }
      } catch (error) {
        params.context.logger.warn("Delayed chat send failed", {
          chat_key,
          error: String(error),
        });
      }
    })();
    return {
      success: true,
      chat_key,
    };
  }

  await waitBeforeSend({ delay_ms, send_at_ms });

  const result = await sendTextByChatKey({
    context: params.context,
    chat_key,
    text,
    reply_to_message,
    ...(message_id ? { message_id } : {}),
  });
  return {
    success: Boolean(result.success),
    chat_key,
    ...(result.success ? {} : { error: result.error || "chat send failed" }),
  };
}

/**
 * 按 chat_key 发送平台动作（typing/react）。
 *
 * 关键点（中文）
 * - 动作分发与文本发送复用同一 chat_key 解析与 channel dispatcher。
 */
export async function sendChatActionByChatKey(params: {
  context: PluginContext;
  chat_key: string;
  action: ChatDispatchAction;
  message_id?: string;
  reactionEmoji?: string;
  reactionIsBig?: boolean;
}): Promise<ChatReactResponse> {
  const chat_key = String(params.chat_key || "").trim();
  if (!chat_key) {
    return {
      success: false,
      error: "Missing chat_key",
    };
  }

  const result = await sendActionByChatKey({
    context: params.context,
    chat_key,
    action: params.action,
    message_id: params.message_id,
    reactionEmoji: params.reactionEmoji,
    reactionIsBig: params.reactionIsBig,
  });
  const message_id = String(params.message_id || "").trim();
  return {
    success: Boolean(result.success),
    chat_key,
    ...(message_id ? { message_id } : {}),
    ...(result.success ? {} : { error: result.error || "chat action failed" }),
  };
}

/**
 * 按 session_id 发送文本。
 *
 * 关键点（中文）
 * - session_id -> chat_key 映射关系只在 chat plugin runtime 内部维护。
 */
export async function sendChatTextBySessionId(params: {
  context: PluginContext;
  session_id: string;
  text: string;
  delay_ms?: number;
  send_at_ms?: number;
  reply_to_message?: boolean;
  message_id?: string;
}): Promise<{ success: boolean; session_id: string; error?: string }> {
  const session_id = String(params.session_id || "").trim();
  if (!session_id) {
    return {
      success: false,
      session_id: "",
      error: "Missing session_id",
    };
  }

  const result = await sendChatTextByChatKey({
    context: params.context,
    chat_key: session_id,
    text: params.text,
    delay_ms: params.delay_ms,
    send_at_ms: params.send_at_ms,
    reply_to_message: params.reply_to_message === true,
    ...(typeof params.message_id === "string" && params.message_id.trim()
      ? { message_id: params.message_id.trim() }
      : {}),
  });
  return {
    success: Boolean(result.success),
    session_id,
    ...(result.success ? {} : { error: result.error || "chat send failed" }),
  };
}

/**
 * 按 chat_key/session_id 彻底删除 chat 会话。
 *
 * 关键点（中文）
 * - chat_key 与 session_id 在 chat plugin runtime 内部等价使用。
 * - 删除包含：路由映射 + chat 审计目录 + session 目录 + 渠道状态清理。
 */
export async function deleteChatByChatKey(params: {
  context: PluginContext;
  chat_key?: string;
  session_id?: string;
  run_context?: PluginRunContext;
}): Promise<ChatDeleteResponse> {
  const chat_key = resolveChatKey({
    context: params.context,
    chat_key: params.chat_key,
    session_id: params.session_id,
    run_context: params.run_context,
  });
  const session_id = String(chat_key || "").trim();
  if (!session_id) {
    return {
      success: false,
      error:
        "Missing chat_key/session_id. Provide --chat-key or --session-id, or ensure DC_CTX_CHAT_KEY/DC_SESSION_ID is injected.",
    };
  }

  const result = await deleteChatSessionById({
    context: params.context,
    session_id,
  });
  return {
    success: result.success,
    session_id: result.session_id,
    deleted: result.deleted,
    removedMeta: result.removedMeta,
    removedChatDir: result.removedChatDir,
    removedSessionDir: result.removedSessionDir,
    ...(result.success ? {} : { error: result.error || "chat delete failed" }),
  };
}
