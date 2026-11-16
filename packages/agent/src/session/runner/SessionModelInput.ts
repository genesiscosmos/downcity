/**
 * 最终模型请求的持久输入依据与内容版本校验。
 *
 * 使用既有 canonical data Part 保存脱敏快照与来源摘要。媒体仅保存摘要及原附件引用，
 * 已知秘密由 Session 遮罩器处理；临时 URL 不复制。此记录不能直接重建工具闭包。
 */
import { createHash as create_hash } from "node:crypto";
import { stat } from "node:fs/promises";
import { file_read_version } from "@downcity/type/workspace";
import type { JsonValue, ModelCall, SessionMessage } from "@downcity/type";
import type { SessionModelInputSnapshot } from "@/types/session/SessionModelInput.js";

/** JSON 协议值的内容摘要；只用于比较，不向模型注入。 */
export function model_input_digest(value: unknown): string {
  return create_hash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 原媒体只保存哈希描述；URL 与认证形态字段不复制到诊断快照。 */
function reference_request(value: unknown, key = "", references = new Map<string, JsonValue>()): JsonValue {
  if (typeof value === "string") {
    if (/^(?:data|base64|authorization|api_key|access_token)$/i.test(key)
      || /^data:.*;base64,/i.test(value) || /https?:\/\/[^\s]+[?]/i.test(value)) {
      return { reference_sha256: model_input_digest(value), bytes: Buffer.byteLength(value) };
    }
    return references.get(value) ?? value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(item => reference_request(item, "", references));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .map(([name, item]) => [name, reference_request(item, name, references)]));
  return null;
}

/** 相同历史原文和前序快照使用内容引用，避免每个步骤再次存储整段上下文。 */
function canonical_references(history: readonly SessionMessage[]): Map<string, JsonValue> {
  const references = new Map<string, JsonValue>();
  const visit = (value: unknown, message_id: string, part_id: string, location: string[]): void => {
    if (typeof value === "string" && value.length > 128) {
      if (!references.has(value)) references.set(value, { message_id, part_id, location, sha256: model_input_digest(value) });
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, message_id, part_id, [...location, String(index)]));
    else if (value && typeof value === "object") {
      const encoded = JSON.stringify(value);
      if (encoded.length > 128 && !references.has(encoded)) references.set(encoded, { message_id, part_id, location, json_encoded: true, sha256: model_input_digest(encoded) });
      for (const [name, item] of Object.entries(value)) visit(item, message_id, part_id, [...location, name]);
    }
  };
  for (const message of history) for (const part of message.parts) {
    if (part.type === "error" || part.type === "data" && part.data_type !== "model_request_input") continue;
    visit(part, message.message_id, part.part_id, []);
  }
  return references;
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

/** 构造步骤开始时的持久输入快照，媒体零复制，原文仍由 canonical history 拥有。 */
export async function snapshot_model_input(input: {
  /** 与尝试记录一致的稳定步骤身份。 */
  step_id: string;
  /** 原任务身份。 */
  turn_id: string;
  /** 该步骤模型身份。 */
  model_id: string;
  /** 已装配的最终请求。 */
  call: ModelCall;
  /** 当时的可靠历史，不包含流式草稿。 */
  history: SessionMessage[];
  /** Session 已知秘密遮罩器。 */
  redact: (value: unknown) => unknown;
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
  return { version: 1, step_id: input.step_id, turn_id: input.turn_id, model_id: input.model_id,
    request_sha256: model_input_digest(input.call), request: reference_request(input.redact(input.call), "", canonical_references(input.history)), messages, attachments };
}

/** 只允许原消息内容和附件仍可验证的步骤恢复，不重新生成动态 system 或提示词。 */
export async function validate_model_input(snapshot: SessionModelInputSnapshot, call: ModelCall, history: SessionMessage[]): Promise<void> {
  if (snapshot.version !== 1 || model_input_digest(call) !== snapshot.request_sha256) throw new Error("Original model input is unavailable or corrupted");
  for (const reference of snapshot.messages) {
    const message = history.find(item => item.message_id === reference.message_id);
    if (!message) throw new Error("Original model input message is unavailable");
    for (const part of reference.parts) {
      const current = message.parts.find(item => item.part_id === part.part_id);
      if (!current || model_input_digest(current) !== part.sha256) throw new Error("Original model input content changed");
    }
  }
  const validate_references = (value: JsonValue): void => {
    if (Array.isArray(value)) { value.forEach(validate_references); return; }
    if (!value || typeof value !== "object") return;
    if (typeof value.message_id === "string" && typeof value.part_id === "string" && Array.isArray(value.location)) {
      let original: unknown = history.find(message => message.message_id === value.message_id)?.parts.find(part => part.part_id === value.part_id);
      for (const key of value.location) original = original && typeof original === "object" ? (original as Record<string, unknown>)[String(key)] : undefined;
      if (original === undefined || model_input_digest(value.json_encoded ? JSON.stringify(original) : original) !== value.sha256) throw new Error("Saved model input reference changed or is unavailable");
    } else Object.values(value).forEach(validate_references);
  };
  validate_references(snapshot.request);
  for (const attachment of snapshot.attachments) {
    let actual: string;
    try { actual = model_input_digest(file_read_version(await stat(attachment.path))); }
    catch { throw new Error("Original attachment is unavailable; start a new request after fixing it"); }
    if (attachment.sha256 === "unavailable" || actual !== attachment.sha256) throw new Error("Original attachment content changed; start a new request");
  }
}
