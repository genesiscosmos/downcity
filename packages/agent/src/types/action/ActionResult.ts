/**
 * Action 与 Session Tool 共用的执行结果协议。
 *
 * 关键点（中文）
 * - `output` 是标准 Tool Result，原样交给模型执行器和 canonical Tool Part。
 * - `messages` 是执行后产生的运行期 User 输入或 canonical Agent 内容。
 * - `effects` 是当前 Turn 只追加收集、并在收口检查点解释的已发生副作用。
 * - Message Parts 复用 Downcity Session UI 协议，不再建立文件、图片或 Plugin 专用桥接。
 */

import type { RuntimeToolEffect } from "@downcity/type";
import type {
  SessionAgentContent,
  SessionModelUserContent,
} from "@downcity/type";

/** Action 执行后产生的一条 Session 消息。 */
export type ActionResultMessage =
  | {
      /** User 内容在下一 Step 生效。 */
      role: "user";
      /** 只在当前 Turn 生效、不会伪装成 canonical Message 的模型输入。 */
      parts: SessionModelUserContent[];
    }
  | {
      /** Agent 内容写入当前 canonical 回复。 */
      role: "agent";
      /** 等待追加到 canonical Agent Message 的内容。 */
      parts: SessionAgentContent[];
    };

/** Action 或 Tool 内部实现返回的统一结果。 */
export interface ActionResult<TOutput = unknown> {
  /** 返回给调用方、模型执行器与 canonical Tool Part 的标准执行输出。 */
  output: TOutput;

  /** 执行产生的运行期 User 输入或 Agent 输出；没有附加内容时传入空数组。 */
  messages: ActionResultMessage[];

  /** 已经发生且需要由当前 Turn 收集的副作用；不会发送给模型或直接持久化。 */
  effects?: readonly RuntimeToolEffect[];
}

/** 判断未知 Tool 输出是否使用统一 ActionResult 协议。 */
export function is_action_result(value: unknown): value is ActionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "output") &&
    Array.isArray(record.messages);
}
