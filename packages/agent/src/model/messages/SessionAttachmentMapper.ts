/**
 * Session 附件持久化模块。
 *
 * 本模块在 User Message 入库前把 Data URL 写入 Session Attachment Store，
 * 消息只记录文件位置，模型引用在投影时从 canonical file 派生，避免分支路径漂移。
 * 上传不触发内容披露，显式 read 才读取内容。
 */

import { stat } from "node:fs/promises";
import { file_read_version } from "@downcity/type/workspace";
import type { SessionUserContent } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 在用户 prompt 入库前持久化 Data URL 文件。 */
export async function persist_user_prompt_file_parts(
  parts: SessionUserContent[],
  attachment_store: SessionAttachmentStore,
): Promise<SessionUserContent[]> {
  const output: SessionUserContent[] = [];
  for (const part of parts) {
    if (part.type !== "file" || !part.url.startsWith("data:")) {
      output.push(part);
      continue;
    }
    const stored_path = await attachment_store.persist_data_url({
      data_url: part.url,
      media_type: part.media_type,
      ...(part.filename ? { filename: part.filename } : {}),
    });
    // 显式工具媒体以已保存附件的版本重放，不把远端快照版本套在本地 inode 上。
    output.push({ ...part, url: stored_path, ...(part.media_version ? { media_version: file_read_version(await stat(stored_path)) } : {}) });
  }
  return output;
}
