/** 按 canonical part 原始顺序展示用户消息正文、引用与附件。 */

import type { SessionUserMessagePart } from "@downcity/agent";
import { is_chat_runtime_context_tag } from "@downcity/type";
import { TbFile, TbQuote } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { chat_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 用户消息的有序内容展示；普通文本与原子节点保持 Composer 中的 inline 流。 */
export function UserMessageContent({ message_id, parts }: { /** canonical 用户消息标识。 */ message_id: string; /** 保持发送顺序的 canonical 内容。 */ parts: SessionUserMessagePart[] }) {
  const translate_chat = use_translation("chat");
  return <div className="user-message-content" data-chat-selectable-message data-chat-message-id={message_id} data-chat-message-role="user">{parts.map((part) => {
    if (part.type === "text") return part.text ? <div key={part.part_id} className={cn("user-message-text-part", chat_message_text_class_name, is_inline_text(part.text) && "is-inline")}><Markdown text={part.text} mode="static" /></div> : null;
    if (part.type === "context" && is_chat_runtime_context_tag(part.tag)) return null;
    if (part.type === "context" && part.tag === "reference") return <span key={part.part_id} className="user-message-atom user-message-reference" title={part.context}>
      <TbQuote aria-hidden /><span>{part.context.replace(/\s+/gu, " ").trim()}</span>
    </span>;
    if (part.type === "file") {
      const image = is_image_attachment(part.media_type, part.url, part.filename);
      return <a key={part.part_id} href={part.url} target="_blank" rel="noreferrer" className="user-message-atom user-message-attachment" title={part.filename || translate_chat("activity.file")}>
        {image ? <span className="user-message-image-thumbnail"><img src={part.url} alt="" draggable={false} /></span> : <TbFile aria-hidden />}
        <span>{part.filename || translate_chat("activity.file")}</span>
      </a>;
    }
    return null;
  })}</div>;
}

/** 无块级 Markdown 语义的文本可与相邻 attachment/reference 保持同一行。 */
function is_inline_text(text: string): boolean {
  return !/(?:^|\n)\s*(?:#{1,6}\s|[-+*]\s|\d+\.\s|>|```|~~~)|\n\s*\n/u.test(text);
}

/** Clipboard 图片的 MIME 可能退化为 octet-stream，因此同时检查 Data URL 与文件扩展名。 */
function is_image_attachment(media_type: string, url: string, filename?: string): boolean {
  if (media_type.toLowerCase().startsWith("image/")) return true;
  if (/^data:image\//iu.test(url)) return true;
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/iu.test(filename || "");
}
