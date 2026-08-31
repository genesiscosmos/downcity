/**
 * Agent Session prompt 输入类型定义。
 *
 * 关键点（中文）
 * - `prompt()` 是 Session actor 模型下唯一的输入入口。
 * - 首条输入、运行中补充输入、排队到下一轮的输入，调用侧都使用同一结构。
 */

import type { SessionPromptPart } from "@/types/session/SessionContent.js";

/**
 * Session user message part 类型。
 *
 * 说明（中文）
 * - 这是 Downcity Session 输入边界，不依赖模型协议或第三方 SDK。
 * - 可直接用于 `session.prompt({ query: [...parts] })` 传入 text parts、file parts 等。
 */
export type SessionUserMessagePart = SessionPromptPart;

/**
 * Session prompt 输入。
 *
 * 输入示例（中文）：
 * ```ts
 * session.prompt({
 *   query: [
 *     { type: "text", text: "请分析这个附件" },
 *     {
 *       type: "file",
 *       media_type: "image/png",
 *       url: "data:image/png;base64,...",
 *       filename: "image.png",
 *     },
 *   ],
 * });
 * ```
 *
 * 生命周期说明（中文）：
 * - `string` 会直接成为新的文本 User Message。
 * - `file` part 如果携带 Data URL，会在 Message 入库前解码到 Session 的 attachments 目录。
 * - 持久化 Message 里的 `url` 变成相对 Workspace 根目录的文件路径，而不是 Base64 内容。
 * - 模型执行前，Executor 再按该路径读取文件，并转换成 Downcity `ModelMessage`。
 * - 远程 Session 中，Data URL 在服务端落盘；调用方本地路径必须对服务端可访问。
 */
export interface AgentSessionPromptInput {
  /**
   * 当前这次要追加到 Session 的用户文本或 parts 数组。
   *
   * 说明（中文）
   * - 支持两种格式：
   *   1. `string`：纯文本用户输入，Session 会将其包装为用户消息。
   *   2. `SessionUserMessagePart[]`：Downcity Session user parts，可直接携带 text、file 等内容。
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
      return part.type === "text" && part.text.trim() === "";
    });
  }
  return true;
}
