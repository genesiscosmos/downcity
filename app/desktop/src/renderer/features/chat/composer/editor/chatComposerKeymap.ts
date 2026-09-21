import type { JSONContent } from "@tiptap/core";
import { read_chat_composer_code_fence } from "../../../../../common/chat/chatComposerCodeFence.ts";

/** Chat Composer 对 Enter 系列按键的统一处理结果。 */
export type ChatComposerEnterAction = "native" | "submit" | "queue-paused" | "submit-immediately" | "code-fence";

/** 解析快捷键所需的最小键盘事件。 */
export interface ChatComposerEnterKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/** 判断裸 Enter 是否要转成代码块所需的文档上下文。 */
export interface ChatComposerEnterContext {
  /**
   * 光标所在文本块内、光标之前的纯文本。
   *
   * 只给纯文本块：代码块里的 ``` 是字面量，不该再开一层代码块。
   */
  block_text?: string;
  /** 光标是否位于代码块内部。 */
  in_code?: boolean;
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
 *
 * ## 判定顺序（改这里前必读）
 *
 * 修饰键在最前：显式提交永远优先于文档结构，否则在代码块里按 Cmd/Ctrl + Enter 会发不出去。
 * 之后是 `in_code`：代码块里的回车必须是换行，否则无法写多行代码。
 * 再之后才是围栏识别，**排在 `multiline` 之前**——展开面板正是写和贴代码的主场，
 * 那里如果先被 `multiline` 拦成换行，代码块就只能靠 Slash 菜单开。
 * 围栏动作本身不提交，所以面板「回车只换行、提交只走修饰键」的不变量仍然成立。
 */
export function resolve_chat_composer_enter_action(
  event: ChatComposerEnterKey,
  document: JSONContent | undefined,
  /** 当前输入区是否以多行书写为主（展开在右侧面板时）。 */
  multiline = false,
  /** 判断围栏所需的文档上下文；缺省时按「不在代码块、无块内文本」处理。 */
  context: ChatComposerEnterContext = {},
): ChatComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "native";
  const has_command_modifier = event.metaKey || event.ctrlKey;
  if (has_command_modifier && event.shiftKey) return "submit-immediately";
  if (has_command_modifier && event.altKey) return "queue-paused";
  if (event.shiftKey || event.altKey) return "native";
  if (has_command_modifier) return "submit";
  if (context.in_code) return "native";
  if (context.block_text !== undefined && read_chat_composer_code_fence(context.block_text)) return "code-fence";
  if (multiline) return "native";
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
