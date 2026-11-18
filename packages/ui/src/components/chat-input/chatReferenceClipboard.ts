/** 引用剪贴板协议：HTML 保存版本化引用，纯文本提供跨应用可读内容；只恢复已知属性。 */
import type { ChatReferenceInput } from "../../types/chat-input";
import { chat_reference_plain_text, read_session_reference, session_reference_tag } from "./session-reference";

const max_reference_length = 2_000_000;
const string_fields = ["tag", "message_id", "role", "workspace_id", "relative_path", "source_title", "task_id", "run_timestamp"] as const;

/** 校验剪贴板数据，不信任任意 HTML 属性或外部对象。 */
export function read_reference_payload(payload: string): ChatReferenceInput | undefined {
  if (payload.length > max_reference_length * 6) return;
  try {
    const packet = JSON.parse(payload);
    if (packet?.version !== 1 || !packet.reference || typeof packet.reference !== "object") return;
    const value = packet.reference;
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > max_reference_length) return;
    if (value.tag !== undefined && (typeof value.tag !== "string" || !/^[a-z][a-z0-9_-]*$/i.test(value.tag))) return;
    if (value.tag === session_reference_tag && !read_session_reference(value.text)) return;
    const result: ChatReferenceInput = { text: value.text };
    for (const field of string_fields) {
      if (value[field] !== undefined && value[field] !== null) {
        if (typeof value[field] !== "string" || value[field].length > 4096) return;
        Object.assign(result, { [field]: value[field] });
      }
    }
    if (result.role && !["user", "agent"].includes(result.role)) return;
    for (const field of ["line_start", "line_end"] as const) {
      if (value[field] !== undefined && value[field] !== null) {
        if (!Number.isSafeInteger(value[field]) || value[field] < 1) return;
        result[field] = value[field];
      }
    }
    if (result.line_end && result.line_start && result.line_end < result.line_start) return;
    return result;
  } catch { return; }
}

/** 只写入可往返的协议属性，不写入编辑器内部预览或任意 HTML。 */
export function reference_payload(reference: ChatReferenceInput): string {
  const payload = JSON.stringify({ version: 1, reference });
  const normalized = read_reference_payload(payload);
  if (!normalized) throw new Error("引用内容无效或过长，无法复制");
  return JSON.stringify({ version: 1, reference: normalized });
}

/** 作为 HTML 文本和属性的统一转义。 */
function escape_html(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 结构化复制必须同时成功写入 HTML 和文本，不悄悄退化成丢失格式的纯文本。 */
export async function copy_chat_reference(reference: ChatReferenceInput): Promise<void> {
  const payload = reference_payload(reference);
  const plain_text = chat_reference_plain_text(reference);
  const html = `<span data-chat-reference="" data-downcity-reference="${escape_html(payload)}">${escape_html(plain_text)}</span>`;
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持结构化剪贴板");
  await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plain_text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
}
