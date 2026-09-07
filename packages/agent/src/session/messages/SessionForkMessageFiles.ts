/** Session fork 时重新归属 canonical Message 中由源 Session 持有的附件。 */

import path from "node:path";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

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
