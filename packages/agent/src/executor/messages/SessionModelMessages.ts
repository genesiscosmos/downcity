/**
 * Canonical Session Message 到 Downcity ModelMessage 的转换模块。
 *
 * SessionMessage 是持久化事实，ModelMessage 是模型上下文。该模块是两者之间的唯一转换边界，
 * 不经过 UI Message、Executor Record 或 Provider 私有格式。
 */

import fs from "fs-extra";
import path from "node:path";
import type {
  ModelContent,
  ModelFileContent,
  ModelJsonValue,
  ModelMessage,
} from "@downcity/type";
import { parse_chat_message_markup } from "@executor/messages/ChatMessageMarkup.js";
import { render_session_user_context } from "@/session/messages/SessionUserContext.js";
import type {
  SessionAgentMessage,
  SessionAgentToolPart,
  SessionMessage,
  SessionUserFilePart,
  SessionUserMessage,
} from "@downcity/type";
import type { SessionContextSnapshot } from "@/types/session/SessionSegment.js";

/** 把完整 Session 上下文快照转换为模型消息。 */
export async function session_context_to_model_messages(
  snapshot: Readonly<SessionContextSnapshot>,
  project_root?: string,
): Promise<ModelMessage[]> {
  const messages = await session_messages_to_model_messages(
    snapshot.messages,
    project_root,
  );
  if (!snapshot.summary?.text.trim()) return messages;
  return [
    {
      role: "assistant",
      content: [{ type: "text", text: snapshot.summary.text }],
    },
    ...messages,
  ];
}

/** 把一组 canonical Session Message 转换为模型消息。 */
export async function session_messages_to_model_messages(
  messages: readonly SessionMessage[],
  project_root?: string,
): Promise<ModelMessage[]> {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    if (message.type === "user") {
      output.push(...await convert_user_message(message, project_root));
    } else if (message.type === "agent") {
      output.push(...convert_assistant_message(message));
    }
  }
  return output;
}

/** 把单条 canonical User Message 转换为模型消息。 */
async function convert_user_message(
  message: SessionUserMessage,
  project_root?: string,
): Promise<ModelMessage[]> {
  const content: ModelContent[] = [];
  const has_explicit_file = message.parts.some((part) => part.type === "file");
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "context") {
      content.push({
        type: "text",
        text: render_session_user_context(part.tag, part.context),
      });
    } else if (part.type === "file") {
      content.push(await convert_file_part(part, project_root));
    }
  }
  if (!has_explicit_file) {
    content.push(...await read_markup_files(message, project_root));
  }
  return content.length > 0 ? [{ role: "user", content }] : [];
}

/** 把单条 canonical Agent Message 转换为模型 assistant 与 tool 消息。 */
function convert_assistant_message(message: SessionAgentMessage): ModelMessage[] {
  const content: ModelContent[] = [];
  const tool_results: ModelContent[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning" && part.text.trim()) {
      content.push({
        type: "reasoning",
        text: part.text,
        ...(part.reasoning_signature
          ? { signature: part.reasoning_signature }
          : {}),
      });
    } else if (part.type === "tool" && part.input !== undefined) {
      append_tool_content(part, content, tool_results);
    }
  }
  return [
    ...(content.length > 0 ? [{ role: "assistant", content } as ModelMessage] : []),
    ...(tool_results.length > 0
      ? [{ role: "tool", content: tool_results } as ModelMessage]
      : []),
  ];
}

/** 把 canonical Tool Part 投影为模型工具调用和可选工具结果。 */
function append_tool_content(
  part: SessionAgentToolPart,
  content: ModelContent[],
  tool_results: ModelContent[],
): void {
  content.push({
    type: "tool_call",
    tool_call_id: part.tool_call_id,
    tool_name: part.tool_name,
    input: part.input ?? null,
  });
  if (part.state !== "completed" && part.state !== "failed") return;
  tool_results.push({
    type: "tool_result",
    tool_call_id: part.tool_call_id,
    tool_name: part.tool_name,
    outcome: part.state === "completed" ? "succeeded" : "failed",
    content: [{
      type: "json",
      value: to_model_json_value(part.output ?? part.error ?? null),
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

/** 解析兼容聊天入口写入文本中的附件标记。 */
async function read_markup_files(
  message: SessionUserMessage,
  project_root?: string,
): Promise<ModelFileContent[]> {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const output: ModelFileContent[] = [];
  for (const file of parse_chat_message_markup(text).files) {
    const media_type = guess_media_type(file.path);
    if (!media_type || (!media_type.startsWith("image/") && media_type !== "application/pdf")) {
      continue;
    }
    const file_path = resolve_local_file_path(file.path, project_root);
    if (!await fs.pathExists(file_path)) continue;
    output.push({
      type: "file",
      media_type,
      source: {
        type: "base64",
        data: (await fs.readFile(file_path)).toString("base64"),
      },
      filename: path.basename(file_path),
    });
  }
  return output;
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

/** 根据文件扩展名解析模型可用的 MIME type。 */
function guess_media_type(file_path: string): string | undefined {
  const extension = path.extname(file_path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".pdf") return "application/pdf";
  return undefined;
}

/** 将未知值限制为可传输 JSON。 */
function to_model_json_value(value: unknown): ModelJsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as ModelJsonValue;
}
