/**
 * Session 附件持久化模块。
 *
 * 本模块只负责在 User Message 入库前把 Data URL 写入 Session Attachment Store。
 * 模型执行阶段的文件读取与 `ModelFileContent` 转换由 `SessionModelMessages` 负责。
 */

import type { SessionPromptPart } from "@/types/session/SessionContent.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 在用户 prompt 入库前持久化 Data URL 文件。 */
export async function persist_user_prompt_file_parts(
  parts: SessionPromptPart[],
  attachment_store: SessionAttachmentStore,
): Promise<SessionPromptPart[]> {
  const output: SessionPromptPart[] = [];
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
    output.push({ ...part, url: stored_path });
  }
  return output;
}
