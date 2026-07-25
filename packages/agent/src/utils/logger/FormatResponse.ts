/**
 * LLM 响应日志格式化。
 *
 * 关键点（中文）
 * - JSON 响应和 SSE 响应走不同摘要逻辑。
 * - 日志里保留状态、内容类型、函数调用摘要，方便定位 provider 行为。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import {
  format_log_field,
  get_array_field,
  get_object_field,
  get_string_field,
  is_json_object,
  safe_json_parse,
  to_inline_log_value,
} from "./FormatShared.js";

interface ProviderResponseLike {
  /**
   * HTTP 状态码。
   */
  status: number;
  /**
   * 是否为成功响应。
   */
  ok: boolean;
  /**
   * 响应头访问器。
   */
  headers: {
    /**
     * 根据头名获取值。
     */
    get(name: string): string | null;
  };
  /**
   * 将响应体读取为文本。
   */
  text(): Promise<string>;
}

function pickOutputTypes(output: JsonValue[] | undefined): string[] {
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => {
      if (!is_json_object(item)) return "";
      return get_string_field(item, "type") || "";
    })
    .filter((type) => Boolean(type))
    .slice(0, 16);
}

function pickFunctionCallNames(output: JsonValue[] | undefined): string[] {
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => {
      if (!is_json_object(item)) return "";
      if (get_string_field(item, "type") !== "function_call") return "";
      return get_string_field(item, "name") || "";
    })
    .filter((name) => Boolean(name))
    .slice(0, 8);
}

function summarizeResponseObjectForLog(
  responseObject: JsonObject | undefined,
): JsonObject {
  if (!responseObject) return {};

  const output = get_array_field(responseObject, "output");
  const incompleteDetails =
    get_object_field(responseObject, "incomplete_details") ||
    get_object_field(responseObject, "incompleteDetails");
  const finishReason =
    get_string_field(responseObject, "finish_reason") ||
    get_string_field(responseObject, "finishReason");

  return {
    responseId: get_string_field(responseObject, "id") || null,
    responseObjectType: get_string_field(responseObject, "object") || null,
    responseFinishReason: finishReason || null,
    responseIncompleteReason:
      get_string_field(incompleteDetails || {}, "reason") || null,
    responseOutputCount: Array.isArray(output) ? output.length : 0,
    responseOutputTypes: pickOutputTypes(output),
    responseFunctionCallNames: pickFunctionCallNames(output),
  };
}

function summarizeSseBodyForLog(body_text: string): JsonObject {
  const eventTypes: string[] = [];
  const streamedOutputTypes: string[] = [];
  const functionCallNames: string[] = [];
  let lastResponseObject: JsonObject | undefined;

  let currentEvent = "";
  let currentDataLines: string[] = [];

  const flushEvent = (): void => {
    const rawData = currentDataLines.join("\n").trim();
    currentDataLines = [];
    if (!rawData) {
      currentEvent = "";
      return;
    }
    if (rawData === "[DONE]") {
      eventTypes.push(currentEvent || "done");
      currentEvent = "";
      return;
    }

    const parsed = safe_json_parse(rawData);
    if (parsed && is_json_object(parsed)) {
      const explicitType = get_string_field(parsed, "type");
      const eventLabel = currentEvent || explicitType || "message";
      eventTypes.push(eventLabel);

      const nestedResponse = get_object_field(parsed, "response");
      if (nestedResponse) {
        lastResponseObject = nestedResponse;
      }

      const nestedItem = get_object_field(parsed, "item");
      const itemType = get_string_field(nestedItem || {}, "type");
      if (itemType && !streamedOutputTypes.includes(itemType)) {
        streamedOutputTypes.push(itemType);
      }
      const functionName = get_string_field(nestedItem || {}, "name");
      if (
        itemType === "function_call" &&
        functionName &&
        !functionCallNames.includes(functionName)
      ) {
        functionCallNames.push(functionName);
      }

      const directOutput = get_array_field(parsed, "output");
      for (const outputType of pickOutputTypes(directOutput)) {
        if (!streamedOutputTypes.includes(outputType)) {
          streamedOutputTypes.push(outputType);
        }
      }
      for (const functionCallName of pickFunctionCallNames(directOutput)) {
        if (!functionCallNames.includes(functionCallName)) {
          functionCallNames.push(functionCallName);
        }
      }
    } else {
      eventTypes.push(currentEvent || "message");
    }
    currentEvent = "";
  };

  for (const rawLine of String(body_text || "").split(/\r?\n/)) {
    const line = String(rawLine || "");
    if (!line.trim()) {
      flushEvent();
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice("data:".length).trim());
    }
  }
  flushEvent();

  const responseSummary = summarizeResponseObjectForLog(lastResponseObject);
  return {
    responseEventTypes: eventTypes.slice(0, 20),
    streamedOutputTypes: streamedOutputTypes.slice(0, 16),
    streamedFunctionCallNames: functionCallNames.slice(0, 8),
    ...responseSummary,
  };
}

export async function parse_fetch_response_for_log(
  response: ProviderResponseLike,
  opts?: {
    /**
     * 原始请求 URL。
     */
    url?: string;
    /**
     * 原始请求方法。
     */
    method?: string;
  },
): Promise<{
  responseText: string;
  meta: JsonObject;
}> {
  const maxBodyPreviewChars = 2000;
  const contentType = String(response.headers.get("content-type") || "").trim();
  let body_text = "";

  try {
    body_text = await response.text();
  } catch (error) {
    const errorText = String(error || "unknown_error");
    return {
      responseText: format_log_field(
        "agent",
        to_inline_log_value(
          `llm.response status=${response.status} ok=${response.ok} contentType=${contentType || "-"} body_read_error=${errorText}`,
          maxBodyPreviewChars,
        ),
      ),
      meta: {
        kind: "llm_response",
        status: response.status,
        ok: response.ok,
        ...(contentType ? { contentType } : {}),
        ...(opts?.url ? { url: opts.url } : {}),
        ...(opts?.method ? { method: opts.method } : {}),
        bodyReadError: errorText,
      },
    };
  }

  let responseSummary: JsonObject = {};
  if (contentType.includes("application/json")) {
    const parsed = safe_json_parse(body_text);
    if (parsed && is_json_object(parsed)) {
      const nestedResponse = get_object_field(parsed, "response");
      responseSummary = summarizeResponseObjectForLog(
        nestedResponse || parsed,
      );
    }
  } else if (contentType.includes("text/event-stream")) {
    responseSummary = summarizeSseBodyForLog(body_text);
  }

  const preview = to_inline_log_value(body_text, maxBodyPreviewChars);
  const responseTextParts = [
    format_log_field(
      "agent",
      to_inline_log_value(
        `llm.response status=${response.status} ok=${response.ok} contentType=${contentType || "-"}`,
        maxBodyPreviewChars,
      ),
    ),
  ];
  if (preview) {
    responseTextParts.push(format_log_field("response_body", preview));
  }

  return {
    responseText: responseTextParts.join("\n\n"),
    meta: {
      kind: "llm_response",
      status: response.status,
      ok: response.ok,
      ...(contentType ? { contentType } : {}),
      ...(opts?.url ? { url: opts.url } : {}),
      ...(opts?.method ? { method: opts.method } : {}),
      responseBodyLength: body_text.length,
      ...responseSummary,
    },
  };
}
