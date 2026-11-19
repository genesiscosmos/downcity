/** Session fork 时重新归属 canonical Message 中由源 Session 持有的附件。 */

import path from "node:path";
import { stat } from "node:fs/promises";
import { file_read_version } from "@downcity/type/workspace";
import { copy_session_fork_input } from "./SessionForkParts.js";
import type { SessionFileContent, SessionMessage } from "@downcity/type";
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
  const relocate_file = async <T extends SessionFileContent>(part: T): Promise<T> => {
    if (!part.url.startsWith("data:") && (!path.isAbsolute(part.url) || !source_store.owns_local_file(part.url))) {
      return structuredClone(part);
    }
    const source_version = part.media_version && !part.url.startsWith("data:")
      ? file_read_version(await stat(part.url)) : undefined;
    const cache_key = `${part.media_type}\u0000${part.url}`;
    let relocated = relocated_urls.get(cache_key);
    if (!relocated) {
      relocated = persist_fork_file(part, target_store);
      relocated_urls.set(cache_key, relocated);
    }
    const copied = { ...structuredClone(part), url: await relocated };
    if (part.media_version) {
      // 只有源文件仍是当时明确披露的版本，副本才继承媒体披露；否则需要重新读取。
      if (source_version === part.media_version && file_read_version(await stat(part.url)) === source_version) {
        copied.media_version = file_read_version(await stat(copied.url));
      }
      // 失配时保留源版本，使副本继续校验失败；移除版本会误触发普通图片自动披露。
    }
    return copied;
  };
  return await Promise.all(messages.map(async (message) => {
    const parts = await Promise.all(message.parts.map(async (part) => {
      if (part.type === "file") return await relocate_file(part);
      if (part.type === "input") {
        const content = await Promise.all(part.content.map(async (item) =>
          item.type === "file" ? await relocate_file(item) : structuredClone(item)));
        for (const [index, item] of content.entries()) {
          const source_file = part.content[index - 1];
          const target_file = content[index - 1];
          if (item.type !== "context" || item.tag !== "attachment_path"
            || source_file?.type !== "file" || target_file?.type !== "file") continue;
          const prefix = `对应${source_file.media_type.startsWith("image/") ? "图片" : "附件"}路径：`;
          if (item.context === `${prefix}${source_file.url}`) item.context = `${prefix}${target_file.url}`;
        }
        return { ...copy_session_fork_input(part), content };
      }
      return structuredClone(part);
    }));
    // Input 身份在目标 Session 内保持稳定，重试可直接命中已复制的输入。
    return { ...structuredClone(message), parts } as SessionMessage;
  }));
}

/** 将单个源附件转换为目标 Store 接受的 Data URL。 */
async function persist_fork_file(
  part: SessionFileContent,
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
