/**
 * ChannelContextStore：渠道目标与 session_id 映射存储。
 *
 * 关键点（中文）
 * - 映射文件位于 `.downcity/channel/meta.json`。
 * - session_id 由服务端随机生成并持久化，不依赖字符串拼接规则。
 * - 统一提供“按目标找 session_id / 按 session_id 找目标”能力。
 */

import fs from "fs-extra";
import { generate_id } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type {
  ChannelContextMetaFileV1,
  ChannelContextRouteV1,
  ChannelContextTarget,
} from "@/chat/types/ChannelContext.js";
import {
  get_chat_channel_dir_path,
  get_chat_channel_meta_path,
} from "@/chat/runtime/ChatStorage.js";

function toOptionalTrimmedString(input: unknown): string | undefined {
  const value = String(input || "").trim();
  return value ? value : undefined;
}

function toOptionalThreadId(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input)) return undefined;
  const out = Math.trunc(input);
  if (out <= 0) return undefined;
  return out;
}

function normalizeTarget(target: ChannelContextTarget): ChannelContextTarget | null {
  const channel = toOptionalTrimmedString(target.channel);
  const chatId = toOptionalTrimmedString(target.chatId);
  if (!channel || !chatId) return null;
  return {
    channel: channel as ChannelContextTarget["channel"],
    chatId,
    ...(toOptionalTrimmedString(target.targetType)
      ? { targetType: toOptionalTrimmedString(target.targetType) }
      : {}),
    ...(toOptionalThreadId(target.threadId)
      ? { threadId: toOptionalThreadId(target.threadId) }
      : {}),
  };
}

function normalizeRoute(
  input: Partial<ChannelContextRouteV1> | null | undefined,
): ChannelContextRouteV1 | null {
  if (!input || typeof input !== "object") return null;
  const session_id = toOptionalTrimmedString(input.session_id);
  const channel = toOptionalTrimmedString(input.channel);
  const chatId = toOptionalTrimmedString(input.chatId);
  if (!session_id || !channel || !chatId) return null;
  return {
    v: 1,
    session_id,
    channel: channel as ChannelContextRouteV1["channel"],
    chatId,
    ...(toOptionalTrimmedString(input.targetType)
      ? { targetType: toOptionalTrimmedString(input.targetType) }
      : {}),
    ...(toOptionalThreadId(input.threadId)
      ? { threadId: toOptionalThreadId(input.threadId) }
      : {}),
    ...(toOptionalTrimmedString(input.message_id)
      ? { message_id: toOptionalTrimmedString(input.message_id) }
      : {}),
    ...(toOptionalTrimmedString(input.actorId)
      ? { actorId: toOptionalTrimmedString(input.actorId) }
      : {}),
    ...(toOptionalTrimmedString(input.actorName)
      ? { actorName: toOptionalTrimmedString(input.actorName) }
      : {}),
    ...(toOptionalTrimmedString(input.chatTitle)
      ? { chatTitle: toOptionalTrimmedString(input.chatTitle) }
      : {}),
    updated_at:
      typeof input.updated_at === "number" && Number.isFinite(input.updated_at)
        ? input.updated_at
        : Date.now(),
  };
}

function normalizeMetaFile(
  input: Partial<ChannelContextMetaFileV1> | null | undefined,
): ChannelContextMetaFileV1 {
  const routesBySessionId: Record<string, ChannelContextRouteV1> = {};
  const sessionIdByTargetKey: Record<string, string> = {};
  const rawRoutes =
    input && typeof input === "object" && input.routesBySessionId
      ? input.routesBySessionId
      : {};
  if (rawRoutes && typeof rawRoutes === "object") {
    for (const [session_id, rawRoute] of Object.entries(rawRoutes)) {
      const route = normalizeRoute(rawRoute as Partial<ChannelContextRouteV1>);
      if (!route) continue;
      routesBySessionId[session_id] = route;
    }
  }

  const rawTargetMap =
    input && typeof input === "object" && input.sessionIdByTargetKey
      ? input.sessionIdByTargetKey
      : {};
  if (rawTargetMap && typeof rawTargetMap === "object") {
    for (const [targetKey, sessionIdRaw] of Object.entries(rawTargetMap)) {
      const session_id = toOptionalTrimmedString(sessionIdRaw);
      if (!targetKey || !session_id) continue;
      if (!routesBySessionId[session_id]) continue;
      sessionIdByTargetKey[targetKey] = session_id;
    }
  }

  return {
    v: 1,
    updated_at:
      typeof input?.updated_at === "number" && Number.isFinite(input.updated_at)
        ? input.updated_at
        : Date.now(),
    sessionIdByTargetKey,
    routesBySessionId,
  };
}

