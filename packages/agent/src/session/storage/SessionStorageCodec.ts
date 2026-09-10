/**
 * Session Message 聚合与 SQLite rows 之间的唯一 codec。
 *
 * Message envelope 与 Part 分表保存；公开领域对象仍保持 Message 聚合拥有 parts[]。
 */

import type {
  JsonObject,
  JsonValue,
  SessionAgentMessagePart,
  SessionInteractionRequest,
  SessionInteractionResponse,
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
  /** Agent Message 写入状态；User Message 固定为空。 */
  state: "streaming" | "done" | null;
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
    state: message.role === "agent" ? message.state : null,
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
    .map((part_row) => decode_session_part(part_row, row.role))
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
    const user_parts = parts.filter(is_session_user_part);
    if (row.state !== null || user_parts.length !== parts.length) {
      throw new Error(`Invalid persisted User Message: ${row.message_id}`);
    }
    return {
      ...base,
      role: "user",
      parts: user_parts,
    };
  }
  const agent_parts = parts.filter(is_session_agent_part);
  if (!row.state || agent_parts.length !== parts.length) {
    throw new Error(`Invalid persisted Agent Message: ${row.message_id}`);
  }
  return {
    ...base,
    role: "agent",
    state: row.state,
    parts: agent_parts,
  };
}

/** 解码单个 Part 的类型专属 content。 */
function decode_session_part(
  row: SessionMessagePartRow,
  role: SessionMessageRow["role"],
): SessionUserMessagePart | SessionAgentMessagePart {
  const content = parse_part_content(row);
  const identity = {
    part_id: row.part_id,
    sequence: row.sequence,
    ...(row.step_id ? { step_id: row.step_id } : {}),
  };
  switch (row.type) {
    case "text":
      if (role === "user") {
        if (row.step_id) throw invalid_part(row, "User text cannot have step_id");
        if (content.state !== undefined) {
          throw invalid_part(row, "User text cannot have streaming state");
        }
        return {
          part_id: row.part_id,
          sequence: row.sequence,
          type: "text",
          text: read_string(content, "text", row),
        };
      }
      return {
        ...identity,
        type: "text",
        text: read_string(content, "text", row),
        state: read_enum(content, "state", ["streaming", "done"], row),
      };
    case "context":
      if (row.step_id) throw invalid_part(row, "User context cannot have step_id");
      return {
        part_id: row.part_id,
        sequence: row.sequence,
        type: "context",
        tag: read_string(content, "tag", row),
        context: read_string(content, "context", row),
      };
    case "reasoning":
      return {
        ...identity,
        type: "reasoning",
        text: read_string(content, "text", row),
        state: read_enum(content, "state", ["streaming", "done"], row),
        ...optional_string(content, "reasoning_signature", row),
      };
    case "tool":
      return {
        ...identity,
        type: "tool",
        tool_call_id: read_string(content, "tool_call_id", row),
        tool_name: read_string(content, "tool_name", row),
        state: read_enum(
          content,
          "state",
          ["input-streaming", "ready", "waiting-user", "running", "completed", "failed"],
          row,
        ),
        ...optional_string(content, "input_text", row),
        ...optional_json(content, "input"),
        ...optional_json(content, "output"),
        ...optional_string(content, "error", row),
        ...optional_string(content, "title", row),
      };
    case "interaction":
      return {
        ...identity,
        type: "interaction",
        interaction_id: read_string(content, "interaction_id", row),
        interaction_type: read_string(content, "interaction_type", row),
        status: read_enum(
          content,
          "status",
          ["pending", "resolved", "denied", "expired", "cancelled", "failed"],
          row,
        ),
        request: decode_interaction_request(content.request, row),
        ...(content.response === undefined
          ? {}
          : { response: decode_interaction_response(content.response, row) }),
        ...optional_number(content, "resolved_at", row),
        ...(content.cancel_reason === undefined
          ? {}
          : {
              cancel_reason: read_enum(
                content,
                "cancel_reason",
                ["turn_stopped", "session_disposed", "runtime_interrupted"],
                row,
              ),
            }),
      };
    case "file":
      return {
        ...identity,
        type: "file",
        media_type: read_string(content, "media_type", row),
        url: read_string(content, "url", row),
        ...optional_string(content, "filename", row),
      };
    case "data":
      return {
        ...identity,
        type: "data",
        data_type: read_string(content, "data_type", row),
        data: read_json(content, "data", row),
        ...optional_string(content, "data_id", row),
      };
    case "action":
      return {
        ...identity,
        type: "action",
        action_id: read_string(content, "action_id", row),
        action_type: read_string(content, "action_type", row),
        state: read_enum(content, "state", ["running", "completed", "failed"], row),
        title: read_string(content, "title", row),
        ...optional_string(content, "description", row),
        ...(content.data === undefined
          ? {}
          : { data: read_json_object(content, "data", row) }),
      };
    case "error":
      return {
        ...identity,
        type: "error",
        scope: read_enum(content, "scope", ["session", "turn"], row),
        code: read_string(content, "code", row),
        message: read_string(content, "message", row),
        recoverable: read_boolean(content, "recoverable", row),
      };
    default:
      return assert_never(row.type);
  }
}

