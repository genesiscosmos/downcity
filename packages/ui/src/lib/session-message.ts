/** Session SDK canonical JSONL 到 Chat 展示协议的纯函数 adapter。 */
import type { DowncityChatMessage, DowncityChatMessagePart } from "../types/chat";

function to_string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parse_user_text(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/<current-status\b[^>]*>[\s\S]*?<\/current-status>/gi, "")
    .replace(/<attachments\b[^>]*>[\s\S]*?<\/attachments>/gi, "")
    .replace(/<user-message\b[^>]*>\s*/i, "")
    .replace(/\s*<\/user-message>/i, "")
    .trim();
}

/**
 * 将 Session SDK 的 user/assistant/action/error 记录投影为 UI 消息。
 * 该函数不读取运行时，也不修改输入，适合在宿主的 store selector 中使用。
 */
export function session_message_to_chat_message(record: Record<string, unknown>): DowncityChatMessage {
  const message_id = typeof record.message_id === "string" ? record.message_id : String(record.id ?? `message-${String(record.sequence ?? "unknown")}`);
  const record_type = String(record.type ?? "assistant");
  const role = record_type === "user" ? "user" : record_type === "error" ? "error" : "assistant";
  const raw_parts = Array.isArray(record.parts) ? [...record.parts] : [];
  raw_parts.sort((left, right) => Number((left as Record<string, unknown>)?.sequence ?? 0) - Number((right as Record<string, unknown>)?.sequence ?? 0));
  const parts = raw_parts.map((part, index) => session_part_to_chat_part(part, index)).filter((part): part is DowncityChatMessagePart => part !== null);
  if (role === "assistant") {
    const interactions = parts.filter((part) => part.type === "interaction");
    for (const interaction of interactions) {
      if (!interaction.interaction_tool_call_id) continue;
      const tool = parts.find((part) => part.type === "tool" && part.tool_call_id === interaction.interaction_tool_call_id);
      if (!tool || tool.type !== "tool") continue;
      tool.interaction_id = interaction.interaction_id;
      tool.interaction_type = interaction.interaction_type;
      tool.interaction_status = interaction.interaction_status;
      tool.title = interaction.title;
      tool.description = interaction.description;
      tool.questions = interaction.questions;
    }
  }
  if (role === "user") {
    const text_parts = parts.filter((part) => part.type === "text");
    for (const part of text_parts) if (part.text) part.text = parse_user_text(part.text);
  }
  if (record_type === "action") {
    const status = record.status === "completed" ? "finished" : record.status === "failed" ? "failed" : "progress";
    parts.push({ id: message_id, type: "operation", operation: { status, name: String(record.action_type ?? "operation"), label: typeof record.title === "string" ? record.title : undefined, error: status === "failed" ? to_string(record.description) : undefined, progress: typeof (record.data as Record<string, unknown> | undefined)?.progress === "number" ? (record.data as Record<string, number>).progress : undefined } });
  }
  return {
    id: message_id,
    role,
    content: typeof record.message === "string" ? record.message : undefined,
    parts,
    created_at: typeof record.created_at === "number" || typeof record.created_at === "string" ? record.created_at : undefined,
    is_streaming: record.status === "streaming",
    metadata: { official_message_id: message_id, presentation_status: typeof record.status === "string" ? record.status : undefined, error: typeof record.message === "string" && record_type === "error" ? record.message : undefined, sequence: typeof record.sequence === "number" ? record.sequence : undefined, revision: typeof record.revision === "number" ? record.revision : undefined, turn_id: to_string(record.turn_id), visibility: to_string(record.visibility), session_type: record_type },
  };
}

