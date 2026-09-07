/** 按 canonical part 原始顺序展示用户消息正文、引用与附件。 */

import type { SessionUserMessagePart } from "@downcity/agent";
import { TbFile } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { use_translation } from "@/locales/i18n";

/** 用户消息的有序内容展示。 */
export function UserMessageContent({ message_id, parts }: { /** canonical 用户消息标识。 */ message_id: string; /** 保持发送顺序的 canonical 内容。 */ parts: SessionUserMessagePart[] }) {
  const translate_chat = use_translation("chat");
  return <>{parts.map((part) => {
    if (part.type === "text") return part.text ? <div
      key={part.part_id}
      data-chat-selectable-message
      data-chat-message-id={message_id}
      data-chat-message-role="user"
      className="text-[0.8125rem] leading-[1.34]"
    ><Markdown text={part.text} mode="static" /></div> : null;
    if (part.type === "context" && part.tag === "reference") return <div key={part.part_id} className="max-w-full border-l-2 border-foreground/15 pl-2 text-[0.75rem] text-muted-foreground">
      <Markdown text={part.context} mode="static" />
    </div>;
    if (part.type === "file") {
      const image = part.media_type.startsWith("image/");
      return <a key={part.part_id} href={part.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 self-start rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4 text-foreground/88 transition-colors hover:bg-foreground/[0.1]">
        {image ? <span className="inline-flex size-4 shrink-0 overflow-hidden rounded bg-foreground/[0.08]"><img src={part.url} alt="" className="size-full object-cover" /></span> : <TbFile className="size-3.5 shrink-0 text-muted-foreground/75" />}
        <span className="truncate">{part.filename || translate_chat("activity.file")}</span>
      </a>;
    }
    return null;
  })}</>;
}
