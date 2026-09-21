import type { JSONContent } from "@tiptap/core";
import { read_chat_composer_code_fence } from "./chat-composer-code-fence";

/** Chat Composer 对 Enter 系列按键的统一处理结果。 */
export type DowncityChatComposerEnterAction = "native" | "submit" | "queue-paused" | "submit-immediately" | "code-fence";

/** 解析快捷键所需的最小键盘事件。 */
export interface DowncityChatComposerEnterKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/** 判断裸 Enter 是否要转成代码块所需的文档上下文。 */
export interface DowncityChatComposerEnterContext {
  /** 光标所在文本块内、光标之前的纯文本。 */
  block_text?: string;
  /** 光标是否位于代码块内部。 */
  in_code?: boolean;
}

/** 只有恰好一个、仅含普通文本的 paragraph 才允许裸 Enter 发送。 */
export function is_single_plain_text_paragraph(document: JSONContent | undefined): boolean {
  if (document?.type !== "doc" || document.content?.length !== 1) return false;
  const paragraph = document.content[0];
  const content = paragraph?.content ?? [];
  return paragraph?.type === "paragraph"
    && content.length > 0
    && content.every((node) => node.type === "text")
    && content.some((node) => node.text?.trim());
}

/**
 * 统一解析 Enter、Shift+Enter、Cmd/Ctrl+Enter、Option/Alt+Cmd/Ctrl+Enter 与 Cmd/Ctrl+Shift+Enter。
 *
 * ## 判定顺序（改这里前必读）
 *
 * 修饰键在最前：显式提交永远优先于文档结构，否则在代码块里按 Cmd/Ctrl + Enter 会发不出去。
 * 之后是 `in_code`：代码块里的回车必须是换行，否则无法写多行代码。
 * 再之后才是围栏识别——它本身不提交，只把围栏行转成代码块，
 * 因此不破坏「Enter 提交、修饰键控制队列」的既有语义。
 */
export function resolve_chat_composer_enter_action(
  event: DowncityChatComposerEnterKey,
  document: JSONContent | undefined,
  context: DowncityChatComposerEnterContext = {},
): DowncityChatComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "native";
  const has_command_modifier = event.metaKey || event.ctrlKey;
  if (has_command_modifier && event.shiftKey) return "submit-immediately";
  if (has_command_modifier && event.altKey) return "queue-paused";
  if (event.shiftKey || event.altKey) return "native";
  if (has_command_modifier) return "submit";
  if (context.in_code) return "native";
  if (context.block_text !== undefined && read_chat_composer_code_fence(context.block_text)) return "code-fence";
  return is_single_plain_text_paragraph(document) ? "submit" : "native";
}
