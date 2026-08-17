/** Chat Composer 专用附件与消息引用 Tiptap 原子节点。 */

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { TbFile, TbPhoto, TbQuote, TbX } from "react-icons/tb";
import type { ChatAttachmentNodeAttributes, ChatReferenceNodeAttributes } from "@/types/ChatComposer";

/** 编辑器内附件的紧凑预览。 */
function ChatAttachmentView({ node, deleteNode }: NodeViewProps) {
  const attributes = node.attrs as ChatAttachmentNodeAttributes;
  const image = attributes.media_type.startsWith("image/");
  return <NodeViewWrapper as="span" className="mx-0.5 inline align-baseline">
    <span contentEditable={false} className="mention group/chat-attachment relative inline-flex max-w-[14rem] items-center rounded-md bg-foreground/[0.08] align-middle text-[0.6875rem] font-medium text-foreground/88 shadow-none transition-colors [box-shadow:none] [filter:none] hover:bg-foreground/[0.12]">
      <span className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-[inherit] px-1.5 py-0.5 text-left outline-none">
        {image ? <span className="inline-flex size-4 shrink-0 overflow-hidden rounded bg-foreground/[0.08] transition-opacity group-hover/chat-attachment:opacity-0 group-focus-within/chat-attachment:opacity-0"><img src={attributes.data_url} alt="" className="size-full object-cover" draggable={false} /></span> : <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/75 transition-opacity group-hover/chat-attachment:opacity-0 group-focus-within/chat-attachment:opacity-0"><TbFile className="size-3" /></span>}
        <span className="min-w-0 truncate leading-4">{attributes.filename}</span>
      </span>
      <button type="button" className="absolute left-1 top-1/2 inline-flex size-3.5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-all hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover/chat-attachment:opacity-100 group-focus-within/chat-attachment:opacity-100" title="移除附件" onClick={deleteNode}><TbX className="size-2.5" /></button>
    </span>
  </NodeViewWrapper>;
}

/** 编辑器内消息引用的紧凑预览。 */
function ChatReferenceView({ node, deleteNode }: NodeViewProps) {
  const attributes = node.attrs as ChatReferenceNodeAttributes;
  return <NodeViewWrapper as="span" className="mx-0.5 inline align-baseline">
    <span contentEditable={false} className="group/chat-ref relative inline-flex max-w-[16rem] items-center rounded-lg bg-foreground/[0.09] align-middle text-[0.6875rem] text-foreground/88 shadow-none [box-shadow:none] [filter:none]">
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-[inherit] px-1.5 py-1 text-left outline-none transition-colors hover:bg-foreground/[0.06]">
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md text-muted-foreground/75 transition-opacity group-hover/chat-ref:opacity-0 group-focus-within/chat-ref:opacity-0"><TbQuote className="size-3" /></span>
        <span className="min-w-0 truncate font-medium leading-4">{attributes.preview_text}</span>
      </span>
      <button type="button" className="absolute left-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-all hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 group-hover/chat-ref:opacity-100 group-focus-within/chat-ref:opacity-100" title="移除引用" onClick={deleteNode}><TbX className="size-2.5" /></button>
    </span>
  </NodeViewWrapper>;
}

/** 文件或图片附件节点。 */
export const ChatAttachmentNode = Node.create({
  name: "chatAttachment",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ attachment_id: { default: "" }, filename: { default: "" }, media_type: { default: "application/octet-stream" }, data_url: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-chat-attachment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-chat-attachment": "" })],
  addNodeView: () => ReactNodeViewRenderer(ChatAttachmentView),
});

/** 历史消息引用节点。 */
export const ChatReferenceNode = Node.create({
  name: "chatReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ message_id: { default: "" }, role: { default: "assistant" }, text: { default: "" }, preview_text: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-chat-reference]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-chat-reference": "" })],
  addNodeView: () => ReactNodeViewRenderer(ChatReferenceView),
});

/** 根据附件类型返回菜单使用的图标。 */
export function ChatAttachmentIcon({ media_type }: { /** 附件 MIME 类型。 */ media_type: string }) {
  return media_type.startsWith("image/") ? <TbPhoto /> : <TbFile />;
}
