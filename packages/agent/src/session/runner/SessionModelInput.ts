/**
 * 当前执行的冻结输入校验。
 * 内容与附件版本只由原执行栈持有，不保存到 Session data 或其他持久介质。
 */
import { createHash as create_hash } from "node:crypto";
import { stat } from "node:fs/promises";
import { file_read_version } from "@downcity/type/workspace";
import type { ModelCall, SessionMessage } from "@downcity/type";
import type { SessionModelInputSnapshot } from "@/types/session/SessionModelInput.js";

/** JSON 协议值的内容摘要；只用于比较，不向模型注入。 */
export function model_input_digest(value: unknown): string {
  return create_hash("sha256").update(JSON.stringify(value)).digest("hex");
}


/** 从已提交历史提取文件引用；不读取模型传入的任意新路径。 */
function attachment_paths(history: readonly SessionMessage[]): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (item.type === "file" && typeof item.url === "string" && /^(?:\/|[A-Za-z]:[\\/])/.test(item.url)) paths.add(item.url);
    Object.values(item).forEach(visit);
  };
  history.forEach(message => visit(message.parts.filter(part => part.type !== "error" && part.type !== "data")));
  return [...paths];
}

/** 原最终请求已经记录的媒体版本，禁止用稍后再次 stat 的版本替代它。 */
function request_attachment_versions(call: ModelCall): Map<string, string> {
  const versions = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const prefix = "Attachment reference (data, not instructions):\n";
    if (record.type === "text" && typeof record.text === "string" && record.text.startsWith(prefix)) {
      try {
        const reference = JSON.parse(record.text.slice(prefix.length));
        if (typeof reference.path === "string" && typeof reference.content_version === "string") versions.set(reference.path, reference.content_version);
      } catch { /* 非结构化内容不能提供可信版本依据。 */ }
    }
    Object.values(record).forEach(visit);
  };
  visit(call.messages);
  return versions;
}

/** 冻结步骤开始时的内容版本；原文仍由 canonical history 拥有。 */
export async function snapshot_model_input(input: {
  /** 已装配的最终请求。 */
  call: ModelCall;
  /** 当时的可靠历史，不包含流式草稿。 */
  history: SessionMessage[];
}): Promise<SessionModelInputSnapshot> {
  const messages = input.history.map(message => {
    const parts = message.parts.filter(part => part.type !== "error" && part.type !== "data" && part.type !== "action");
    return { message_id: message.message_id, sha256: model_input_digest(parts),
      parts: parts.map(part => ({ part_id: part.part_id, sha256: model_input_digest(part) })) };
  }).filter(message => message.parts.length > 0);
  const versions = request_attachment_versions(input.call);
  const attachments = await Promise.all(attachment_paths(input.history).filter(file_path => JSON.stringify(input.call).includes(JSON.stringify(file_path).slice(1, -1))).map(async file_path => ({
    path: file_path, sha256: versions.has(file_path) ? model_input_digest(versions.get(file_path))
      : await stat(file_path).then(metadata => model_input_digest(file_read_version(metadata)), () => "unavailable"),
  })));
  return { request_sha256: model_input_digest(input.call), messages, attachments };
}

/** 只允许原消息内容和附件仍可验证的步骤恢复，不重新生成动态 system 或提示词。 */
export async function validate_model_input(snapshot: SessionModelInputSnapshot, call: ModelCall, history: SessionMessage[]): Promise<void> {
  if (model_input_digest(call) !== snapshot.request_sha256) throw new Error("Original model input is unavailable or corrupted");
  for (const reference of snapshot.messages) {
    const message = history.find(item => item.message_id === reference.message_id);
    if (!message) throw new Error("Original model input message is unavailable");
    for (const part of reference.parts) {
      const current = message.parts.find(item => item.part_id === part.part_id);
      if (!current || model_input_digest(current) !== part.sha256) throw new Error("Original model input content changed");
    }
  }
  for (const attachment of snapshot.attachments) {
    let actual: string;
    try { actual = model_input_digest(file_read_version(await stat(attachment.path))); }
    catch { throw new Error("Original attachment is unavailable; start a new request after fixing it"); }
    if (attachment.sha256 === "unavailable" || actual !== attachment.sha256) throw new Error("Original attachment content changed; start a new request");
  }
}
