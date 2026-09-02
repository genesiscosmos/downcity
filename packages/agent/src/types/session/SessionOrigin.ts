/**
 * Session 来源元数据。
 *
 * Session 始终归 Agent 所有。来源类型同时承担业务分类与物理存储分区职责，
 * `chat` 是默认分区，Group、Task 或其他调用方可以声明自己的稳定类型。
 */

import type { JsonValue } from "@/types/common/Json.js";

/** Session 的创建来源。 */
export type SessionOrigin = {
  /**
   * 来源类型，同时作为 Session Store 的一级分区名。
   *
   * 该值必须是非空字符串；`chat` 表示普通聊天，其他稳定值由创建方定义。
   */
  readonly type: string;
  /**
   * 创建方附加的可序列化来源信息。
   *
   * 除 `type` 外的字段由创建方拥有、校验和解释，Agent 核心只负责完整持久化。
   */
  readonly [key: string]: JsonValue;
};
