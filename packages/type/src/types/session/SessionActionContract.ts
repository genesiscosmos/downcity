/**
 * Session system message 与 Action 结果的中立协议。
 *
 * 关键点（中文）
 * - 这些结构同时被 Agent 执行链与 Power 动作返回值使用，属于跨侧数据契约。
 * - 只描述数据形状，不引用任何实现包。
 */

import type { ToolEffect } from "../tool/ToolEffect.js";
import type {
  SessionAgentContent,
  SessionModelUserContent,
} from "./SessionContent.js";

/**
 * Session 运行阶段使用的 system message。
 *
 * 关键点（中文）
 * - 该类型属于 Downcity Session，不依赖第三方 Provider。
 */
export interface SessionSystemMessage {
  /** 消息角色固定为 system。 */
  role: "system";
  /** 当前 system block 的文本内容。 */
  content: string;
}

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

/**
 * Action 或 Tool 内部实现返回的统一结果。
 *
 * 关键点（中文）
 * - `output` 是标准 Tool Result，原样交给模型执行器和 canonical Tool Part。
 * - `messages` 是执行后产生的运行期 User 输入或 canonical Agent 内容。
 * - `effects` 是当前 Turn 只追加收集、并在收口检查点解释的已发生副作用。
 * - Message Parts 复用 Downcity Session UI 协议，不再建立文件、图片或 Power 专用桥接。
 */
export interface ActionResult<TOutput = unknown> {
  /** 返回给调用方、模型执行器与 canonical Tool Part 的标准执行输出。 */
  output: TOutput;

  /** 执行产生的运行期 User 输入或 Agent 输出；没有附加内容时传入空数组。 */
  messages: ActionResultMessage[];

  /** 已经发生且需要由当前 Turn 收集的副作用；不会发送给模型或直接持久化。 */
  effects?: readonly ToolEffect[];
}

/** 判断未知 Tool 输出是否使用统一 ActionResult 协议。 */
export function is_action_result(value: unknown): value is ActionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "output") &&
    Array.isArray(record.messages);
}
