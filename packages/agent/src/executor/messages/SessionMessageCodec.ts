/**
 * SessionMessageCodec：session message 与模型 message 的转换模块。
 *
 * 关键点（中文）
 * - 只负责消息筛选与模型消息转换。
 * - 附件注入下沉到 `SessionAttachmentMapper`。
 * - 日志提取与输出下沉到 `SessionMessageLog`。
 */

import type { ModelContent, ModelJsonValue, ModelMessage } from "@downcity/type";
import type { RuntimeTool as Tool } from "@downcity/type";
import {
  is_session_message_record,
  type SessionRecordV1,
} from "@/executor/types/SessionRecords.js";
import {
  hydrate_file_url_parts_for_model,
  inject_file_parts_from_attachments,
} from "@executor/messages/SessionAttachmentMapper.js";

/**
 * 过滤 Step 检查点返回的有效 User 消息。
 *
 * 关键点（中文）
 * - 用途：从运行期注入与 Session Queue 中挑出可并入推理上下文的 User 消息。
 * - 输入：任意 SessionRecordV1[]（可能混有 assistant/tool/action/空消息）。
 * - 输出：包含非空文本或任意其他 UI Part 的 User 消息数组。
 */
export function pick_merged_user_messages(
  messages: SessionRecordV1[],
): SessionRecordV1[] {
  // 如果不是数组，直接返回空数组，避免后续 filter 报错。
  if (!Array.isArray(messages)) return [];

  // 逐条过滤消息。
  return messages.filter((message) => {
    // 防御 1：消息必须是对象。
    if (!is_session_message_record(message)) return false;

    // 防御 2：只接受 user 角色。
    if (message.role !== "user") return false;

    // 防御 3：parts 必须是数组。
    if (!Array.isArray(message.parts)) return false;

    // 空文本不单独构成输入；File、Data 等非文本 Part 本身就是有效内容。
    return message.parts.some((part) =>
      part.type !== "text" || String(part.text ?? "").trim().length > 0
    );
  });
}

/**
 * 将 context 消息转换为模型消息。
 *
 * 关键点（中文）
 * - 用途：把 UIMessage 语义层数据转成模型可消费的 ModelMessage[]。
 * - 输入：context 消息数组 + 可用工具集合。
 * - 输出：可直接写入 Downcity ModelCall 的 messages。
 */
export async function to_model_messages(
  messages: SessionRecordV1[],
  tools: Record<string, Tool>,
  project_root?: string,
): Promise<ModelMessage[]> {
  // 空输入快速返回，避免调用转换器的额外开销。
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // action record 只服务前端时间线，不能传入模型。
  const model_messages = messages.filter(is_session_message_record);
  if (model_messages.length === 0) return [];

  // 第一步（中文）：在 user 消息上注入 file parts（多模态附件）。
  const enrichedMessages = await inject_file_parts_from_attachments(
    model_messages,
    project_root,
  );

  // 第二步（中文）：把历史里的本地文件 URL 在内存中 hydrate 成模型可消费的 data URL。
  const hydratedMessages = await hydrate_file_url_parts_for_model(
    enrichedMessages,
    project_root,
  );

  void tools;
  return hydratedMessages.flatMap(convert_session_message);
}

/** 把单条 Session UI 消息转换为一到两条模型消息。 */
function convert_session_message(message: SessionRecordV1 & { role: string }): ModelMessage[] {
  if (!("parts" in message) || !Array.isArray(message.parts)) return [];
  const content: ModelContent[] = [];
  const tool_results: ModelContent[] = [];
  for (const part of message.parts) {
    const record = part as unknown as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      content.push({ type: "text", text: record.text });
      continue;
    }
    if (message.role === "assistant" && record.type === "reasoning" && typeof record.text === "string") {
      content.push({ type: "reasoning", text: record.text });
      continue;
    }
    if (message.role === "user" && record.type === "file") {
      const file = convert_file_part(record);
      if (file) content.push(file);
      continue;
    }
    if (
      message.role === "assistant" &&
      typeof record.type === "string" &&
      (record.type === "dynamic-tool" || record.type.startsWith("tool-"))
    ) {
      const tool_call_id = String(record.toolCallId ?? "").trim();
      const tool_name = (
        record.type === "dynamic-tool"
          ? String(record.toolName ?? "")
          : record.type.slice("tool-".length)
      ).trim();
      if (!tool_call_id || !tool_name || record.input === undefined) continue;
      content.push({
        type: "tool_call",
        tool_call_id,
        tool_name,
        input: to_json_value(record.input),
      });
      if (
        record.state === "output-available" ||
        record.state === "output-error" ||
        record.state === "completed" ||
        record.state === "failed"
      ) {
        const succeeded = record.state === "output-available" || record.state === "completed";
        tool_results.push({
          type: "tool_result",
          tool_call_id,
          tool_name,
          outcome: succeeded ? "succeeded" : "failed",
          content: [{
            type: "json",
            value: to_json_value(record.output ?? record.error ?? record.errorText ?? null),
          }],
        });
      }
    }
  }
  if (content.length === 0 && tool_results.length === 0) return [];
  const role = message.role === "user" ? "user" : "assistant";
  return [
    ...(content.length > 0 ? [{ role, content } as ModelMessage] : []),
    ...(tool_results.length > 0 ? [{ role: "tool", content: tool_results } as ModelMessage] : []),
  ];
}

/** 把 UI file part 转换为单一来源的 Downcity 文件。 */
function convert_file_part(record: Record<string, unknown>): ModelContent | undefined {
  const media_type = String(record.mediaType ?? record.media_type ?? "").trim();
  const url = String(record.url ?? "").trim();
  if (!media_type || !url) return undefined;
  const data_match = /^data:[^;,]+;base64,(.*)$/isu.exec(url);
  return {
    type: "file",
    media_type,
    source: data_match
      ? { type: "base64", data: data_match[1] ?? "" }
      : { type: "url", url },
    ...(typeof record.filename === "string" && record.filename.trim()
      ? { filename: record.filename.trim() }
      : {}),
  };
}

/** 把未知值限制为可传输 JSON。 */
function to_json_value(value: unknown): ModelJsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as ModelJsonValue;
}
