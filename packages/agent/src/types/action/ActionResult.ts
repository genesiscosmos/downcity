/**
 * Action 与 Session Tool 共用的执行结果协议。
 *
 * 关键点（中文）
 * - `output` 是标准 Tool Result，原样交给 AI SDK 和 canonical Tool Part。
 * - `messages` 是执行后写入 Session 的真实 User / Assistant Message 内容。
 * - Message Parts 直接复用 AI SDK UIMessage 协议，不再建立文件、图片或 Plugin 专用桥接。
 */

import type { UIMessage } from "ai";

/** Action 执行后产生的一条 Session 消息。 */
export interface ActionResultMessage {
  /** 消息归属；User 消息在下一 Step 生效，Assistant Parts 写入当前回复。 */
  role: "user" | "assistant";

  /** 应写入对应 Session Message 的标准 UI Parts。 */
  parts: UIMessage["parts"];
}

/** Action 或 Tool 内部实现返回的统一结果。 */
export interface ActionResult<TOutput = unknown> {
  /** 返回给调用方、AI SDK 与 canonical Tool Part 的标准执行输出。 */
  output: TOutput;

  /** 执行产生的真实 Session 消息；没有附加消息时传入空数组。 */
  messages: ActionResultMessage[];
}

/** 判断未知 Tool 输出是否使用统一 ActionResult 协议。 */
export function is_action_result(value: unknown): value is ActionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "output") &&
    Array.isArray(record.messages);
}