/**
 * 构造目标键。
 *
 * 关键点（中文）
 * - 目标键是纯内部索引，不对外暴露。
 */
export function buildChannelTargetKey(target: ChannelContextTarget): string {
  const normalized = normalizeTarget(target);
  if (!normalized) return "";
  return [
    normalized.channel,
    normalized.chatId,
    normalized.targetType || "",
    typeof normalized.threadId === "number" ? String(normalized.threadId) : "",
  ].join("|");
}

async function readMetaFile(params: {
  filePath: string;
}): Promise<ChannelContextMetaFileV1> {
  const raw = (await fs.readJson(params.filePath).catch(() => null)) as
    | Partial<ChannelContextMetaFileV1>
    | null;
  return normalizeMetaFile(raw);
}

async function writeMetaFile(params: {
  dirPath: string;
  filePath: string;
  file: ChannelContextMetaFileV1;
}): Promise<void> {
  await fs.ensureDir(params.dirPath);
  await fs.writeJson(params.filePath, params.file, { spaces: 2 });
}

/**
 * 通过 session_id 读取路由信息。
 */
export async function readChannelSessionRouteBySessionId(params: {
  context: PluginContext;
  session_id: string;
}): Promise<ChannelContextRouteV1 | null> {
  const rootPath = String(params.context.workspace_path || "").trim();
  const session_id = toOptionalTrimmedString(params.session_id);
  if (!rootPath || !session_id) return null;
  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  return normalizeRoute(file.routesBySessionId[session_id]);
}

/**
 * 列出当前 agent 已记录的所有渠道路由条目。
 *
 * 关键点（中文）
 * - 数据源为 `.downcity/channel/meta.json` 的 `routesBySessionId`。
 * - 默认按 `updated_at` 倒序返回，便于展示“最近活跃”会话。
 */
export async function listChannelSessionRoutes(params: {
  context: PluginContext;
}): Promise<{
  updated_at: number;
  routes: ChannelContextRouteV1[];
}> {
  const rootPath = String(params.context.workspace_path || "").trim();
  if (!rootPath) {
    return {
      updated_at: Date.now(),
      routes: [],
    };
  }
  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  const routes = Object.values(file.routesBySessionId)
    .map((route) => normalizeRoute(route))
    .filter((route): route is ChannelContextRouteV1 => Boolean(route))
    .sort((a, b) => b.updated_at - a.updated_at);
  return {
    updated_at: file.updated_at,
    routes,
  };
}

/**
 * 根据渠道目标查找已有 session_id（不自动创建）。
 */
export async function resolveChannelSessionIdByTarget(params: {
  context: PluginContext;
  target: ChannelContextTarget;
}): Promise<string | null> {
  const rootPath = String(params.context.workspace_path || "").trim();
  if (!rootPath) return null;
  const targetKey = buildChannelTargetKey(params.target);
  if (!targetKey) return null;
  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  const session_id = toOptionalTrimmedString(file.sessionIdByTargetKey[targetKey]);
  if (!session_id) return null;
  return file.routesBySessionId[session_id] ? session_id : null;
}

/**
 * 根据渠道目标解析或创建 session_id。
 */
export async function resolveOrCreateChannelSessionIdByTarget(params: {
  context: PluginContext;
  target: ChannelContextTarget;
}): Promise<string | null> {
  const rootPath = String(params.context.workspace_path || "").trim();
  if (!rootPath) return null;
  const normalizedTarget = normalizeTarget(params.target);
  if (!normalizedTarget) return null;
  const targetKey = buildChannelTargetKey(normalizedTarget);
  if (!targetKey) return null;

  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  const existingSessionId = toOptionalTrimmedString(file.sessionIdByTargetKey[targetKey]);
  if (
    existingSessionId &&
    file.routesBySessionId[existingSessionId] &&
    normalizeRoute(file.routesBySessionId[existingSessionId])
  ) {
    return existingSessionId;
  }

  const nextSessionId = `ctx_${generate_id()}`;
  file.sessionIdByTargetKey[targetKey] = nextSessionId;
  file.routesBySessionId[nextSessionId] = {
    v: 1,
    session_id: nextSessionId,
    channel: normalizedTarget.channel,
    chatId: normalizedTarget.chatId,
    ...(normalizedTarget.targetType ? { targetType: normalizedTarget.targetType } : {}),
    ...(typeof normalizedTarget.threadId === "number"
      ? { threadId: normalizedTarget.threadId }
      : {}),
    updated_at: Date.now(),
  };
  file.updated_at = Date.now();
  await writeMetaFile({
    dirPath: get_chat_channel_dir_path(params.context.workspace_path),
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
    file,
  });
  return nextSessionId;
}