/** 将单个 canonical part 转为 UI part。 */
export function session_part_to_chat_part(raw_part: unknown, index = 0): DowncityChatMessagePart | null {
  if (!raw_part || typeof raw_part !== "object") return null;
  const part = raw_part as Record<string, unknown>;
  const type = String(part.type ?? "");
  const id = typeof part.part_id === "string" ? part.part_id : `${type}-${index}`;
  if (type === "text" || type === "reasoning") return { id, type, text: typeof part.text === "string" ? part.text : "", state: typeof part.state === "string" ? part.state : undefined };
  if (type === "step-start") return { id, type };
  if (type === "tool") return { id, type, tool_call_id: to_string(part.tool_call_id), tool_name: to_string(part.tool_name), tool_state: to_string(part.state), input_text: to_string(part.input_text), input: part.input, output: part.output, error: to_string(part.error) };
  if (type === "interaction") {
    const request = part.request && typeof part.request === "object" ? part.request as Record<string, unknown> : {};
    const source = request.source && typeof request.source === "object" ? request.source as Record<string, unknown> : {};
    const raw_questions = Array.isArray(request.questions) ? request.questions : [];
    return {
      id,
      type,
      interaction_id: typeof request.interaction_id === "string" ? request.interaction_id : typeof part.interaction_id === "string" ? part.interaction_id : undefined,
      interaction_tool_call_id: to_string(source.tool_call_id),
      interaction_type: typeof request.kind === "string" ? request.kind : typeof part.kind === "string" ? part.kind : typeof part.interaction_type === "string" ? part.interaction_type : undefined,
      interaction_status: typeof part.status === "string" ? part.status : undefined,
      title: typeof request.title === "string" ? request.title : typeof part.title === "string" ? part.title : undefined,
      description: typeof request.description === "string" ? request.description : typeof request.reason === "string" ? request.reason : typeof part.description === "string" ? part.description : undefined,
      questions: raw_questions.map((question, question_index) => {
        const item = question as Record<string, unknown>;
        return {
          id: typeof item.question_id === "string" ? item.question_id : `question-${question_index}`,
          prompt: typeof item.prompt === "string" ? item.prompt : "",
          response_type: item.response_type === "single_select" || item.response_type === "multi_select" ? item.response_type : "text",
          options: Array.isArray(item.options) ? item.options.map((option) => typeof option === "string" ? { value: option, label: option } : option as { value: string; label: string }) : undefined,
        };
      }),
    };
  }
  if (type === "file") return { id, type, url: typeof part.url === "string" ? part.url : undefined, media_type: typeof part.media_type === "string" ? part.media_type : undefined, filename: typeof part.filename === "string" ? part.filename : undefined };
  if (type === "source") return { id, type, source_title: typeof part.title === "string" ? part.title : undefined, source_url: typeof part.url === "string" ? part.url : undefined };
  if (type === "data") return { id, type, data_type: typeof part.data_type === "string" ? part.data_type : undefined, data: part.data };
  if (type === "changed-files") return { id, type, files: Array.isArray(part.files) ? part.files as DowncityChatMessagePart["files"] : [], summary: part.summary as DowncityChatMessagePart["summary"] };
  return null;
}

/** 将 Session SDK 的 active.jsonl 规范化为最终展示消息。
 * 同一 message_id 可能有多条 revision；这里只保留最新 revision，避免把运行中快照和最终快照重复渲染。
 */
export function session_jsonl_to_chat_messages(jsonl: string): DowncityChatMessage[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.visibility === "hidden") continue;
      const id = typeof record.message_id === "string" ? record.message_id : undefined;
      if (!id) continue;
      const previous = latest.get(id);
      const revision = Number(record.revision ?? 0);
      const previous_revision = Number(previous?.revision ?? -1);
      const updated_at = Number(record.updated_at ?? record.created_at ?? 0);
      const previous_updated_at = Number(previous?.updated_at ?? previous?.created_at ?? -1);
      if (!previous || revision > previous_revision || (revision === previous_revision && updated_at >= previous_updated_at)) latest.set(id, record);
    } catch { /* 忽略损坏行，保持历史可展示 */ }
  }
  return [...latest.values()]
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map(session_message_to_chat_message);
}
