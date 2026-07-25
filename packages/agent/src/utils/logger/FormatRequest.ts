/**
 * LLM 请求日志格式化。
 *
 * 关键点（中文）
 * - 这里专注把 provider request 规整成易读日志。
 * - system / messages / tool calls 的展示策略统一收敛在本文件。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import {
  build_info_attrs,
  content_to_text,
  extract_function_call_exec_command_cmd,
  extract_messages,
  extract_system_for_log,
  format_log_field,
  get_object_field,
  get_string_field,
  is_json_object,
  parse_info_block_text,
  push_labeled_text_block,
  safe_json_parse,
  stringify_compact,
  to_inline_log_value,
  truncate,
  type ParsedPayload,
} from "./FormatShared.js";

// 关键点（中文）：system/developer 指令需要完整可审计，日志不做截断。
const UNLIMITED_LOG_CHARS = Number.MAX_SAFE_INTEGER;

/**
 * 按会话记录“上次已打印的消息数”。
 *
 * 关键点（中文）
 * - 用于 LLM 请求日志的增量打印，避免每轮都重复输出全量历史 messages。
 * - key 建议使用 session_id；无 key 时保持原有行为（全量打印）。
 */
const lastLoggedMessagesCountByKey = new Map<string, number>();

interface FormattedToolCall {
  /**
   * provider 返回的 tool call id。
   */
  id?: string;
  /**
   * provider 返回的 tool call 类型。
   */
  type?: string;
  /**
   * 工具或函数名。
   */
  name?: string;
  /**
   * 归一化后的参数文本。
   */
  arguments?: string;
}

function formatToolCalls(
  toolCalls: JsonValue | undefined,
  maxArgsChars: number,
): FormattedToolCall[] | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const out: FormattedToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (!is_json_object(toolCall)) continue;

    const id = get_string_field(toolCall, "id");
    const type = get_string_field(toolCall, "type");
    const fn = get_object_field(toolCall, "function");
    const name =
      (fn && get_string_field(fn, "name")) || get_string_field(toolCall, "tool");
    const argsRaw = fn ? fn.arguments : toolCall.arguments;
    const args =
      typeof argsRaw === "string"
        ? truncate(argsRaw, maxArgsChars)
        : truncate(JSON.stringify(argsRaw ?? {}), maxArgsChars);

    out.push({
      ...(id ? { id } : {}),
      ...(type ? { type } : {}),
      ...(name ? { name } : {}),
      ...(args ? { arguments: args } : {}),
    });
  }

  return out.length > 0 ? out : null;
}

function summarizeValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (is_json_object(value)) return `[object:${Object.keys(value).length}]`;
  return String(value);
}

/**
 * 规范化 system 提示词文本用于日志展示。
 *
 * 关键点（中文）
 * - `system` 可能是 string / object / array（不同 provider 形态不一致）。
 * - 统一折叠为可读文本，便于和历史 message 分段展示。
 */
function normalizeSystemTextForLog(
  system: JsonValue | undefined,
  maxChars: number,
): string {
  if (system === null || system === undefined) return "";
  if (typeof system === "string") return truncate(system, maxChars);

  if (Array.isArray(system)) {
    const merged = system
      .map((item) => summarizeValue(item))
      .filter(Boolean)
      .join("\n");
    return truncate(merged, maxChars);
  }

  if (is_json_object(system)) {
    const directText =
      get_string_field(system, "text") ||
      get_string_field(system, "content") ||
      get_string_field(system, "instructions");
    if (directText) return truncate(directText, maxChars);
    return stringify_compact(system, maxChars);
  }

  return truncate(String(system), maxChars);
}

