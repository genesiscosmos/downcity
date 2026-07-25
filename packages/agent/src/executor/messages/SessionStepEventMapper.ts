/**
 * SessionStepEventMapper：把单个 step 结果转成 assistant parts。
 *
 * 关键点（中文）
 * - 运行过程仍然要持久化，但收口到同一条 assistant UIMessage。
 * - 工具结果使用 AI SDK v6 UI tool part 格式，和官方 UIMessage 语义保持一致。
 * - 每个 step 前插入 `step-start`，便于在 UI 中保留多 step 边界。
 */

import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function resolveToolName(value: unknown): string {
  const record = toRecord(value);
  if (!record) return "";
  const tool_name =
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.tool === "string"
        ? record.tool
        : typeof record.name === "string"
          ? record.name
          : "";
  return String(tool_name || "").trim();
}

function resolveToolCallId(value: unknown): string {
  const record = toRecord(value);
  if (!record) return "";
  const toolCallId =
    typeof record.toolCallId === "string"
      ? record.toolCallId
      : typeof record.id === "string"
        ? record.id
        : "";
  return String(toolCallId || "").trim();
}

function resolveToolCallInput(value: unknown): unknown {
  const record = toRecord(value);
  if (!record) return undefined;
  if ("input" in record) return record.input;
  if ("rawInput" in record) return record.rawInput;
  if ("arguments" in record) return record.arguments;
  if ("args" in record) return record.args;
  return undefined;
}

function resolveToolResultPayload(value: unknown): unknown {
  const record = toRecord(value);
  if (!record) return undefined;
  if ("result" in record) return record.result;
  if ("output" in record) return record.output;
  if ("errorText" in record) return record.errorText;
  if ("error" in record) return record.error;
  return undefined;
}

function resolveToolResultErrorText(value: unknown): string | undefined {
  const record = toRecord(value);
  if (!record) return undefined;
  if (typeof record.errorText === "string" && record.errorText.trim()) {
    return record.errorText.trim();
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  if (record.error instanceof Error && record.error.message.trim()) {
    return record.error.message.trim();
  }
  return undefined;
}

function mapToolResultsByCallId(toolResults: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const toolResult of toolResults) {
    const toolCallId = resolveToolCallId(toolResult);
    if (!toolCallId) continue;
    out.set(toolCallId, toolResult);
  }
  return out;
}

function resolveAcpEventType(value: unknown): string {
  const record = toRecord(value);
  const type = typeof record?.type === "string" ? record.type : "";
  return type.trim();
}

function resolveAcpEventData(value: unknown): unknown {
  const record = toRecord(value);
  if (!record) return value;
  if ("data" in record) return record.data;
  return record;
}

function toDataPartType(type: string): string {
  return `data-acp-${type.replace(/_/g, "-")}`;
}

/**
 * 从 step_result 提取按顺序写入同一条 assistant message 的 parts。
 */
export function build_session_step_parts(params: {
  step_index: number;
  step_result?: unknown;
  text: string;
  visibility?: "visible" | "internal";
}): SessionMessageRecordV1["parts"] {
  const out: SessionMessageRecordV1["parts"] = [];
  const stepRecord = toRecord(params.step_result) || {};
  const toolCalls = Array.isArray(stepRecord.toolCalls) ? stepRecord.toolCalls : [];
  const toolResults = Array.isArray(stepRecord.toolResults)
    ? stepRecord.toolResults
    : [];
  const toolResultsByCallId = mapToolResultsByCallId(toolResults);
  const acpEvents = Array.isArray(stepRecord.acpEvents)
    ? stepRecord.acpEvents
    : [];

  const text = String(params.text || "").trim();
  const has_structured_output =
    Boolean(text) || toolCalls.length > 0 || acpEvents.length > 0;
  if (!has_structured_output) return [];

  out.push({ type: "step-start" });

  if (text) {
    const isInternal = params.visibility === "internal";
    out.push(
      isInternal
        ? {
            type: "reasoning",
            text,
            state: "done",
          }
        : {
            type: "text",
            text,
            state: "done",
          },
    );
  }

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const tool_name = resolveToolName(toolCall) || "unknown_tool";
    const toolCallId = resolveToolCallId(toolCall);
    const input = resolveToolCallInput(toolCall);
    const toolResult = toolCallId ? toolResultsByCallId.get(toolCallId) : undefined;
    if (!toolResult) continue;
    const output = resolveToolResultPayload(toolResult);
    const errorText = resolveToolResultErrorText(toolResult);
    out.push(
      {
        type: `tool-${tool_name}`,
        ...(toolCallId ? { toolCallId } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(errorText
          ? {
              state: "output-error",
              errorText,
            }
          : {
              state: "output-available",
              output,
            }),
      } as SessionMessageRecordV1["parts"][number],
    );
  }

  for (let index = 0; index < acpEvents.length; index += 1) {
    const acpEvent = acpEvents[index];
    const type = resolveAcpEventType(acpEvent);
    if (!type) continue;
    out.push(
      {
        type: toDataPartType(type),
        data: resolveAcpEventData(acpEvent),
      } as SessionMessageRecordV1["parts"][number],
    );
  }

  return out;
}
