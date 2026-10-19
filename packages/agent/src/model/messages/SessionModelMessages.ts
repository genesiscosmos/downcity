/**
 * Canonical Session Message 到 Downcity ModelMessage 的转换模块。
 *
 * SessionMessage 是持久化事实，ModelMessage 是模型上下文。该模块是两者之间的唯一转换边界，
 * 不经过 UI Message、Executor Record 或 Provider 私有格式。
 */

import fs from "fs-extra";
import path from "node:path";
import { project_tool_result } from "./ToolResultProjection.js";
import { published_power_summaries, project_published_tool_input } from "./SessionPowerProjection.js";
import type {
  ModelContent,
  ModelFileContent,
  ModelMessage,
} from "@downcity/type";
import { render_session_user_context } from "@/session/messages/SessionUserContext.js";
import type {
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionAgentToolPart,
  SessionMessage,
  SessionUserFilePart,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";

/** 把一组 canonical Session Message 转换为模型消息。 */
export async function session_messages_to_model_messages(
  messages: readonly SessionMessage[],
  project_root?: string,
): Promise<ModelMessage[]> {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      output.push(...await convert_user_message(message, project_root));
    } else if (message.role === "agent") {
      output.push(...convert_assistant_message(message));
    }
  }
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
    const converted = await convert_user_parts([part as SessionUserMessagePart], undefined, true);
    return converted ? [converted] : [];
  }
  return convert_assistant_message(
    { ...message, parts: [part as SessionAgentMessagePart] },
    true,
    published_power_summaries(message),
  );
}

/** 把单条 canonical User Message 转换为模型消息。 */
async function convert_user_message(
  message: SessionUserMessage,
  project_root?: string,
): Promise<ModelMessage[]> {
  const converted = await convert_user_parts(message.parts, project_root);
  return converted ? [converted] : [];
}

/** 将 canonical User Parts 投影为单条模型消息。 */
async function convert_user_parts(
  parts: readonly SessionUserMessagePart[],
  project_root?: string,
  summary = false,
): Promise<ModelMessage | null> {
  const content: ModelContent[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text.trim()) content.push({ type: "text", text: part.text });
        break;
      case "context":
        content.push({
          type: "text",
          text: render_session_user_context(part.tag, part.context),
        });
        break;
      case "file":
        content.push(summary
          ? { type: "text", text: [`Attachment: ${part.filename || part.media_type}`, `Source: ${part.url.startsWith("data:") ? "inline attachment" : part.url}`, `Media type: ${part.media_type}`].join("\n") }
          : await convert_file_part(part, project_root));
        break;
      case "data":
        // Data Part 是持久化 UI 数据，不属于模型输入协议。
        break;
      default:
        assert_never(part);
    }
  }
  return content.length > 0 ? { role: "user", content } : null;
}

/** 把单条 canonical Agent Message 转换为模型 assistant 与 tool 消息。 */
function convert_assistant_message(
  message: SessionAgentMessage,
  summary = false,
  published_summaries = published_power_summaries(message),
): ModelMessage[] {
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
  for (const part of [...message.parts].sort((left, right) => left.sequence - right.sequence)) {
    const part_step_id = part.step_id ?? "__unscoped__";
    if (current_step_id !== null && part_step_id !== current_step_id) flush_step();
    current_step_id = part_step_id;
    switch (part.type) {
      case "text":
        if (part.text.trim()) content.push({ type: "text", text: part.text });
        break;
      case "reasoning":
        if (!summary && part.text.trim()) {
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
      value: project_tool_result(part.output ?? part.error ?? null),
    }],
  });
}

/** 把 Session 文件引用转换为单一来源的模型文件。 */
async function convert_file_part(
  part: Pick<SessionUserFilePart, "media_type" | "url" | "filename">,
  project_root?: string,
): Promise<ModelFileContent> {
  const data_match = /^data:[^;,]+;base64,(.*)$/isu.exec(part.url);
  if (data_match) {
    return build_model_file(part, {
      type: "base64",
      data: data_match[1] ?? "",
    });
  }
  if (/^https?:\/\//iu.test(part.url)) {
    return build_model_file(part, { type: "url", url: part.url });
  }
  const file_path = resolve_local_file_path(part.url, project_root);
  const data = (await fs.readFile(file_path)).toString("base64");
  return build_model_file(part, { type: "base64", data });
}

/** 构造标准模型文件内容。 */
function build_model_file(
  part: Pick<SessionUserFilePart, "media_type" | "filename">,
  source: ModelFileContent["source"],
): ModelFileContent {
  return {
    type: "file",
    media_type: part.media_type,
    source,
    ...(part.filename ? { filename: part.filename } : {}),
  };
}

/** 把本地文件引用限制在项目根目录内，绝对附件路径保持可读。 */
function resolve_local_file_path(raw_path: string, project_root?: string): string {
  if (path.isAbsolute(raw_path)) return path.resolve(raw_path);
  const root = path.resolve(String(project_root || "").trim() || process.cwd());
  const file_path = path.resolve(root, raw_path);
  const relative_path = path.relative(root, file_path);
  if (relative_path.startsWith("..") || path.isAbsolute(relative_path)) {
    throw new Error(`Session file escapes project root: ${raw_path}`);
  }
  return file_path;
}

/** 联合类型增加成员时，强制模型投影显式选择支持或忽略。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported Session model part: ${String((value as { type?: unknown }).type)}`);
}
