/**
 * ChatHistoryStore：聊天事件流持久化。
 *
 * 关键点（中文）
 * - 写入 AgentWorkspace 数据目录的 `chat/<session_id>/history.jsonl`（append-only）。
 * - 记录 inbound（audit/exec）与 outbound 事件。
 * - 与 session message history 分离，避免审计噪声进入模型上下文。
 */

import fs from "fs-extra";
import path from "node:path";
import { generate_id } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import { get_chat_history_path } from "@/chat/runtime/ChatStorage.js";
import type { JsonObject } from "@downcity/agent";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";
import type {
  ChatHistoryDirection,
  ChatHistoryInboundEventV1,
  ChatHistoryEventV1,
  ChatHistoryOutboundEventV1,
  ChatHistoryIngressKind,
} from "@/chat/types/ChatHistory.js";

function normalizeTrimmedString(value: string | undefined): string {
  return String(value || "").trim();
}

function toOptionalTrimmedString(value: string | undefined): string | undefined {
  const out = normalizeTrimmedString(value);
  return out ? out : undefined;
}

function toOptionalFiniteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalObject(value: JsonObject | undefined): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function buildInboundEvent(params: {
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  ingressKind: ChatHistoryIngressKind;
  text: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
}): ChatHistoryInboundEventV1 {
  return {
    v: 1,
    id: `chat:${generate_id()}`,
    ts: Date.now(),
    direction: "inbound",
    ingressKind: params.ingressKind,
    session_id: params.session_id,
    channel: params.channel,
    chatId: params.chatId,
    text: params.text,
    ...(params.targetType ? { targetType: params.targetType } : {}),
    ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    ...(params.message_id ? { message_id: params.message_id } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.actorName ? { actorName: params.actorName } : {}),
    ...(params.extra ? { extra: params.extra } : {}),
  };
}

function buildOutboundEvent(params: {
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
}): ChatHistoryOutboundEventV1 {
  return {
    v: 1,
    id: `chat:${generate_id()}`,
    ts: Date.now(),
    direction: "outbound",
    session_id: params.session_id,
    channel: params.channel,
    chatId: params.chatId,
    text: params.text,
    ...(params.targetType ? { targetType: params.targetType } : {}),
    ...(typeof params.threadId === "number" ? { threadId: params.threadId } : {}),
    ...(params.message_id ? { message_id: params.message_id } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.actorName ? { actorName: params.actorName } : {}),
    ...(params.extra ? { extra: params.extra } : {}),
  };
}

function isValidHistoryDirection(value: unknown): value is ChatHistoryDirection {
  return value === "inbound" || value === "outbound";
}

function isChatHistoryEventV1(value: unknown): value is ChatHistoryEventV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (obj.v !== 1) return false;
  if (!isValidHistoryDirection(obj.direction)) return false;
  if (typeof obj.id !== "string" || !obj.id.trim()) return false;
  if (typeof obj.session_id !== "string" || !obj.session_id.trim()) return false;
  if (typeof obj.channel !== "string" || !obj.channel.trim()) return false;
  if (typeof obj.chatId !== "string" || !obj.chatId.trim()) return false;
  if (typeof obj.text !== "string") return false;
  if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) return false;
  if (obj.direction === "inbound") {
    const ingressKind = obj.ingressKind;
    if (ingressKind !== "audit" && ingressKind !== "exec") return false;
  }
  return true;
}

/**
 * 追加一条入站 chat 事件。
 *
 * 关键点（中文）
 * - 该函数只做落盘，不做业务判定。
 * - 调用方应在入队前调用，以满足“先审计后执行”链路。
 */
