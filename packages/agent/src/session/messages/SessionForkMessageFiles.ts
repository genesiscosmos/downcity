/** Session fork 时重新归属 canonical Message 中由源 Session 持有的附件。 */

import path from "node:path";
import type { SessionMessage } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 截取 Fork 锚点之前的历史，并按调用语义决定是否包含锚点。 */
export function resolve_session_fork_messages(input: {
  /** 当前源 Session 的稳定标识。 */
  session_id: string;
  /** 当前源 Session 的完整 canonical 历史。 */
  messages: SessionMessage[];
  /** Fork 使用的锚点 Message 标识。 */
  message_id: string;
  /** Fork 历史是否包含锚点 Message 本身。 */
  include_message: boolean;
}): SessionMessage[] {
  const target_index = input.messages.findIndex(
    (message) => message.message_id === input.message_id,
  );
  if (target_index < 0) {
    throw new Error(
      `Cannot fork session "${input.session_id}": message_id "${input.message_id}" not found.`,
    );
  }
  return input.messages.slice(
    0,
    input.include_message ? target_index + 1 : target_index,
  );
}

/**
 * 将 fork 历史中的本地绝对路径复制到目标 Session 的附件 Store。
 *
 * HTTP URL 和 Workspace 相对路径不由源 Session 持有，保持原引用；Data URL 与
 * 本地绝对路径都进入目标附件 Store，确保源 Session 归档或删除后 fork 仍可恢复。
 */
export async function relocate_fork_message_files(
  messages: readonly SessionMessage[],
  source_store: SessionAttachmentStore,
  target_store: SessionAttachmentStore,
): Promise<SessionMessage[]> {
  const relocated_urls = new Map<string, Promise<string>>();
  return await Promise.all(messages.map(async (message) => {
    if (message.type !== "user" && message.type !== "assistant") return structuredClone(message);
    const parts = await Promise.all(message.parts.map(async (part) => {
      if (part.type !== "file") return structuredClone(part);
      if (!part.url.startsWith("data:") && (!path.isAbsolute(part.url) || !source_store.owns_local_file(part.url))) {
        return structuredClone(part);
      }
      const cache_key = `${part.media_type}\u0000${part.url}`;
      let relocated = relocated_urls.get(cache_key);
      if (!relocated) {
        relocated = persist_fork_file(part, target_store);
        relocated_urls.set(cache_key, relocated);
      }
      return { ...structuredClone(part), url: await relocated };
    }));
    return { ...structuredClone(message), parts } as SessionMessage;
  }));
}

/** 将单个源附件转换为目标 Store 接受的 Data URL。 */
async function persist_fork_file(
  part: { url: string; media_type: string; filename?: string },
  target_store: SessionAttachmentStore,
): Promise<string> {
  if (part.url.startsWith("data:")) {
    return await target_store.persist_data_url({
      data_url: part.url,
      media_type: part.media_type,
      ...(part.filename ? { filename: part.filename } : {}),
    });
  }
  return await target_store.copy_local_file({
    source_url: part.url,
    media_type: part.media_type,
    ...(part.filename ? { filename: part.filename } : {}),
  });
}
