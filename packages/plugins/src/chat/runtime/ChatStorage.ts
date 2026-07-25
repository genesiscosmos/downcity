/**
 * Chat Plugin 存储路径与离线维护能力。
 *
 * 关键点（中文）
 * - Chat Plugin 是 channel meta、chat history 与渠道缓存路径的唯一所有者。
 * - PluginContext 只提供项目根目录，不暴露任何 Chat 领域路径。
 * - CLI 离线维护通过本模块操作 Chat 存储，不复制内部 JSON 结构。
 */

import path from "node:path";
import fs from "fs-extra";
import type {
  ChatStorageCleanInput,
  ChatStorageCleanResult,
} from "@/chat/types/ChatStorage.js";
import type {
  ChannelContextMetaFileV1,
  ChannelContextRouteV1,
} from "@/chat/types/ChannelContext.js";

function normalize_text(input: unknown): string {
  return String(input || "").trim();
}

function normalize_thread_id(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

function get_downcity_path(root_path: string): string {
  return path.join(root_path, ".downcity");
}

/** 返回 Chat 渠道路由目录。 */
export function get_chat_channel_dir_path(root_path: string): string {
  return path.join(get_downcity_path(root_path), "channel");
}

/** 返回 Chat 渠道路由文件。 */
export function get_chat_channel_meta_path(root_path: string): string {
  return path.join(get_chat_channel_dir_path(root_path), "meta.json");
}

/** 返回单个 Chat 会话的事件目录。 */
export function get_chat_session_dir_path(
  root_path: string,
  session_id: string,
): string {
  return path.join(
    get_downcity_path(root_path),
    "chat",
    encodeURIComponent(normalize_text(session_id)),
  );
}

/** 返回单个 Chat 会话的事件流文件。 */
export function get_chat_history_path(
  root_path: string,
  session_id: string,
): string {
  return path.join(get_chat_session_dir_path(root_path, session_id), "history.jsonl");
}

/** 返回飞书渠道的消息去重目录。 */
export function get_feishu_dedupe_dir_path(root_path: string): string {
  return path.join(get_downcity_path(root_path), ".cache", "feishu", "dedupe");
}

async function read_channel_meta(
  root_path: string,
): Promise<Partial<ChannelContextMetaFileV1>> {
  const raw = await fs.readJson(get_chat_channel_meta_path(root_path)).catch(() => null);
  return raw && typeof raw === "object"
    ? raw as Partial<ChannelContextMetaFileV1>
    : {};
}

function build_target_key(input: ChatStorageCleanInput): string {
  const channel = normalize_text(input.channel);
  const chat_id = normalize_text(input.chat_id);
  if (!channel || !chat_id) return "";
  return [
    channel,
    chat_id,
    normalize_text(input.target_type),
    normalize_thread_id(input.thread_id) || "",
  ].join("|");
}

function matches_target(
  route: ChannelContextRouteV1,
  input: ChatStorageCleanInput,
): boolean {
  const channel = normalize_text(input.channel);
  const chat_id = normalize_text(input.chat_id);
  const target_type = normalize_text(input.target_type);
  const thread_id = normalize_thread_id(input.thread_id);
  if (!channel || !chat_id) return false;
  if (normalize_text(route.channel) !== channel) return false;
  if (normalize_text(route.chatId) !== chat_id) return false;
  if (target_type && normalize_text(route.targetType) !== target_type) return false;
  if (thread_id && normalize_thread_id(route.threadId) !== thread_id) return false;
  return true;
}

function resolve_session_id(
  meta: Partial<ChannelContextMetaFileV1>,
  input: ChatStorageCleanInput,
): string {
  const explicit = normalize_text(input.session_id);
  if (explicit) return explicit;
  const target_key = build_target_key(input);
  const mapped = normalize_text(
    target_key ? meta.sessionIdByTargetKey?.[target_key] : "",
  );
  if (mapped) return mapped;
  for (const route of Object.values(meta.routesBySessionId || {})) {
    if (route && matches_target(route, input)) {
      return normalize_text(route.session_id);
    }
  }
  return "";
}

async function remove_route(
  root_path: string,
  meta: Partial<ChannelContextMetaFileV1>,
  session_id: string,
): Promise<boolean> {
  const routes_by_session_id = { ...(meta.routesBySessionId || {}) };
  const session_id_by_target_key = { ...(meta.sessionIdByTargetKey || {}) };
  let removed = false;
  if (routes_by_session_id[session_id]) {
    delete routes_by_session_id[session_id];
    removed = true;
  }
  for (const [target_key, mapped_session_id] of Object.entries(
    session_id_by_target_key,
  )) {
    if (normalize_text(mapped_session_id) !== session_id) continue;
    delete session_id_by_target_key[target_key];
    removed = true;
  }
  if (!removed) return false;
  await fs.ensureDir(get_chat_channel_dir_path(root_path));
  await fs.writeJson(
    get_chat_channel_meta_path(root_path),
    {
      ...meta,
      v: 1,
      updated_at: Date.now(),
      routesBySessionId: routes_by_session_id,
      sessionIdByTargetKey: session_id_by_target_key,
    },
    { spaces: 2 },
  );
  return true;
}

/**
 * 清空单个 Chat 会话的事件历史。
 */
export async function clear_chat_history(
  root_path: string,
  session_id: string,
): Promise<boolean> {
  const history_path = get_chat_history_path(root_path, session_id);
  const existed = await fs.pathExists(history_path);
  if (existed) await fs.remove(history_path);
  return existed;
}

/**
 * 清理单个 Chat 会话的领域存储。
 *
 * 关键点（中文）
 * - 只删除 Chat Plugin 自己拥有的路由与事件目录。
 * - Agent Session 数据由调用方通过 Session API 单独删除。
 */
export async function clean_chat_storage(
  input: ChatStorageCleanInput,
): Promise<ChatStorageCleanResult> {
  const root_path = path.resolve(normalize_text(input.root_path) || ".");
  const meta = await read_channel_meta(root_path);
  const session_id = resolve_session_id(meta, input);
  if (!session_id) {
    return {
      session_id: "",
      removed_chat_dir: false,
      removed_route: false,
    };
  }
  const chat_dir_path = get_chat_session_dir_path(root_path, session_id);
  const removed_chat_dir = await fs.pathExists(chat_dir_path);
  if (removed_chat_dir) await fs.remove(chat_dir_path);
  const removed_route = await remove_route(root_path, meta, session_id);
  return {
    session_id,
    removed_chat_dir,
    removed_route,
  };
}
