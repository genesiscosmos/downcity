/**
 * Downcity 模型消息协议模块。
 *
 * ModelMessage 只表达模型上下文，不承担 Session 持久化或 UI 时间线职责。
 */

import type { ModelContent } from "./ModelContent.js";

/** 模型上下文中的标准消息。 */
export interface ModelMessage {
  /** 消息在模型上下文中的角色。 */
  role: "system" | "user" | "assistant" | "tool";
  /** 按原始上下文顺序排列的消息内容。 */
  content: ModelContent[];
}
