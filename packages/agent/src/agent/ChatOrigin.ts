/**
 * Agent 主对话的持久身份。
 *
 * 职责说明（中文）
 * - 主对话是 Agent 自己的那段 Session：它代表 Agent，用户通过它说话。
 * - 身份直接复用 `SessionOrigin.type`：来源类型本来同时承担「这是哪一类会话」与
 *   「它存在哪个分区」，`task`、`group` 使用同一机制。
 * - 因此这里只有两个常量与一个判定函数，不引入新的字段、索引或存储概念。
 *
 * 关键点（中文）
 * - 一个 Agent 至多一条主对话。惰性创建，被归档或删除后下一次 `chat()` 自然重建。
 * - 主对话是普通 Session，除身份与工具集合外没有特殊行为。
 */

import type { SessionOrigin } from "@downcity/type";

/** 主对话来源类型；同时作为 Session Store 的来源分区名。 */
export const CHAT_ORIGIN_TYPE = "main";

/**
 * 主对话固定的 Session 标识。
 *
 * 关键点（中文）：同一 Agent 的分区内只有一条主对话，因此用固定标识即可确定性定位，
 * 不需要额外索引或空闲 id 扫描。
 */
export const MAIN_SESSION_ID = "main";

/** 主对话的完整来源；主对话不携带额外业务字段。 */
export const CHAT_ORIGIN: SessionOrigin = Object.freeze({ type: CHAT_ORIGIN_TYPE });

/** 判断一个来源是否表示 Agent 的主对话。 */
export function is_chat_origin(origin: { type?: string } | undefined): boolean {
  return String(origin?.type || "").trim() === CHAT_ORIGIN_TYPE;
}
