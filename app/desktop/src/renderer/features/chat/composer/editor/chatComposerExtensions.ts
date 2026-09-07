/** Chat Composer 与历史消息编辑器共用的 Tiptap schema。 */

import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { ChatAttachmentNode, ChatDataNode, ChatReferenceNode } from "./ChatComposerNodes";

/** 创建一组彼此隔离、语义一致的 Chat Composer extensions。 */
export function create_chat_composer_extensions(placeholder?: string) {
  return [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ChatAttachmentNode,
    ChatReferenceNode,
    ChatDataNode,
  ];
}