/** 判断解码结果是否符合 User Message 的封闭 Part 集合。 */
function is_session_user_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): part is SessionUserMessagePart {
  if ("step_id" in part) return false;
  return part.type === "text" || part.type === "context" ||
    part.type === "file" || part.type === "data";
}

/** 判断解码结果是否符合 Agent Message 的封闭 Part 集合。 */
function is_session_agent_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): part is SessionAgentMessagePart {
  return part.type !== "context" &&
    (part.type !== "text" || "state" in part);
}

/** 解析单个 Part 的 JSON 对象，并拒绝数组、null 与损坏内容。 */
function parse_part_content(row: SessionMessagePartRow): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(row.content);
  } catch (error) {
    throw invalid_part(row, `content is not valid JSON: ${String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid_part(row, "content must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/** 读取必需字符串字段。 */
function read_string(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): string {
  const value = content[key];
  if (typeof value !== "string") throw invalid_part(row, `${key} must be a string`);
  return value;
}

/** 读取可选字符串字段，并保留原字段名。 */
function optional_string(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): Record<string, string> {
  if (content[key] === undefined) return {};
  return { [key]: read_string(content, key, row) };
}

/** 读取可选有限数字字段，并保留原字段名。 */
function optional_number(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): Record<string, number> {
  if (content[key] === undefined) return {};
  const value = content[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid_part(row, `${key} must be a finite number`);
  }
  return { [key]: value };
}

/** 读取必需布尔字段。 */
function read_boolean(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): boolean {
  const value = content[key];
  if (typeof value !== "boolean") throw invalid_part(row, `${key} must be a boolean`);
  return value;
}

/** 读取封闭字符串枚举字段。 */
function read_enum<const TValue extends string>(
  content: Record<string, unknown>,
  key: string,
  values: readonly TValue[],
  row: SessionMessagePartRow,
): TValue {
  const value = content[key];
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw invalid_part(row, `${key} has an unsupported value`);
  }
  return value as TValue;
}

/** 读取必需 JSON 字段。 */
function read_json(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): JsonValue {
  if (!Object.prototype.hasOwnProperty.call(content, key)) {
    throw invalid_part(row, `${key} is required`);
  }
  return content[key] as JsonValue;
}

/** 读取可选 JSON 字段，并保留原字段名。 */
function optional_json(
  content: Record<string, unknown>,
  key: string,
): Record<string, JsonValue> {
  return Object.prototype.hasOwnProperty.call(content, key)
    ? { [key]: content[key] as JsonValue }
    : {};
}

/** 读取必需 JSON object 字段。 */
function read_json_object(
  content: Record<string, unknown>,
  key: string,
  row: SessionMessagePartRow,
): JsonObject {
  const value = content[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid_part(row, `${key} must be a JSON object`);
  }
  return value as JsonObject;
}

/** 校验并读取持久化 Interaction 请求。 */
function decode_interaction_request(
  value: unknown,
  row: SessionMessagePartRow,
): SessionInteractionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid_part(row, "request must be a JSON object");
  }
  const request = value as Record<string, unknown>;
  read_string(request, "interaction_id", row);
  read_string(request, "turn_id", row);
  read_string(request, "type", row);
  read_json(request, "payload", row);
  const source = read_json_object(request, "source", row);
  if (!["tool", "plugin", "shell", "execution"].includes(String(source.type))) {
    throw invalid_part(row, "request.source.type has an unsupported value");
  }
  const created_at = request.created_at;
  if (typeof created_at !== "number" || !Number.isFinite(created_at)) {
    throw invalid_part(row, "request.created_at must be a finite number");
  }
  return value as SessionInteractionRequest;
}

/** 校验并读取持久化 Interaction 响应。 */
function decode_interaction_response(
  value: unknown,
  row: SessionMessagePartRow,
): SessionInteractionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid_part(row, "response must be a JSON object");
  }
  const response = value as Record<string, unknown>;
  read_string(response, "type", row);
  read_enum(response, "outcome", ["resolved", "denied"], row);
  read_json(response, "payload", row);
  return value as SessionInteractionResponse;
}

/** 构造带稳定 Part 身份的存储损坏错误。 */
function invalid_part(row: SessionMessagePartRow, reason: string): Error {
  return new Error(`Invalid persisted Session Part ${row.part_id} (${row.type}): ${reason}`);
}

/** schema 联合类型增加成员时强制 codec 显式解码。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported persisted Session Part type: ${String(value)}`);
}
