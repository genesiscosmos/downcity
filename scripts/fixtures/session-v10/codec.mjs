/** 冻结的 v10 离线协议；只供历史迁移和显式包转换使用，不进入正式运行时。 */
/**
 * Session Message 聚合与 SQLite rows 之间的唯一 codec。
 *
 * Message envelope 与 Part 分表保存；公开领域对象仍保持 Message 聚合拥有 parts[]。
 */
import { validate_session_power_content } from "../session-v11/view-validator.mjs";
import { assert_tool_terminal, parse_result_ref } from "../../../packages/agent/src/model/results/ResultReference.ts";
import { decode_session_inbox_part } from "../session-v11/input-codec.mjs";
import { validate_session_stable_prefix } from "../../../packages/agent/src/session/storage/SessionStablePrefix.ts";
import { session_prompt_actor_schema } from "../../../packages/agent/src/types/sdk/SessionPromptActor.ts";
/** 把 Message 聚合拆为数据库 envelope row。 */
export function encode_session_message_row(message) {
    return {
        message_id: message.message_id,
        turn_id: message.turn_id ?? null,
        sequence: message.sequence,
        revision: message.revision,
        role: message.role,
        state: message.role === "agent" ? message.state : null,
        stable_part_sequence: message.role === "agent" ? message.stable_part_sequence : 0,
        meta: message.role === "user" && message.meta ? JSON.stringify(message.meta) : null,
        origin_session_id: message.origin?.session_id ?? null,
        origin_message_id: message.origin?.message_id ?? null,
        origin_turn_id: message.origin?.turn_id ?? null,
        created_at: message.created_at,
        updated_at: message.updated_at,
    };
}
/** 把一个领域 Part 拆为独立数据库 row。 */
export function encode_session_part_row(message, part) {
    if (part.type === "tool")
        assert_tool_terminal(part);
    const { part_id, sequence, type, ...content } = part;
    const step_id = "step_id" in content && typeof content.step_id === "string"
        ? content.step_id
        : null;
    if ("step_id" in content)
        delete content.step_id;
    return {
        part_id,
        message_id: message.message_id,
        sequence,
        step_id,
        type,
        content: JSON.stringify(content),
        created_at: part.type === "inbox" ? part.created_at : message.created_at,
        updated_at: message.updated_at,
    };
}
/** 把 envelope 与按顺序读取的 Part rows 组装为公开 Message。 */
export function decode_session_message(row, part_rows, session_id) {
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
    const message = {
        ...base,
        role: "agent",
        state: row.state,
        stable_part_sequence: row.stable_part_sequence,
        parts: agent_parts,
    };
    for (const part of agent_parts) {
        if (part.type !== "tool" || !part.result_ref)
            continue;
        const location = parse_result_ref(part.result_ref);
        if (location.session_id === session_id) {
            if (location.message_id !== message.message_id || location.message_sequence !== message.sequence) {
                throw new Error("tool_terminal_location_conflict");
            }
        }
        else if (!origin)
            throw new Error("tool_terminal_source_origin_required");
    }
    validate_session_stable_prefix(message);
    return message;
}
/** 解码单个 Part 的类型专属 content。 */
function decode_session_part(row, role) {
    const content = parse_part_content(row);
    const identity = {
        part_id: row.part_id,
        sequence: row.sequence,
        ...(row.step_id ? { step_id: row.step_id } : {}),
    };
    switch (row.type) {
        case "text":
            if (role === "user") {
                if (row.step_id)
                    throw invalid_part(row, "User text cannot have step_id");
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
            if (row.step_id)
                throw invalid_part(row, "User context cannot have step_id");
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
                type: "tool",
                tool_call_id: read_string(content, "tool_call_id", row),
                tool_name: read_string(content, "tool_name", row),
                state: read_enum(content, "state", ["input-streaming", "ready", "waiting-user", "running", "completed", "failed"], row),
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
        case "inbox":
            if (role !== "agent")
                throw invalid_part(row, "Inbox content requires agent role");
            return decode_session_inbox_part(row, content);
        case "power": {
            if (role !== "agent")
                throw invalid_part(row, "Power content requires agent role");
            const part = { ...content, type: "power" };
            validate_session_power_content(part);
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
function is_session_user_part(part) {
    if ("step_id" in part)
        return false;
    return part.type === "text" || part.type === "context" ||
        part.type === "file" || part.type === "data";
}
/** 判断解码结果是否符合 Agent Message 的封闭 Part 集合。 */
function is_session_agent_part(part) {
    return part.type !== "context" &&
        (part.type !== "text" || "state" in part);
}
/** 解析单个 Part 的 JSON 对象，并拒绝数组、null 与损坏内容。 */
function parse_part_content(row) {
    let value;
    try {
        value = JSON.parse(row.content);
    }
    catch (error) {
        throw invalid_part(row, `content is not valid JSON: ${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid_part(row, "content must be a JSON object");
    }
    return value;
}
/** 读取必需字符串字段。 */
function read_string(content, key, row) {
    const value = content[key];
    if (typeof value !== "string")
        throw invalid_part(row, `${key} must be a string`);
    return value;
}
/** 读取可选字符串字段，并保留原字段名。 */
function optional_string(content, key, row) {
    if (content[key] === undefined)
        return {};
    return { [key]: read_string(content, key, row) };
}
/** 读取可选有限数字字段，并保留原字段名。 */
function optional_number(content, key, row) {
    if (content[key] === undefined)
        return {};
    const value = content[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalid_part(row, `${key} must be a finite number`);
    }
    return { [key]: value };
}
/** 读取必需布尔字段。 */
function read_boolean(content, key, row) {
    const value = content[key];
    if (typeof value !== "boolean")
        throw invalid_part(row, `${key} must be a boolean`);
    return value;
}
/** 读取封闭字符串枚举字段。 */
function read_enum(content, key, values, row) {
    const value = content[key];
    if (typeof value !== "string" || !values.includes(value)) {
        throw invalid_part(row, `${key} has an unsupported value`);
    }
    return value;
}
/** 读取必需 JSON 字段。 */
function read_json(content, key, row) {
    if (!Object.prototype.hasOwnProperty.call(content, key)) {
        throw invalid_part(row, `${key} is required`);
    }
    return content[key];
}
/** 读取可选 JSON 字段，并保留原字段名。 */
function optional_json(content, key) {
    return Object.prototype.hasOwnProperty.call(content, key)
        ? { [key]: content[key] }
        : {};
}
/** 读取必需 JSON object 字段。 */
function read_json_object(content, key, row) {
    const value = content[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid_part(row, `${key} must be a JSON object`);
    }
    return value;
}
/** 校验并读取 Tool Part 内持久化的 Interaction 列表。 */
function decode_tool_interactions(value, row) {
    if (!Array.isArray(value)) {
        throw invalid_part(row, "interactions must be a JSON array");
    }
    return value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw invalid_part(row, "interaction must be a JSON object");
        }
        const interaction = item;
        read_string(interaction, "interaction_id", row);
        read_string(interaction, "interaction_type", row);
        read_enum(interaction, "status", ["pending", "resolved", "denied", "cancelled", "failed"], row);
        decode_interaction_request(interaction.request, row);
        if (interaction.response !== undefined) {
            decode_interaction_response(interaction.response, row);
        }
        if (interaction.resolved_at !== undefined) {
            optional_number(interaction, "resolved_at", row);
        }
        if (interaction.cancel_reason !== undefined) {
            read_enum(interaction, "cancel_reason", ["turn_stopped", "session_disposed", "runtime_interrupted"], row);
        }
        return item;
    });
}
/** 校验并读取持久化 Interaction 请求。 */
function decode_interaction_request(value, row) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid_part(row, "request must be a JSON object");
    }
    const request = value;
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
    return value;
}
/** 校验并读取持久化 Interaction 响应。 */
function decode_interaction_response(value, row) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid_part(row, "response must be a JSON object");
    }
    const response = value;
    read_string(response, "type", row);
    read_enum(response, "outcome", ["resolved", "denied"], row);
    read_json(response, "payload", row);
    return value;
}
/** 构造带稳定 Part 身份的存储损坏错误。 */
function invalid_part(row, reason) {
    return new Error(`Invalid persisted Session Part ${row.part_id} (${row.type}): ${reason}`);
}
/**
 * 校验并解码消息级请求记账。
 *
 * `from` 必须满足与输入边界同一份 actor schema，避免持久化层与接收层对身份的理解漂移。
 */
function parse_message_meta(row) {
    let parsed;
    try {
        parsed = JSON.parse(row.meta);
    }
    catch {
        throw invalid_meta(row, "meta must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw invalid_meta(row, "meta must be a JSON object");
    }
    const meta = parsed;
    const from = session_prompt_actor_schema.safeParse(meta.from);
    if (!from.success)
        throw invalid_meta(row, "meta.from must be a valid Session prompt actor");
    return {
        from: from.data,
        ...(meta.powers === undefined ? {} : { powers: meta.powers }),
        ...(meta.callback === undefined ? {} : { callback: meta.callback }),
    };
}
/** 构造带稳定 Message 身份的存储损坏错误。 */
function invalid_meta(row, reason) {
    return new Error(`Invalid persisted Session Message meta ${row.message_id}: ${reason}`);
}
/** schema 联合类型增加成员时强制 codec 显式解码。 */
function assert_never(value) {
    throw new Error(`Unsupported persisted Session Part type: ${String(value)}`);
}