/**
 * 更新指定 session_id 的渠道路由信息。
 */
export async function upsertChannelSessionRouteBySessionId(params: {
  context: PluginContext;
  session_id: string;
  target: ChannelContextTarget;
  message_id?: string;
  actorId?: string;
  actorName?: string;
  chatTitle?: string;
}): Promise<void> {
  const rootPath = String(params.context.workspace_path || "").trim();
  const session_id = toOptionalTrimmedString(params.session_id);
  const normalizedTarget = normalizeTarget(params.target);
  if (!rootPath || !session_id || !normalizedTarget) return;
  const targetKey = buildChannelTargetKey(normalizedTarget);
  if (!targetKey) return;

  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  const prev = normalizeRoute(file.routesBySessionId[session_id]);
  const nextRoute: ChannelContextRouteV1 = {
    v: 1,
    session_id,
    channel: normalizedTarget.channel,
    chatId: normalizedTarget.chatId,
    ...(normalizedTarget.targetType ? { targetType: normalizedTarget.targetType } : {}),
    ...(typeof normalizedTarget.threadId === "number"
      ? { threadId: normalizedTarget.threadId }
      : {}),
    ...(toOptionalTrimmedString(params.message_id)
      ? { message_id: toOptionalTrimmedString(params.message_id) }
      : prev?.message_id
        ? { message_id: prev.message_id }
        : {}),
    ...(toOptionalTrimmedString(params.actorId)
      ? { actorId: toOptionalTrimmedString(params.actorId) }
      : prev?.actorId
        ? { actorId: prev.actorId }
        : {}),
    ...(toOptionalTrimmedString(params.actorName)
      ? { actorName: toOptionalTrimmedString(params.actorName) }
      : prev?.actorName
        ? { actorName: prev.actorName }
        : {}),
    ...(toOptionalTrimmedString(params.chatTitle)
      ? { chatTitle: toOptionalTrimmedString(params.chatTitle) }
      : prev?.chatTitle
        ? { chatTitle: prev.chatTitle }
        : {}),
    updated_at: Date.now(),
  };

  file.routesBySessionId[session_id] = nextRoute;
  file.sessionIdByTargetKey[targetKey] = session_id;
  file.updated_at = Date.now();
  await writeMetaFile({
    dirPath: get_chat_channel_dir_path(params.context.workspace_path),
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
    file,
  });
}

/**
 * 删除指定 session_id 的渠道路由映射。
 *
 * 关键点（中文）
 * - 会同步清理 `routesBySessionId` 与 `sessionIdByTargetKey` 双索引。
 * - 仅影响 chat 路由，不触碰 context / chat 历史文件。
 */
export async function removeChannelSessionRouteBySessionId(params: {
  context: PluginContext;
  session_id: string;
}): Promise<{
  removed: boolean;
  route: ChannelContextRouteV1 | null;
}> {
  const rootPath = String(params.context.workspace_path || "").trim();
  const session_id = toOptionalTrimmedString(params.session_id);
  if (!rootPath || !session_id) {
    return {
      removed: false,
      route: null,
    };
  }

  const file = await readMetaFile({
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
  });
  const route = normalizeRoute(file.routesBySessionId[session_id]);
  if (!route) {
    return {
      removed: false,
      route: null,
    };
  }

  delete file.routesBySessionId[session_id];
  for (const [targetKey, mappedSessionId] of Object.entries(
    file.sessionIdByTargetKey,
  )) {
    if (mappedSessionId === session_id) {
      delete file.sessionIdByTargetKey[targetKey];
    }
  }

  file.updated_at = Date.now();
  await writeMetaFile({
    dirPath: get_chat_channel_dir_path(params.context.workspace_path),
    filePath: get_chat_channel_meta_path(params.context.workspace_path),
    file,
  });
  return {
    removed: true,
    route,
  };
}
