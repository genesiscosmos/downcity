/**
 * Canonical Session Message 到 Downcity ModelMessage 的转换模块。
 *
 * SessionMessage 是持久化事实，ModelMessage 是模型上下文。该模块是两者之间的唯一转换边界，
 * 不经过 UI Message、Executor Record 或 Provider 私有格式。
 */

import { project_session_attachment, is_generated_attachment_context } from "./SessionAttachmentProjection.js";
import { max_request_media_bytes } from "@downcity/type/workspace";
import { model_media_bytes, project_session_inbox, type SessionProjectionOptions } from "./SessionInboxProjection.js";
import { assert_tool_terminal, disclosed_tool_result } from "../results/ResultReference.js";
import { published_power_summaries, project_published_tool_input } from "./SessionPowerProjection.js";
import type {
  ModelContent,
  ModelMessage,
} from "@downcity/type";
import { render_session_user_context } from "@/session/messages/SessionUserContext.js";
import type {
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionAgentToolPart,
  SessionMessage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";

/** 把一组 canonical Session Message 转换为模型消息。 */
export async function session_messages_to_model_messages(
  messages: readonly SessionMessage[],
  project_root?: string,
  attachment_root?: string,
): Promise<ModelMessage[]> {
  const output: ModelMessage[] = [];
  let remaining_media_bytes = max_request_media_bytes;
  // 从最新消息选取媒体，最终保持原始对话及内容顺序。
  const batches: ModelMessage[][] = [];
  for (const message of [...messages].reverse()) {
    const options: SessionProjectionOptions = { project_root, attachment_root, remaining_media_bytes };
    const converted = message.role === "user"
      ? await convert_user_message(message, options)
      : await convert_assistant_message(message, options);
    remaining_media_bytes -= model_media_bytes(converted);
    batches.push(converted);
  }
  for (const batch of batches.reverse()) output.push(...batch);
  return output;
}

/**
 * 摘要复用正常消息投影，仅省略 reasoning，并把附件转换为引用而非加载二进制。
 * 保留完整源 Message 供 Power 已发布内容裁剪使用，避免逐 Part 投影丢失关联。
 */
export async function project_summary_part(
  message: SessionMessage,
  part: SessionUserMessagePart | SessionAgentMessagePart,
): Promise<ModelMessage[]> {
  if (message.role === "user") {
    const previous = message.parts[message.parts.findIndex(item => item.part_id === part.part_id) - 1];
    if (is_generated_attachment_context(part, previous)) return [];
    const converted = await convert_user_parts([part as SessionUserMessagePart]);
    return converted ? [converted] : [];
  }
  return convert_assistant_message(
    { ...message, parts: [part as SessionAgentMessagePart] },
    { summary: true },
    published_power_summaries(message),
  );
}

/** 把单条 canonical User Message 转换为模型消息。 */
async function convert_user_message(
  message: SessionUserMessage,
  options: SessionProjectionOptions,
): Promise<ModelMessage[]> {
  const parts = [...message.parts].sort((left, right) => left.sequence - right.sequence);
  const converted = await convert_user_parts(parts, options.project_root, options.remaining_media_bytes, options.attachment_root, true);
  return converted ? [converted] : [];
}

/** 将 canonical User Parts 投影为单条模型消息。 */
async function convert_user_parts(
  parts: readonly SessionUserMessagePart[],
  project_root?: string,
  remaining_media_bytes = max_request_media_bytes,
  attachment_root?: string,
  automatic_images = false,
): Promise<ModelMessage | null> {
  const content: ModelContent[] = [];
  for (const [index, part] of [...parts.entries()].reverse()) {
    if (is_generated_attachment_context(part, parts[index - 1])) continue;
    switch (part.type) {
      case "text":
        if (part.text.trim()) content.unshift({ type: "text", text: part.text });
        break;
      case "context":
        content.unshift({
          type: "text",
          text: render_session_user_context(part.tag, part.context),
        });
        break;
      case "file": {
        const projected = await project_session_attachment(part, project_root, false, remaining_media_bytes, attachment_root, automatic_images);
        remaining_media_bytes -= model_media_bytes([{ role: "user", content: projected }]);
        content.unshift(...projected);
        break;
      }
      case "data":
        // Data Part 是持久化 UI 数据，不属于模型输入协议。
        break;
      default:
        assert_never(part);
    }
  }
  return content.length > 0 ? { role: "user", content } : null;
}

/** 按 Part 顺序输出 assistant/tool 与 inbox；先从最新 inbox 分配共享媒体预算。 */
async function convert_assistant_message(
  message: SessionAgentMessage,
  options: SessionProjectionOptions = {},
  published_summaries = published_power_summaries(message),
): Promise<ModelMessage[]> {
  const parts = [...message.parts].sort((left, right) => left.sequence - right.sequence);
  const inbox_messages = new Map<string, ModelMessage>();
  let remaining_media_bytes = options.remaining_media_bytes ?? max_request_media_bytes;
  for (const part of [...parts].reverse()) {
    if (part.type !== "inbox") continue;
    const projected = await project_session_inbox(part, { ...options, remaining_media_bytes });
    remaining_media_bytes -= model_media_bytes([projected]);
    inbox_messages.set(part.part_id, projected);
  }
  const output: ModelMessage[] = [];
  let current_step_id: string | null = null;
  const content: ModelContent[] = [];
  const tool_results: ModelContent[] = [];
  const flush_step = (): void => {
    if (content.length > 0) output.push({ role: "assistant", content: [...content] });
    if (tool_results.length > 0) output.push({ role: "tool", content: [...tool_results] });
    content.length = 0;
    tool_results.length = 0;
  };
  for (const part of parts) {
    if (part.type === "inbox") {
      // 即使 inbox 与前后内容共享 step_id，也必须先完成此前的 assistant/tool 消息。
      flush_step();
      current_step_id = null;
      output.push(inbox_messages.get(part.part_id)!);
      continue;
    }
    const part_step_id = part.step_id ?? "__unscoped__";
    if (current_step_id !== null && part_step_id !== current_step_id) flush_step();
    current_step_id = part_step_id;
    switch (part.type) {
      case "text":
        if (part.text.trim()) content.push({ type: "text", text: part.text });
        break;
      case "reasoning":
        if (!options.summary && part.text.trim()) {
          content.push({
            type: "reasoning",
            text: part.text,
            ...(part.reasoning_signature
              ? { signature: part.reasoning_signature }
              : {}),
          });
        }
        break;
      case "tool":
        assert_tool_terminal(part);
        if (part.input !== undefined) {
          append_tool_content(part, content, tool_results, published_summaries.get(part.tool_call_id));
        }
        break;
      case "power":
        content.push({ type: "text", text: part.fallback_text });
        break;
      case "file":
      case "data":
      case "action":
      case "error":
        // 这些 Part 只属于运行状态或宿主展示，不进入模型历史。
        break;
      default:
        assert_never(part);
    }
  }
  flush_step();
  return output;
}

/** 把 canonical Tool Part 投影为模型工具调用和可选工具结果。 */
function append_tool_content(
  part: SessionAgentToolPart,
  content: ModelContent[],
  tool_results: ModelContent[],
  published_summary?: string,
): void {
  content.push({
    type: "tool_call",
    tool_call_id: part.tool_call_id,
    tool_name: part.tool_name,
    input: project_published_tool_input(part.input, published_summary),
  });
  if (part.state !== "completed" && part.state !== "failed") return;
  tool_results.push({
    type: "tool_result",
    tool_call_id: part.tool_call_id,
    tool_name: part.tool_name,
    outcome: part.state === "completed" ? "succeeded" : "failed",
    content: [{
      type: "json",
      value: disclosed_tool_result(part),
    }],
  });
}

/** 联合类型增加成员时，强制模型投影显式选择支持或忽略。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported Session model part: ${String((value as { type?: unknown }).type)}`);
}
