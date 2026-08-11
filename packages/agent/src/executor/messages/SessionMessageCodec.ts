/**
 * SessionMessageCodec：session message 与模型 message 的转换模块。
 *
 * 关键点（中文）
 * - 只负责消息筛选与模型消息转换。
 * - 附件注入下沉到 `SessionAttachmentMapper`。
 * - 日志提取与输出下沉到 `SessionMessageLog`。
 */

import {
  convertToModelMessages,
  type ModelMessage,
  type Tool,
  type ToolSet,
} from "ai";
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
 * - 输出：可直接喂给 streamText 的 messages。
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

  // 第三步（中文）：转换前先剔除 UI 层 id 字段，仅保留模型需要的数据结构。
  const input = hydratedMessages.map((message) => {
    // 解构去掉 id。
    const { id: _id, ...rest } = message;

    // 返回剩余字段。
    return rest;
  });

  // 调用 ai-sdk 的转换函数。
  const converted_messages = await convertToModelMessages(input, {
    // 如果当前轮有工具，就把工具注入转换选项。
    ...(tools && Object.keys(tools).length > 0 ? { tools: tools as ToolSet } : {}),
    // 忽略历史里的不完整工具调用，提升容错性。
    ignoreIncompleteToolCalls: true,
  });
  return repair_orphaned_openai_text_references(converted_messages);
}

/**
 * 修复旧版 Session 中“只保存 msg_*、未保存必需 rs_*”的孤立 Responses API 引用。
 *
 * 关键点（中文）
 * - reasoning itemId / encrypted content 与 message itemId 存在时，保留 Provider 原子重放。
 * - 只有 message itemId 时，删除该引用并发送已持久化的普通文本，避免 400。
 * - 不修改 Session canonical source，该修复是可重建的 Provider 投影。
 */
function repair_orphaned_openai_text_references(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }
    const has_reasoning_replay_data = message.content.some((part) => {
      if (part.type !== "reasoning") return false;
      const openai_options = read_openai_provider_options(part.providerOptions);
      return Boolean(
        (typeof openai_options?.itemId === "string" && openai_options.itemId) ||
        (typeof openai_options?.reasoningEncryptedContent === "string" &&
          openai_options.reasoningEncryptedContent),
      );
    });
    if (has_reasoning_replay_data) return message;

    let changed = false;
    const content = message.content.map((part) => {
      if (part.type !== "text") return part;
      const provider_options = read_json_record(part.providerOptions);
      const openai_options = read_openai_provider_options(part.providerOptions);
      if (!provider_options || !openai_options || !("itemId" in openai_options)) {
        return part;
      }
      changed = true;
      const { itemId: _item_id, ...remaining_openai_options } = openai_options;
      const next_provider_options = { ...provider_options };
      if (Object.keys(remaining_openai_options).length > 0) {
        next_provider_options.openai = remaining_openai_options;
      } else {
        delete next_provider_options.openai;
      }
      return {
        ...part,
        providerOptions: Object.keys(next_provider_options).length > 0
          ? next_provider_options
          : undefined,
      };
    });
    return changed ? { ...message, content } as ModelMessage : message;
  });
}

/** 读取 Provider options 中的 OpenAI 协议字段。 */
function read_openai_provider_options(
  value: unknown,
): Record<string, unknown> | undefined {
  return read_json_record(read_json_record(value)?.openai);
}

/** 安全读取普通 JSON object。 */
function read_json_record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
