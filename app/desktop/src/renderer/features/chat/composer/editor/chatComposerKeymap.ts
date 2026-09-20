import type { JSONContent } from "@tiptap/core";

/** Chat Composer 对 Enter 系列按键的统一处理结果。 */
export type ChatComposerEnterAction = "native" | "submit" | "queue-paused" | "submit-immediately";

/** 解析快捷键所需的最小键盘事件。 */
export interface ChatComposerEnterKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/**
 * 只有“文档中恰好一个段落，且段落只包含普通文本”时，裸 Enter 才发送。
 * hardBreak、附件、引用等所有非 text inline node 都会使裸 Enter 回到原生换行。
 */
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
 * Enter：单个纯文本段落发送，否则原生换行。
 * Shift + Enter：插入新段落（与 Enter 一致），由 chatComposerNewline 扩展接管。
 * Cmd/Ctrl + Enter：按常规发送策略提交（运行中或已有队列时会排队）。
 * Option/Alt + Cmd/Ctrl + Enter：创建或插入暂停队列。
 * Cmd/Ctrl + Shift + Enter：绕过队列立即提交。
 *
 * `multiline` 下裸 Enter 不再发送：面板里的大输入区就是为写长内容准备的，
 * 回车必须始终是换行，提交只剩显式修饰键这一条路。规则写在这里而不是组件里，
 * 因为它是「按键 → 行为」的纯映射，可以被单测直接钉住。
 */
export function resolve_chat_composer_enter_action(
  event: ChatComposerEnterKey,
  document: JSONContent | undefined,
  /** 当前输入区是否以多行书写为主（展开在右侧面板时）。 */
  multiline = false,
): ChatComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "native";
  if (multiline && is_plain_enter(event)) return "native";
  const has_command_modifier = event.metaKey || event.ctrlKey;
  if (has_command_modifier && event.shiftKey) return "submit-immediately";
  if (has_command_modifier && event.altKey) return "queue-paused";
  if (event.shiftKey || event.altKey) return "native";
  if (has_command_modifier) return "submit";
  return is_single_plain_text_paragraph(document) ? "submit" : "native";
}

/** 候选菜单只消费不带修饰键的 Enter，避免覆盖换行和提交快捷键。 */
export function is_plain_enter(event: ChatComposerEnterKey): boolean {
  return event.key === "Enter"
    && !event.isComposing
    && !event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey;
}
