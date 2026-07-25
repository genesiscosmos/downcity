/**
 * LLM 响应日志格式化。
 *
 * 关键点（中文）
 * - JSON 响应和 SSE 响应走不同摘要逻辑。
 * - 日志里保留状态、内容类型、函数调用摘要，方便定位 provider 行为。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import {
  formatLogField,
  getArrayField,
  getObjectField,
  getStringField,
  isJsonObject,
  safeJsonParse,
  toInlineLogValue,
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
      if (!isJsonObject(item)) return "";
      return getStringField(item, "type") || "";
    })
    .filter((type) => Boolean(type))
    .slice(0, 16);
}

function pickFunctionCallNames(output: JsonValue[] | undefined): string[] {
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => {
      if (!isJsonObject(item)) return "";
      if (getStringField(item, "type") !== "function_call") return "";
      return getStringField(item, "name") || "";
    })
    .filter((name) => Boolean(name))
    .slice(0, 8);
}

function summarizeResponseObjectForLog(
  responseObject: JsonObject | undefined,
): JsonObject {
  if (!responseObject) return {};

  const output = getArrayField(responseObject, "output");
  const incompleteDetails =
    getObjectField(responseObject, "incomplete_details") ||
    getObjectField(responseObject, "incompleteDetails");
  const finishReason =
    getStringField(responseObject, "finish_reason") ||
    getStringField(responseObject, "finishReason");

  return {
    responseId: getStringField(responseObject, "id") || null,
    responseObjectType: getStringField(responseObject, "object") || null,
    responseFinishReason: finishReason || null,
    responseIncompleteReason:
      getStringField(incompleteDetails || {}, "reason") || null,
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

    const parsed = safeJsonParse(rawData);
    if (parsed && isJsonObject(parsed)) {
      const explicitType = getStringField(parsed, "type");
      const eventLabel = currentEvent || explicitType || "message";
      eventTypes.push(eventLabel);

      const nestedResponse = getObjectField(parsed, "response");
      if (nestedResponse) {
        lastResponseObject = nestedResponse;
      }

      const nestedItem = getObjectField(parsed, "item");
      const itemType = getStringField(nestedItem || {}, "type");
      if (itemType && !streamedOutputTypes.includes(itemType)) {
        streamedOutputTypes.push(itemType);
      }
      const functionName = getStringField(nestedItem || {}, "name");
      if (
        itemType === "function_call" &&
        functionName &&
        !functionCallNames.includes(functionName)
      ) {
        functionCallNames.push(functionName);
      }

      const directOutput = getArrayField(parsed, "output");
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

export async function parseFetchResponseForLog(
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
      responseText: formatLogField(
        "agent",
        toInlineLogValue(
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
    const parsed = safeJsonParse(body_text);
    if (parsed && isJsonObject(parsed)) {
      const nestedResponse = getObjectField(parsed, "response");
      responseSummary = summarizeResponseObjectForLog(
        nestedResponse || parsed,
      );
    }
  } else if (contentType.includes("text/event-stream")) {
    responseSummary = summarizeSseBodyForLog(body_text);
  }

  const preview = toInlineLogValue(body_text, maxBodyPreviewChars);
  const responseTextParts = [
    formatLogField(
      "agent",
      toInlineLogValue(
        `llm.response status=${response.status} ok=${response.ok} contentType=${contentType || "-"}`,
        maxBodyPreviewChars,
      ),
    ),
  ];
  if (preview) {
    responseTextParts.push(formatLogField("response_body", preview));
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
