/**
 * Session Message 聚合与 SQLite rows 之间的唯一 codec。
 *
 * Message envelope 与 Part 分表保存；公开领域对象仍保持 Message 聚合拥有 parts[]。
 */

import { validate_session_view_content } from "@downcity/type";
import { assert_tool_terminal, parse_result_ref } from "@/model/results/ResultReference.js";
import { decode_session_input_part } from "./SessionInputCodec.js";
import { validate_session_stable_prefix } from "./SessionStablePrefix.js";
import { session_prompt_actor_schema } from "@/types/sdk/SessionPromptActor.js";
import type { JsonObject, JsonValue, SessionAgentInteraction, SessionAgentMessage, SessionAgentMessagePart, SessionInteractionRequest, SessionInteractionResponse, SessionMessage, SessionMessageMeta, SessionUserMessagePart } from "@downcity/type";

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
  /** 已提交的稳定 Part 前缀末尾 sequence；0 表示空前缀，User 固定为 0。 */
  stable_part_sequence: number;
  /** User 请求记账或 Agent 当前错误的 envelope JSON；不保存模型输入。 */
  meta: string | null;
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
    stable_part_sequence: message.role === "agent" ? message.stable_part_sequence : 0,
    meta: message.role === "user" ? (message.meta ? JSON.stringify(message.meta) : null)
      : message.current_error || message.execution_id
        ? JSON.stringify({ current_error: message.current_error, execution_id: message.execution_id }) : null,
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
  if (part.type === "tool") assert_tool_terminal(part);
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
    created_at: part.type === "input" ? part.created_at : message.created_at,
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(origin ? { origin } : {}),
  };
  if (row.role === "user") {
    const user_parts = parts.filter(is_session_user_part);
    if (row.state !== null || row.stable_part_sequence !== 0 || user_parts.length !== parts.length) {
      throw new Error(`Invalid persisted User Message: ${row.message_id}`);
    }
    return {
      ...base,
      role: "user",
      parts: user_parts,
      ...(row.meta ? { meta: parse_message_meta(row) } : {}),
    };
  }
  const agent_parts = parts.filter(is_session_agent_part);
  if (!row.state || agent_parts.length !== parts.length) {
    throw new Error(`Invalid persisted Agent Message: ${row.message_id}`);
  }
  const message: SessionMessage = {
    ...base,
    role: "agent",
    state: row.state,
    stable_part_sequence: row.stable_part_sequence,
    parts: agent_parts,
    ...(row.meta ? decode_agent_meta(row) : {}),
  };
  for (const part of agent_parts) {
    if (part.type !== "tool" || !part.result_ref) continue;
    const location = parse_result_ref(part.result_ref);
    if (location.session_id === session_id) {
      if (location.message_id !== message.message_id || location.message_sequence !== message.sequence) {
        throw new Error("tool_terminal_location_conflict");
      }
    } else if (!origin) throw new Error("tool_terminal_source_origin_required");
  }
  validate_session_stable_prefix(message);
  return message;
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
    case "tool": {
      const part = {
        ...identity,
        type: "tool" as const,
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
        ...optional_json(content, "model_output"),
        ...optional_number(content, "disclosure_version", row),
        ...optional_string(content, "result_ref", row),
        ...optional_string(content, "error", row),
        ...optional_string(content, "title", row),
        ...(content.interactions === undefined
          ? {}
          : { interactions: decode_tool_interactions(content.interactions, row) }),
      };
      assert_tool_terminal(part);
      return part;
    }
    case "file":
      return {
        ...identity,
        type: "file",
        media_type: read_string(content, "media_type", row),
        url: read_string(content, "url", row),
        ...optional_string(content, "filename", row),
        // 媒体披露必须继续绑定原版本，读取历史附件不能隐式移除版本检查。
        ...optional_string(content, "media_version", row),
      };
    case "data":
      return {
        ...identity,
        type: "data",
        data_type: read_string(content, "data_type", row),
        data: read_json(content, "data", row),
        ...optional_string(content, "data_id", row),
      };
    case "input":
      if (role !== "agent") throw invalid_part(row, "Input content requires agent role");
      return decode_session_input_part(row, content);
    case "view": {
      if (role !== "agent") throw invalid_part(row, "Power content requires agent role");
      const part = { ...content, type: "view" };
      validate_session_view_content(part);
      return { ...part, ...identity, ...optional_string(content, "source_tool_call_id", row) };
    }
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

