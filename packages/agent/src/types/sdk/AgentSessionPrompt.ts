/**
 * Agent Session prompt 输入类型定义。
 *
 * 关键点（中文）
 * - `prompt()` 是 Session actor 模型下唯一的输入入口。
 * - 首条输入、运行中补充输入、排队到下一轮的输入，调用侧都使用同一结构。
 */

import type { UIDataTypes, UITools, UIMessagePart } from "ai";

/**
 * Session user message part 类型。
 *
 * 说明（中文）
 * - 与 AI SDK 标准 `UIMessagePart` 等价，但已固定泛型参数，避免调用侧引入 `ai` 包。
 * - 可直接用于 `session.prompt({ query: [...parts] })` 传入 text parts、file parts 等。
 */
export type SessionUserMessagePart = UIMessagePart<UIDataTypes, UITools>;

/**
 * Session prompt 输入。
 */
export interface AgentSessionPromptInput {
  /**
   * 当前这次要追加到 Session 的用户文本或 parts 数组。
   *
   * 说明（中文）
   * - 支持两种格式：
   *   1. `string`：纯文本用户输入，Session 会将其包装为 `role="user"` 的 UIMessage。
   *   2. `SessionUserMessagePart[]`：AI SDK 标准 user message parts 数组，可直接携带 text parts、file parts 等。
   * - 调用侧永远只传"新的用户输入"。
   * - 它是否并入当前 turn，还是排到下一 turn，由 Session 内部决定。
   */
  query: string | SessionUserMessagePart[];
}

/**
 * 判断 prompt 输入是否为空。
 *
 * 说明（中文）
 * - `string`：trim 后为空即视为空。
 * - `SessionUserMessagePart[]`：数组为空或仅包含空文本时视为空。
 */
export function is_agent_session_prompt_input_empty(input: AgentSessionPromptInput): boolean {
  const query = input.query;
  if (typeof query === "string") {
    return query.trim() === "";
  }
  if (Array.isArray(query)) {
    if (query.length === 0) {
      return true;
    }
    // 如果所有 parts 都是空文本，也视为空
    return query.every((part) => {
      if (part && typeof part === "object" && "type" in part && part.type === "text") {
        return String(part.text ?? "").trim() === "";
      }
      return false; // 非文本 part（如 file）不算空
    });
  }
  return true;
}
