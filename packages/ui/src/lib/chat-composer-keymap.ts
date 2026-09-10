import type { JSONContent } from "@tiptap/core";

/** Chat Composer 对 Enter 系列按键的统一处理结果。 */
export type DowncityChatComposerEnterAction = "native" | "submit" | "queue-paused" | "submit-immediately";

/** 解析快捷键所需的最小键盘事件。 */
export interface DowncityChatComposerEnterKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
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

/** 统一解析 Enter、Shift+Enter、Cmd/Ctrl+Enter、Option/Alt+Cmd/Ctrl+Enter 与 Cmd/Ctrl+Shift+Enter。 */
export function resolve_chat_composer_enter_action(
  event: DowncityChatComposerEnterKey,
  document: JSONContent | undefined,
): DowncityChatComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "native";
  const has_command_modifier = event.metaKey || event.ctrlKey;
  if (has_command_modifier && event.shiftKey) return "submit-immediately";
  if (has_command_modifier && event.altKey) return "queue-paused";
  if (event.shiftKey || event.altKey) return "native";
  if (has_command_modifier) return "submit";
  return is_single_plain_text_paragraph(document) ? "submit" : "native";
}
