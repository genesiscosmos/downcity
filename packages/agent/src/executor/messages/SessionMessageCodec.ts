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
  isTextUIPart,
  type ModelMessage,
  type Tool,
  type ToolSet,
} from "ai";
import {
  is_session_message_record,
  type SessionRecordV1,
} from "@/executor/types/SessionRecords.js";
import {
  hydrateFileUrlPartsForModel,
  injectFilePartsFromAttachments,
} from "@executor/messages/SessionAttachmentMapper.js";

/**
 * 过滤回调返回值中的 user 文本消息。
 *
 * 关键点（中文）
 * - 用途：从 on_step_callback 返回的消息里挑出可并入推理上下文的 user 文本。
 * - 输入：任意 SessionRecordV1[]（可能混有 assistant/tool/action/空消息）。
 * - 输出：只包含“非空 user 文本”的消息数组。
 */
export function pickMergedUserMessages(
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

    // 把所有 text part 拼接为一个字符串用于判空。
    const text = message.parts
      // 只保留 text 类型 part。
      .filter(isTextUIPart)
      // 提取 text 字段并规整为字符串。
      .map((part) => String(part.text ?? ""))
      // 多段文本按换行拼接。
      .join("\n")
      // 去除首尾空白。
      .trim();

    // 只有非空文本才视为有效消息。
    return Boolean(text);
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
export async function toModelMessages(
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
  const enrichedMessages = await injectFilePartsFromAttachments(
    model_messages,
    project_root,
  );

  // 第二步（中文）：把历史里的资源 URL 在内存中 hydrate 成模型可消费的 data URL。
  const hydratedMessages = await hydrateFileUrlPartsForModel(
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
  return await convertToModelMessages(input, {
    // 如果当前轮有工具，就把工具注入转换选项。
    ...(tools && Object.keys(tools).length > 0 ? { tools: tools as ToolSet } : {}),
    // 忽略历史里的不完整工具调用，提升容错性。
    ignoreIncompleteToolCalls: true,
  });
}
