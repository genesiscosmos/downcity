/** 引用剪贴板快照校验与纯文本投影，不读取 Session 或宿主文件。 */
import type { ChatReferenceInput } from "../../types/chat-input";
import { local_file_reference_tag } from "./local_file_reference";
export const session_reference_tag = "session-reference";
/** 校验来自剪贴板或消息历史的引用正文；工作区允许为空（未绑定）。 */
export function read_session_reference(text: string): Record<string, unknown> & { session_id: string } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return;
    const { session_id, agent_id, category, origin_type, workspace_id, session_path, title, archived } = value as Record<string, unknown>;
    if (typeof session_id !== "string" || !session_id || typeof agent_id !== "string" || !agent_id
      || typeof category !== "string" || !category || typeof origin_type !== "string" || !origin_type
      || typeof workspace_id !== "string" || typeof title !== "string"
      || (session_path !== undefined && typeof session_path !== "string")) return;
    return { ...(archived === true ? { archived: true } : {}), session_id, agent_id, category, origin_type, workspace_id, ...(session_path ? { session_path } : {}), title };
  } catch { return; }
}

/** 判断 canonical Context 是否应该展示为聊天引用。 */
export function is_chat_reference_tag(tag: string): boolean {
  return ["reference", "task_result", "file-reference", session_reference_tag, local_file_reference_tag].includes(tag);
}

/** Session 引用的纯文本是原始 ID；其他引用保留完整引用正文。 */
export function chat_reference_plain_text({ tag, text }: ChatReferenceInput): string {
  return (tag === session_reference_tag ? read_session_reference(text)?.session_id : undefined) ?? text;
}
