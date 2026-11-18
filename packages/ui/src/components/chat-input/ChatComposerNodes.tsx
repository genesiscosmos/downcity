/** Chat Composer 专用附件、消息与文件引用 Tiptap 原子节点。 */

import { read_reference_payload, reference_payload } from "./chatReferenceClipboard";
import { chat_reference_plain_text } from "./session-reference";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { TbBraces, TbFile, TbPhoto, TbX } from "./input-icons";
import { InputAttachment as ChatAttachmentBlock } from "./host";
import type { ChatAttachmentNodeAttributes, ChatDataNodeAttributes, ChatReferenceNodeAttributes } from "../../types/chat-input";
import { InputReference as ChatReferenceBlock } from "./host";
import { use_chat_input_host } from "./host";

/** 编辑器内附件沿正文基线排布，与引用保持一致，避免外层居中造成胶囊下偏。 */
function ChatAttachmentView({ node, deleteNode, editor }: NodeViewProps) {
  const attributes = node.attrs as ChatAttachmentNodeAttributes;
  return <NodeViewWrapper as="span" className="inline align-baseline">
    <span contentEditable={false}><ChatAttachmentBlock attachment={{ attachment_id: attributes.attachment_id, filename: attributes.filename, media_type: attributes.media_type, url: attributes.data_url }} on_remove={editor.isEditable ? deleteNode : undefined} /></span>
  </NodeViewWrapper>;
}

/** 引用节点沿正文基线排布，避免外层再次居中导致胶囊文字偏移；点击预览完整内容。 */
function ChatReferenceView({ node, deleteNode, editor }: NodeViewProps) {
  const translate = use_chat_input_host().translate;
  const attributes = node.attrs as ChatReferenceNodeAttributes;
  return <NodeViewWrapper as="span" className="inline align-baseline"><span contentEditable={false}><ChatReferenceBlock reference={attributes} on_remove={editor.isEditable ? deleteNode : undefined} remove_label={translate("composer.remove_reference")} /></span></NodeViewWrapper>;
}

/** 编辑器内结构化数据 part 的紧凑预览。 */
function ChatDataView({ node, deleteNode }: NodeViewProps) {
  const attributes = node.attrs as ChatDataNodeAttributes;
  return <NodeViewWrapper as="span" className="mx-0.5 inline align-baseline">
    <span contentEditable={false} className="group/chat-data relative inline-flex max-w-[16rem] items-center rounded-control bg-surface-emphasis align-middle text-2xs font-medium text-foreground">
      <span className="inline-flex min-w-0 items-center gap-1 px-1.5 py-0.5"><TbBraces className="size-3 text-muted-foreground" /><span className="truncate">{attributes.data_type}</span></span>
      <button type="button" className="mr-1 inline-flex size-3.5 items-center justify-center rounded-chip text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/chat-data:opacity-100" onClick={deleteNode}><TbX className="size-2.5" /></button>
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

/** 消息与文件选区引用节点；文件来源字段随编辑文档持久化。 */
export const ChatReferenceNode = Node.create({
  name: "chatReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // 属性只从经过验证的协议读取，禁止普通 HTML 属性覆盖已校验字段。
  addAttributes: () => Object.fromEntries(Object.entries({ source_title: { default: null }, task_id: { default: null }, run_timestamp: { default: null }, message_id: { default: "" }, role: { default: null }, workspace_id: { default: null }, relative_path: { default: null }, line_start: { default: null }, line_end: { default: null }, tag: { default: "reference" }, text: { default: "" }, preview_text: { default: "" } }).map(([name, attribute]) => [name, { ...attribute, rendered: false, parseHTML: () => null }])),
  parseHTML: () => [{ tag: "span[data-chat-reference][data-downcity-reference]", getAttrs: (element) => {
    const reference = read_reference_payload(element.getAttribute("data-downcity-reference") || "");
    return reference ? { ...reference, preview_text: reference.source_title || reference.text.replace(/\s+/g, " ").slice(0, 80) } : false;
  } }],
  renderHTML: ({ node }) => {
    const reference = node.attrs as ChatReferenceNodeAttributes;
    return ["span", { "data-chat-reference": "", "data-downcity-reference": reference_payload(reference) }, chat_reference_plain_text(reference)];
  },
  renderText: ({ node }) => chat_reference_plain_text(node.attrs as ChatReferenceNodeAttributes),
  addNodeView: () => ReactNodeViewRenderer(ChatReferenceView),
});

/** 需要在历史消息重写时保持顺序的结构化数据节点。 */
export const ChatDataNode = Node.create({
  name: "chatData",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ data_type: { default: "" }, data: { default: null }, data_id: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-chat-data]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-chat-data": "" })],
  addNodeView: () => ReactNodeViewRenderer(ChatDataView),
});

/** 根据附件类型返回菜单使用的图标。 */
export function ChatAttachmentIcon({ media_type }: { /** 附件 MIME 类型。 */ media_type: string }) {
  return media_type.startsWith("image/") ? <TbPhoto /> : <TbFile />;
}
