/** Chat Composer 与历史消息编辑器共用的 Tiptap schema。 */

import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { ChatAttachmentNode, ChatDataNode, ChatReferenceNode } from "./ChatComposerNodes";
import { ChatComposerNewline } from "./chatComposerNewline";
import { ChatComposerCodeLanguage } from "./chatComposerCodeFence";

/**
 * 创建一组彼此隔离、语义一致的 Chat Composer extensions。
 *
 * ## codeBlock 为什么是开的
 *
 * 它曾经被关掉，后果是「输入框里写不了代码块」：围栏 input rule 挂在 CodeBlock 扩展上，
 * 扩展不注册就永远不会触发，敲 ``` 只是三个字符，而且会撞上「单个纯文本段落就发送」的规则，
 * 把消息直接发出去。
 *
 * 四个选项都是有意取值：
 * - `defaultLanguage: null`：不静默给一个语言。聊天里的语言只影响气泡上的标签文字，
 *   猜错了比空着更坏。语言只来自用户显式写的围栏。
 * - `enableTabIndentation: false`：Tab 必须能移出输入框。在输入框里把 Tab 变成缩进
 *   会形成键盘陷阱（WCAG 2.1.2），用户只能用鼠标离开。
 * - `exitOnTripleEnter` / `exitOnArrowDown` / `exitOnArrowUp`：保留退出代码块的标准路径。
 *   写代码块的人需要一条不碰鼠标就能回到正文的路，否则块会一直粘在光标后面。
 *
 * `blockquote` 与 `horizontalRule` 仍然关着：它们不是本次要解决的问题，
 * 开启会顺带改变普通文本的序列化行为（引用块会变成 `> ` 前缀），属于另一件事。
 */
export function create_chat_composer_extensions(placeholder?: string) {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      horizontalRule: false,
      codeBlock: {
        defaultLanguage: null,
        enableTabIndentation: false,
        exitOnTripleEnter: true,
        exitOnArrowDown: true,
        exitOnArrowUp: true,
      },
    }),
    ChatComposerNewline,
    ChatComposerCodeLanguage,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ChatAttachmentNode,
    ChatReferenceNode,
    ChatDataNode,
  ];
}
