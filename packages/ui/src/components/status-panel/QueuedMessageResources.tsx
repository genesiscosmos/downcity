/** 队列仅展示引用与附件的原始原子节点，复用输入区和历史消息的资源组件。 */
import type { QueuedMessageResourcesProps } from "../../types/status-panel";
import type { JSONContent } from "@tiptap/core";
import type { ChatAttachmentNodeAttributes, ChatReferenceNodeAttributes } from "../../types/chat-input";
import { InputAttachment as ChatAttachmentBlock, InputReference as ChatReferenceBlock, ChatInputHostProvider } from "../chat-input/host";

/** 按文档顺序取资源节点；不改写队列中保存的输入。 */
function resource_nodes(node: JSONContent): JSONContent[] {
  if (node.type === "chatAttachment" || node.type === "chatReference") return [node];
  return node.content?.flatMap(resource_nodes) ?? [];
}

/** 排队期间展示引用胶囊与可预览附件，不提供修改原子内容的操作。 */
export function QueuedMessageResources({ input, host }: QueuedMessageResourcesProps) {
  return <ChatInputHostProvider host={host}><span className="block min-w-0">{resource_nodes(input).map((node, index) => {
    if (node.type === "chatReference") return <ChatReferenceBlock key={index} reference={node.attrs as ChatReferenceNodeAttributes} />;
    const attributes = node.attrs as ChatAttachmentNodeAttributes;
    return <ChatAttachmentBlock key={index} attachment={{ attachment_id: attributes.attachment_id, filename: attributes.filename, media_type: attributes.media_type, url: attributes.data_url }} />;
  })}</span></ChatInputHostProvider>;
}
