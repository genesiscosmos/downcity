/**
 * ChatSessionDelete：按 session_id 彻底删除 chat 会话数据。
 *
 * 关键点（中文）
 * - 删除路由映射（AgentWorkspace 数据目录的 `channel/meta.json`）
 * - 删除 chat 审计目录（AgentWorkspace 数据目录的 `chat/<session_id>/`）
 * - 删除 core session 目录（AgentWorkspace 数据目录的 `sessions/<session_id>/`）
 * - 清理运行中 agent 与队列，避免残留任务继续执行
 */

import type { PluginContext } from "@downcity/agent";
import { resolveChatQueueStore } from "@/chat/runtime/ChatQueue.js";
import { clean_chat_storage } from "@/chat/runtime/ChatStorage.js";

function normalizeSessionId(session_id: string): string {
  return String(session_id || "").trim();
}

/**
 * 彻底删除一个 chat session。
 *
 * 关键点（中文）
 * - 幂等：目标不存在时返回 success + deleted=false，避免上层重试复杂化。
 */
export async function deleteChatSessionById(params: {
  context: PluginContext;
  session_id: string;
}): Promise<{
  success: boolean;
  session_id: string;
  deleted: boolean;
  removedMeta: boolean;
  removedChatDir: boolean;
  removedSessionDir: boolean;
  error?: string;
}> {
  const session_id = normalizeSessionId(params.session_id);
  if (!session_id) {
    return {
      success: false,
      session_id: "",
      deleted: false,
      removedMeta: false,
      removedChatDir: false,
      removedSessionDir: false,
      error: "Missing session_id",
    };
  }

  try {
    // 关键点（中文）：先停执行，再删文件，避免删除过程中仍有任务写入。
    resolveChatQueueStore(params.context).clear(session_id);

    const chat_result = await clean_chat_storage({
      data_path: params.context.data_path,
      session_id: session_id,
    });
    const removed_session_dir = await params.context.sessions.remove(session_id);

    const deleted =
      chat_result.removed_route ||
      chat_result.removed_chat_dir ||
      removed_session_dir;

    return {
      success: true,
      session_id,
      deleted,
      removedMeta: chat_result.removed_route,
      removedChatDir: chat_result.removed_chat_dir,
      removedSessionDir: removed_session_dir,
    };
  } catch (error) {
    return {
      success: false,
      session_id,
      deleted: false,
      removedMeta: false,
      removedChatDir: false,
      removedSessionDir: false,
      error: String(error),
    };
  }
}
