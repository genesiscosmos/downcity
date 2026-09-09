/**
 * Session Message 聚合与 SQLite rows 之间的唯一 codec。
 *
 * Message envelope 与 Part 分表保存；公开领域对象仍保持 Message 聚合拥有 parts[]。
 */

import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";

/** messages 表读取行。 */
export interface SessionMessageRow {
  /** Message 稳定标识。 */
  message_id: string;
  /** 所属 Turn；独立 Session Action 可以为空。 */
  turn_id: string | null;
  /** Session 内 Message 顺序。 */
  sequence: number;
  /** Message 聚合版本。 */
  revision: number;
  /** Message 主体角色。 */
  role: "user" | "agent";
  /** User 输入类别。 */
  input_type: "prompt" | "steer" | null;
  /** Agent Message 生命周期状态。 */
  status: "streaming" | "completed" | "stopped" | "failed";
  /** 默认展示范围。 */
  visibility: "visible" | "internal";
  /** Fork 来源 Session。 */
  origin_session_id: string | null;
  /** Fork 来源 Message。 */
  origin_message_id: string | null;
  /** Fork 来源 Turn。 */
  origin_turn_id: string | null;
  /** 创建时间戳。 */
  created_at: number;
  /** 更新时间戳。 */
  updated_at: number;
}

/** message_parts 表读取行。 */
export interface SessionMessagePartRow {
  /** Part 稳定标识。 */
  part_id: string;
  /** 所属 Message。 */
  message_id: string;
  /** Message 内 Part 顺序。 */
  sequence: number;
  /** 来源模型 Step。 */
  step_id: string | null;
  /** Part 内容类型。 */
  type: SessionUserMessagePart["type"] | SessionAgentMessagePart["type"];
  /** 单个 Part 的类型专属 JSON 内容。 */
  content: string;
  /** 创建时间戳。 */
  created_at: number;
  /** 更新时间戳。 */
  updated_at: number;
}

/** 把 Message 聚合拆为数据库 envelope row。 */
export function encode_session_message_row(message: SessionMessage): SessionMessageRow {
  return {
    message_id: message.message_id,
    turn_id: message.turn_id ?? null,
    sequence: message.sequence,
    revision: message.revision,
    role: message.role,
    input_type: message.role === "user" ? message.input_type : null,
    status: message.role === "agent" ? message.status : "completed",
    visibility: message.visibility,
    origin_session_id: message.origin?.session_id ?? null,
    origin_message_id: message.origin?.message_id ?? null,
    origin_turn_id: message.origin?.turn_id ?? null,
    created_at: message.created_at,
    updated_at: message.updated_at,
  };
}

/** 把一个领域 Part 拆为独立数据库 row。 */
export function encode_session_part_row(
  message: SessionMessage,
  part: SessionUserMessagePart | SessionAgentMessagePart,
): SessionMessagePartRow {
  const { part_id, sequence, type, ...content } = part;
  const step_id = "step_id" in content && typeof content.step_id === "string"
    ? content.step_id
    : null;
  if ("step_id" in content) delete content.step_id;
  return {
    part_id,
    message_id: message.message_id,
    sequence,
    step_id,
    type,
    content: JSON.stringify(content),
    created_at: message.created_at,
    updated_at: message.updated_at,
  };
}

/** 把 envelope 与按顺序读取的 Part rows 组装为公开 Message。 */
export function decode_session_message(
  row: SessionMessageRow,
  part_rows: readonly SessionMessagePartRow[],
  session_id: string,
): SessionMessage {
  const origin = row.origin_session_id && row.origin_message_id
    ? {
        session_id: row.origin_session_id,
        message_id: row.origin_message_id,
        ...(row.origin_turn_id ? { turn_id: row.origin_turn_id } : {}),
      }
    : undefined;
  const parts = part_rows
    .map((part_row) => decode_session_part(part_row))
    .sort((left, right) => left.sequence - right.sequence);
  const base = {
    message_id: row.message_id,
    session_id,
    ...(row.turn_id ? { turn_id: row.turn_id } : {}),
    sequence: row.sequence,
    revision: row.revision,
    visibility: row.visibility,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(origin ? { origin } : {}),
  };
  if (row.role === "user") {
    return {
      ...base,
      role: "user",
      input_type: row.input_type || "prompt",
      parts: parts as SessionUserMessagePart[],
    };
  }
  return {
    ...base,
    role: "agent",
    status: row.status,
    parts: parts as SessionAgentMessagePart[],
  };
}

/** 解码单个 Part 的类型专属 content。 */
function decode_session_part(
  row: SessionMessagePartRow,
): SessionUserMessagePart | SessionAgentMessagePart {
  const content = JSON.parse(row.content) as Record<string, unknown>;
  return {
    part_id: row.part_id,
    sequence: row.sequence,
    ...(row.step_id ? { step_id: row.step_id } : {}),
    type: row.type,
    ...content,
  } as SessionUserMessagePart | SessionAgentMessagePart;
}
