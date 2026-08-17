/** Chat Composer JSON 与 Desktop 提交输入之间的无状态转换。 */

import type { JSONContent } from "@tiptap/core";
import type { DesktopChatFileInput, DesktopChatInput, DesktopChatReferenceInput } from "@common/types/DesktopApi";
import type { ChatAttachmentNodeAttributes, ChatReferenceNodeAttributes } from "@/types/ChatComposer";

/** 从编辑文档中提取可提交的正文、附件和引用。 */
export function decode_chat_composer(document: JSONContent): DesktopChatInput {
  const text_blocks: string[] = [];
  const files: DesktopChatFileInput[] = [];
  const references: DesktopChatReferenceInput[] = [];

  const visit = (node: JSONContent) => {
    if (node.type === "text" && node.text) text_blocks.push(node.text);
    if (node.type === "hardBreak") text_blocks.push("\n");
    if (node.type === "paragraph" && text_blocks.length > 0 && text_blocks[text_blocks.length - 1] !== "\n") text_blocks.push("\n");
    if (node.type === "chatAttachment") {
      const attributes = node.attrs as ChatAttachmentNodeAttributes;
      files.push({ filename: attributes.filename, media_type: attributes.media_type, data_url: attributes.data_url });
    }
    if (node.type === "chatReference") {
      const attributes = node.attrs as ChatReferenceNodeAttributes;
      references.push({ message_id: attributes.message_id, role: attributes.role, text: attributes.text });
    }
    node.content?.forEach(visit);
  };
  document.content?.forEach(visit);
  return { text: text_blocks.join("").trim(), files, references };
}

/** 从受控草稿构造一份可恢复的编辑文档。 */
export function encode_chat_composer(text: string, files: DesktopChatFileInput[], references: DesktopChatReferenceInput[]): JSONContent {
  const inline_content: JSONContent[] = [];
  for (const reference of references) {
    inline_content.push({ type: "chatReference", attrs: { ...reference, preview_text: reference.text.replace(/\s+/g, " ").trim().slice(0, 80) } });
  }
  for (const file of files) {
    inline_content.push({ type: "chatAttachment", attrs: { ...file, attachment_id: crypto.randomUUID() } });
  }
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) inline_content.push({ type: "hardBreak" });
    if (line) inline_content.push({ type: "text", text: line });
  });
  return { type: "doc", content: [{ type: "paragraph", content: inline_content.length > 0 ? inline_content : undefined }] };
}