export async function appendInboundChatHistory(params: {
  context: PluginContext;
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  ingressKind: ChatHistoryIngressKind;
  text: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
}): Promise<void> {
  const rootPath = normalizeTrimmedString(params.context.data_path);
  const session_id = normalizeTrimmedString(params.session_id);
  const chatId = normalizeTrimmedString(params.chatId);
  if (!rootPath || !session_id || !chatId) return;

  const event = buildInboundEvent({
    session_id,
    channel: params.channel,
    chatId,
    ingressKind: params.ingressKind,
    text: String(params.text ?? ""),
    targetType: toOptionalTrimmedString(params.targetType),
    threadId: toOptionalFiniteNumber(params.threadId),
    message_id: toOptionalTrimmedString(params.message_id),
    actorId: toOptionalTrimmedString(params.actorId),
    actorName: toOptionalTrimmedString(params.actorName),
    extra: toOptionalObject(params.extra),
  });

  const file = get_chat_history_path(params.context.data_path, session_id);
  await fs.ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
}

/**
 * 追加一条出站 chat 事件。
 *
 * 关键点（中文）
 * - 用于记录机器人主动发出的消息，便于后续审计与回放。
 * - 该函数只做落盘，不影响实际发送链路。
 */
export async function appendOutboundChatHistory(params: {
  context: PluginContext;
  session_id: string;
  channel: ChatDispatchChannel;
  chatId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
}): Promise<void> {
  const rootPath = normalizeTrimmedString(params.context.data_path);
  const session_id = normalizeTrimmedString(params.session_id);
  const chatId = normalizeTrimmedString(params.chatId);
  if (!rootPath || !session_id || !chatId) return;

  const event = buildOutboundEvent({
    session_id,
    channel: params.channel,
    chatId,
    text: String(params.text ?? ""),
    targetType: toOptionalTrimmedString(params.targetType),
    threadId: toOptionalFiniteNumber(params.threadId),
    message_id: toOptionalTrimmedString(params.message_id),
    actorId: toOptionalTrimmedString(params.actorId),
    actorName: toOptionalTrimmedString(params.actorName),
    extra: toOptionalObject(params.extra),
  });

  const file = get_chat_history_path(params.context.data_path, session_id);
  await fs.ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
}

/**
 * 读取 chat 历史事件（按 session_id）。
 *
 * 关键点（中文）
 * - 默认返回最近 N 条（按时间升序）。
 * - 仅做文件读取与过滤，不涉及任何业务 side-effect。
 */
export async function readChatHistory(params: {
  context: PluginContext;
  session_id: string;
  limit?: number;
  direction?: ChatHistoryDirection | "all";
  beforeTs?: number;
  afterTs?: number;
}): Promise<{ historyPath: string; events: ChatHistoryEventV1[] }> {
  const rootPath = normalizeTrimmedString(params.context.data_path);
  const session_id = normalizeTrimmedString(params.session_id);
  const historyPath = get_chat_history_path(params.context.data_path, session_id);
  if (!rootPath || !session_id) {
    return {
      historyPath,
      events: [],
    };
  }

  const exists = await fs.pathExists(historyPath);
  if (!exists) {
    return {
      historyPath,
      events: [],
    };
  }

  const limitRaw =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.floor(params.limit)
      : 30;
  const limit = Math.max(1, Math.min(limitRaw, 500));
  const direction =
    params.direction === "inbound" || params.direction === "outbound"
      ? params.direction
      : "all";
  const beforeTs =
    typeof params.beforeTs === "number" && Number.isFinite(params.beforeTs)
      ? params.beforeTs
      : undefined;
  const afterTs =
    typeof params.afterTs === "number" && Number.isFinite(params.afterTs)
      ? params.afterTs
      : undefined;

  const content = await fs.readFile(historyPath, "utf8");
  const out: ChatHistoryEventV1[] = [];
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isChatHistoryEventV1(parsed)) continue;
    if (direction !== "all" && parsed.direction !== direction) continue;
    if (typeof beforeTs === "number" && parsed.ts >= beforeTs) continue;
    if (typeof afterTs === "number" && parsed.ts <= afterTs) continue;
    out.push(parsed);
  }

  return {
    historyPath,
    events: out.slice(-limit),
  };
}