/** 校验并读取 Tool Part 内持久化的 Interaction 列表。 */
function decode_tool_interactions(
  value: unknown,
  row: SessionMessagePartRow,
): SessionAgentInteraction[] {
  if (!Array.isArray(value)) {
    throw invalid_part(row, "interactions must be a JSON array");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw invalid_part(row, "interaction must be a JSON object");
    }
    const interaction = item as Record<string, unknown>;
    read_string(interaction, "interaction_id", row);
    read_string(interaction, "interaction_type", row);
    read_enum(
      interaction,
      "status",
      ["pending", "resolved", "denied", "cancelled", "failed"],
      row,
    );
    decode_interaction_request(interaction.request, row);
    if (interaction.response !== undefined) {
      decode_interaction_response(interaction.response, row);
    }
    if (interaction.resolved_at !== undefined) {
      optional_number(interaction, "resolved_at", row);
    }
    if (interaction.cancel_reason !== undefined) {
      read_enum(
        interaction,
        "cancel_reason",
        ["turn_stopped", "session_disposed", "runtime_interrupted"],
        row,
      );
    }
    return item as SessionAgentInteraction;
  });
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
  if (!["tool", "shell"].includes(String(source.type))) {
    throw invalid_part(row, "request.source.type has an unsupported value");
  }
  read_string(source, "tool_call_id", row);
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

/**
 * 校验并解码消息级请求记账。
 *
 * `from` 必须满足与输入边界同一份 actor schema，避免持久化层与接收层对身份的理解漂移。
 */
function parse_message_meta(row: SessionMessageRow): SessionMessageMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.meta as string);
  } catch {
    throw invalid_meta(row, "meta must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalid_meta(row, "meta must be a JSON object");
  }
  const meta = parsed as Record<string, unknown>;
  const from = session_prompt_actor_schema.safeParse(meta.from);
  if (!from.success) throw invalid_meta(row, "meta.from must be a valid Session prompt actor");
  return {
    from: from.data,
    ...(meta.powers === undefined ? {} : { powers: meta.powers as JsonValue }),
    ...(meta.callback === undefined ? {} : { callback: meta.callback as JsonValue }),
  };
}

/** 构造带稳定 Message 身份的存储损坏错误。 */
function invalid_meta(row: SessionMessageRow, reason: string): Error {
  return new Error(`Invalid persisted Session Message meta ${row.message_id}: ${reason}`);
}

/** schema 联合类型增加成员时强制 codec 显式解码。 */
function assert_never(value: never): never {
  if (["inbox", "power"].includes(String(value))) {
    throw new Error("session_migration_required: Legacy Session Parts require offline conversion to v12");
  }
  throw new Error("session_storage_part_type_invalid");
}

/** 执行身份与错误随 Agent envelope 保存，不进入模型正文或占用 Part 水位。 */
function decode_agent_meta(row: SessionMessageRow): Pick<SessionAgentMessage, "execution_id" | "current_error"> {
  const meta = JSON.parse(row.meta!);
  if (meta.execution_id !== undefined && (typeof meta.execution_id !== "string" || !meta.execution_id.trim())) {
    throw new Error("Invalid Message execution identity");
  }
  return { ...(meta.execution_id ? { execution_id: meta.execution_id } : {}),
    ...(meta.current_error ? { current_error: decode_current_error(row) } : {}) };
}

/** 当前错误使用既有 Part 形状校验，但不占用正文序号或稳定水位。 */
function decode_current_error(row: SessionMessageRow): Extract<SessionAgentMessagePart, { type: "error" }> {
  const value = JSON.parse(row.meta!).current_error;
  if (!value || value.type !== "error" || typeof value.part_id !== "string" || !value.part_id
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new Error("Invalid current Message error");
  const part = decode_session_part({ part_id: value.part_id, message_id: row.message_id, sequence: value.sequence,
    step_id: null, type: "error", content: JSON.stringify(value), created_at: row.created_at, updated_at: row.updated_at }, "agent");
  if (part.type !== "error") throw new Error("Invalid current Message error");
  return part;
}
