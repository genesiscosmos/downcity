/** 单记录转移的外部来源清单与精确校验；引用不授予权限，不回落同逻辑ID。 */
import { digest, fail } from "./session-v7-database.mjs";
import { uuid_pattern } from "./session-transfer-record.mjs";

/** 从Tool保存的result_ref/model_output递归提取框架引用，字符串原文不搜索替换。 */
function result_references(value, output = new Set()) {
  if (!value || typeof value !== "object") return output;
  if (typeof value.result_ref === "string") output.add(value.result_ref);
  for (const child of Object.values(value)) if (child && typeof child === "object") result_references(child, output);
  return output;
}

/** 包只登记来源身份，不包含其他Session的canonical正文。 */
export function record_sources(record, runtime) {
  const sources = new Map();
  const add = source => sources.set(digest(source), source);
  for (const message of record.messages) if (message.origin_session_id) add({ kind: "fork", storage_id: message.origin_storage_id,
    session_id: message.origin_session_id, message_id: message.origin_message_id, turn_id: message.origin_turn_id });
  for (const part of record.message_parts) if (part.type === "tool") {
    const content = JSON.parse(part.content);
    for (const result_ref of result_references(content)) {
      const location = runtime.parse_result_ref(result_ref);
      // fork的本地复制Tool已包含不可变结果；原引用不必存在外部Session才可读。
      const local = record.message_parts.find(candidate => candidate.part_id === location.part_id && candidate.type === "tool");
      if (local) {
        const message = record.messages.find(message => message.message_id === local.message_id);
        const decoded = runtime.decode_session_message(message, record.message_parts.filter(candidate => candidate.message_id === local.message_id), record.metadata.session_id);
        const tool = decoded.parts.find(candidate => candidate.part_id === local.part_id);
        if (tool?.type === "tool" && ["completed", "failed"].includes(tool.state) && runtime.result_digest(runtime.tool_result_value(tool)) === location.digest
          && (JSON.parse(local.content).result_ref === result_ref || (location.storage_id === record.metadata.storage_id && location.message_id === message.message_id))) continue;
      }
      add({ kind: "result", ...location });
    }
  }
  return [...sources.values()];
}

/** UUID、逻辑身份、消息来源都精确匹配；外部旧引用缺UUID只能显式保留不可解析。 */
export function verify_sources(database, record, sources, runtime, allow_unresolved = false) {
  const unresolved = [];
  for (const source of sources) {
    const own = source.storage_id === record.metadata.storage_id;
    const row = own ? { ...record.metadata, session_key: null } : uuid_pattern.test(source.storage_id ?? "")
      ? database.prepare("SELECT * FROM sessions WHERE storage_id=?").get(source.storage_id) : undefined;
    if (!row) { unresolved.push(source); continue; }
    if (row.session_id !== source.session_id || (source.category && row.category !== source.category)) fail("transfer_source_identity_conflict");
    const message = own ? record.messages.find(message => message.message_id === source.message_id)
      : database.prepare("SELECT * FROM messages WHERE session_key=? AND message_id=?").get(row.session_key, source.message_id);
    if (!message) { unresolved.push(source); continue; }
    if (source.kind === "fork") {
      if (source.turn_id && message.turn_id !== source.turn_id) fail("transfer_source_identity_conflict");
    } else if (source.kind === "result") {
      if (message.sequence !== source.message_sequence) fail("transfer_source_identity_conflict");
      const parts = own ? record.message_parts.filter(part => part.message_id === message.message_id)
        : database.prepare("SELECT * FROM message_parts WHERE session_key=? AND message_id=? ORDER BY sequence").all(row.session_key, message.message_id);
      const decoded = runtime.decode_session_message(message, parts, source.session_id);
      const tool = decoded.role === "agent" ? decoded.parts.find(part => part.part_id === source.part_id) : undefined;
      if (tool?.type !== "tool" || !["completed", "failed"].includes(tool.state) || runtime.result_digest(runtime.tool_result_value(tool)) !== source.digest) fail("transfer_result_snapshot_changed");
    } else fail("transfer_source_kind_invalid");
  }
  if (unresolved.length && !allow_unresolved) fail("transfer_external_sources_unresolved");
  return unresolved;
}