function formatMessagesForLog(
  messages: JsonObject[],
  opts: {
    /**
     * 普通消息的最大字符数。
     */
    maxContentChars: number;
    /**
     * tool 参数的最大字符数。
     */
    maxToolArgsChars: number;
    /**
     * system 消息的最大字符数。
     */
    maxSystemChars: number;
  },
): string[] {
  const out: string[] = [];

  for (const message of messages) {
    const role = String(get_string_field(message, "role") || "").trim().toLowerCase();
    const itemType = String(get_string_field(message, "type") || "")
      .trim()
      .toLowerCase();
    const output = summarizeValue(message.output);
    const outputText = summarizeValue(message.output_text);

    const toolCalls = formatToolCalls(message.tool_calls, opts.maxToolArgsChars);
    if (toolCalls) {
      for (const toolCall of toolCalls) {
        const detail = [
          toolCall.name ? String(toolCall.name) : "",
          toolCall.arguments ? `args=${toolCall.arguments}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        if (detail) {
          push_labeled_text_block(out, "tool", detail, opts.maxToolArgsChars);
        }
      }
    }

    if (itemType === "function_call") {
      const functionName = String(get_string_field(message, "name") || "").trim();
      const functionCallExecCmd = extract_function_call_exec_command_cmd(message);
      const argsText =
        typeof message.arguments === "string"
          ? truncate(message.arguments, opts.maxToolArgsChars)
          : "";
      const functionCallDetail = [
        functionName || "function_call",
        functionCallExecCmd ? `cmd=${functionCallExecCmd}` : "",
        !functionCallExecCmd && argsText ? `args=${argsText}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      push_labeled_text_block(
        out,
        "tool",
        functionCallDetail || "function_call",
        opts.maxToolArgsChars,
      );
      continue;
    }

    let body_text = "";
    let userInfoAttrs: string[] = [];
    if ("content" in message) {
      const isSystemRole = role === "system" || role === "developer";
      const contentText = content_to_text(
        message.content,
        isSystemRole ? opts.maxSystemChars : opts.maxContentChars,
      );
      if (role === "user") {
        const parsedInfoBlock = parse_info_block_text(contentText);
        body_text = parsedInfoBlock ? parsedInfoBlock.body : contentText;
        userInfoAttrs = parsedInfoBlock ? build_info_attrs(parsedInfoBlock.info) : [];
      } else {
        body_text = contentText;
      }
    }

    if (role === "user") {
      push_labeled_text_block(
        out,
        "user",
        body_text || "-",
        opts.maxContentChars,
        userInfoAttrs,
      );
      continue;
    }

    if (role === "system" || role === "developer") {
      push_labeled_text_block(out, "system", body_text || "-", opts.maxSystemChars);
      continue;
    }

    if (
      role === "tool" ||
      itemType === "function_call_output" ||
      itemType === "tool-result" ||
      itemType === "tool_error" ||
      itemType === "tool-error"
    ) {
      const toolResultText = [body_text, outputText, output].filter(Boolean).join(" | ");
      push_labeled_text_block(
        out,
        "tool_result",
        toolResultText || "-",
        opts.maxContentChars,
      );
      continue;
    }

    const assistantText = [body_text, outputText, output]
      .filter(Boolean)
      .join(body_text ? "" : " | ");
    if (assistantText) {
      push_labeled_text_block(out, "assistant", assistantText, opts.maxContentChars);
    }
  }

  return out;
}

function formatPayloadSummaryLines(
  payload: ParsedPayload,
  maxChars: number,
): string[] {
  if (Array.isArray(payload)) {
    return [format_log_field("agent", `payload=[array:${payload.length}]`)];
  }
  const keys = Object.keys(payload).slice(0, 12).join(",") || "-";
  return [format_log_field("agent", to_inline_log_value(`payload.keys=${keys}`, maxChars))];
}

function selectMessagesForIncrementalLog(
  messages: JsonObject[],
  incrementalKey: string,
): JsonObject[] {
  if (!incrementalKey) return messages;

  const prevCount = lastLoggedMessagesCountByKey.get(incrementalKey) ?? 0;
  const currentCount = messages.length;
  lastLoggedMessagesCountByKey.set(incrementalKey, currentCount);

  if (currentCount > prevCount) {
    return trimLeadingAssistantMessages(messages.slice(prevCount));
  }

  // 关键点（中文）：当消息数回退（compact/rewrite）时，打印最近两条作为对齐点。
  if (currentCount < prevCount) {
    return trimLeadingAssistantMessages(
      messages.slice(Math.max(0, currentCount - 2)),
    );
  }

  return [];
}

function trimLeadingAssistantMessages(messages: JsonObject[]): JsonObject[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const firstUserIndex = messages.findIndex(
    (message) => get_string_field(message, "role") === "user",
  );
  if (firstUserIndex <= 0) return messages;
  for (let index = 0; index < firstUserIndex; index += 1) {
    if (get_string_field(messages[index], "role") !== "assistant") {
      return messages;
    }
  }
  // 关键点（中文）：增量片段若以“上一轮 assistant 历史”开头且随后有新 user，默认省略前置 assistant，避免视觉延迟错觉。
  return messages.slice(firstUserIndex);
}

export function parse_fetch_request_for_log(
  input: string | URL | Request,
  init?: RequestInit,
  opts?: {
    /**
     * 增量日志 key，通常使用 session_id。
     */
    incrementalKey?: string;
  },
): {
  url: string;
  method: string;
  payload: ParsedPayload | null;
  includePayload: boolean;
  maxChars: number;
  messages: JsonObject[] | null;
  system: JsonValue | undefined;
  model?: string;
  toolsCount: number;
  systemLength?: number;
  requestText: string;
  meta: JsonObject;
} | null {
  // 关键注释：这里的 maxChars 不用于“整体截断请求日志”，仅作为 payload 兜底 stringify 的保护上限。
  const maxChars = 12000;
  // 统一开关：只由宿主配置的 llm.logMessages 控制（由宿主模型工厂读取）。
  // 这里不支持额外的“更敏感 payload”开关，避免不一致与误配置。
  const includePayload = false;

  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = String(
    init?.method ||
      (input instanceof Request ? input.method : "POST"),
  );

  const initBody = typeof init?.body === "string" ? init.body : undefined;
  const payload = safe_json_parse(initBody);
  if (!payload) {
    if (initBody) {
      return {
        url,
        method,
        payload: null,
        includePayload,
        maxChars,
        messages: null,
        system: undefined,
        toolsCount: 0,
        requestText: format_log_field("agent", "llm.request non-json body"),
        meta: { kind: "llm_request", url, method },
      };
    }
    return null;
  }

  const payloadObject = is_json_object(payload) ? payload : undefined;
  const model = payloadObject ? get_string_field(payloadObject, "model") : undefined;
  const system = extract_system_for_log(payloadObject);
  const messages = payloadObject ? extract_messages(payloadObject) : null;
  const tools = payloadObject ? payloadObject.tools : undefined;
  const toolChoiceRaw = payloadObject
    ? payloadObject.tool_choice ?? payloadObject.toolChoice
    : undefined;
  const toolChoice =
    typeof toolChoiceRaw === "string"
      ? toolChoiceRaw
      : toolChoiceRaw !== undefined
        ? stringify_compact(toolChoiceRaw as JsonValue | object, 300)
        : undefined;
  const toolsCount = Array.isArray(tools)
    ? tools.length
    : is_json_object(tools)
      ? Object.keys(tools).length
      : 0;

  const messageTextParts: string[] = [];
  const maxSystemChars = UNLIMITED_LOG_CHARS;

  if (messages && Array.isArray(messages)) {
    const hasSystemMessage = messages.some((item) => {
      const role = String(get_string_field(item, "role") || "")
        .trim()
        .toLowerCase();
      return role === "system" || role === "developer";
    });
    if (!hasSystemMessage) {
      const systemText = normalizeSystemTextForLog(system, maxSystemChars).trim();
      if (systemText) {
        push_labeled_text_block(messageTextParts, "system", systemText, maxSystemChars);
      }
    }

    const incrementalKey = String(opts?.incrementalKey || "").trim();
    const selectedMessages = selectMessagesForIncrementalLog(
      messages,
      incrementalKey,
    );
    messageTextParts.push(...formatMessagesForLog(selectedMessages, {
      maxContentChars: 2000,
      maxToolArgsChars: 1200,
      maxSystemChars,
    }));
    if (selectedMessages.length === 0) {
      messageTextParts.push(format_log_field("agent", "no incremental items"));
    }
  } else {
    messageTextParts.push(...formatPayloadSummaryLines(payload, maxChars));
  }
  if (messageTextParts.length === 0) {
    messageTextParts.push(format_log_field("agent", "empty"));
  }

  return {
    url,
    method,
    payload,
    includePayload,
    maxChars,
    messages,
    system,
    model,
    toolsCount,
    systemLength: typeof system === "string" ? system.length : undefined,
    // 注意：不做整体截断；每条消息已单独截断。
    requestText: messageTextParts.join("\n\n"),
    meta: {
      kind: "llm_request",
      url,
      method,
      ...(model ? { model } : {}),
      toolsCount,
      ...(toolChoice ? { toolChoice } : {}),
      messagesCount: Array.isArray(messages) ? messages.length : 0,
      ...(typeof system === "string" ? { systemLength: system.length } : {}),
      ...(includePayload ? { payload } : {}),
    },
  };
}
