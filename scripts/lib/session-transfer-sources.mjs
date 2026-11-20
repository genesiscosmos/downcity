/** 单记录转移的外部来源清单与精确校验；引用不授予权限，不回落同逻辑ID。 */
import { digest, fail } from "./session-v7-database.mjs";
import { uuid_pattern } from "./session-transfer-record.mjs";
import { record_sources as historical_sources, verify_sources as verify_historical_sources } from "./session-transfer-historical-sources.mjs";

/** 从Tool保存的result_ref/model_output递归提取框架引用，字符串原文不搜索替换。 */
function result_references(value, output = new Set()) {
  if (!value || typeof value !== "object") return output;
  if (typeof value.result_ref === "string") output.add(value.result_ref);
  for (const child of Object.values(value)) if (child && typeof child === "object") result_references(child, output);
  return output;
}

/** 包只登记来源身份，不包含其他Session的canonical正文。 */
export function record_sources(record, runtime) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION < 13) return historical_sources(record, runtime);
  const sources = new Map();
  // 同一消息可被数百个结果引用指向；每轮只解码一次，缓存不跨 record 或数据库快照。
  const messages = new Map(record.messages.map(message => [message.message_id, message]));
  const parts_by_message = new Map(); const tools = new Map(); const decoded_messages = new Map();
  for (const part of record.message_parts) {
    if (!parts_by_message.has(part.message_id)) parts_by_message.set(part.message_id, []);
    parts_by_message.get(part.message_id).push(part);
    if (part.type === "tool") tools.set(part.part_id, part);
  }
  const add = source => sources.set(digest(source), source);
  const session_source = (agent_id, session_id, type) => {
    if (!uuid_pattern.test(session_id ?? "") || typeof agent_id !== "string" || !agent_id) fail("transfer_source_identity_invalid");
    add({ kind: "session", agent_id, session_id, ...(type ? { type } : {}) });
  };
  const meta_source = meta => {
    if (meta?.from?.kind === "session") session_source(meta.from.agent_id, meta.from.session_id, meta.from.type);
  };
  const relations = JSON.parse(record.metadata.relations);
  if (relations.parent !== undefined) session_source(relations.parent.agent_id, relations.parent.session_id, relations.parent_session_type);
  if (relations.root_chat_session_id !== undefined) session_source(runtime.agent_id, relations.root_chat_session_id, "chat");
  for (const message of record.messages) {
    if (message.origin_session_id) add({ kind: "fork", agent_id: runtime.agent_id,
      session_id: message.origin_session_id, message_id: message.origin_message_id, turn_id: message.origin_turn_id });
    if (message.meta) meta_source(JSON.parse(message.meta));
  }
  const input_type = runtime.AGENT_SESSION_SCHEMA_VERSION >= 12 ? "input" : "inbox";
  for (const part of record.message_parts) if (part.type === input_type) meta_source(JSON.parse(part.content).meta);
  for (const part of record.message_parts) if (part.type === "tool") {
    const content = JSON.parse(part.content);
    // 入参和 input_text 是历史调用原文，不参与结果寻址，也不会被迁移或重放。
    for (const result_ref of result_references({ result_ref: content.result_ref, output: content.output, model_output: content.model_output })) {
      const location = runtime.parse_result_ref(result_ref);
      // fork的本地复制Tool已包含不可变结果；原引用不必存在外部Session才可读。
      const local = tools.get(location.part_id);
      if (local) {
        const message = messages.get(local.message_id);
        if (!decoded_messages.has(local.message_id)) {
          const decoded = runtime.decode_session_message(message, parts_by_message.get(local.message_id), record.metadata.session_id);
          decoded_messages.set(local.message_id, new Map(decoded.role === "agent" ? decoded.parts.map(part => [part.part_id, part]) : []));
        }
        const tool = decoded_messages.get(local.message_id).get(local.part_id);
        const own = location.session_id === record.metadata.session_id && location.message_id === message.message_id
          && location.message_sequence === message.sequence && (!location.type || location.type === record.metadata.type);
        const copied = message.origin_session_id === location.session_id && message.origin_message_id === location.message_id
          && tool?.result_ref === result_ref;
        if (own || copied) {
          if (tool?.type !== "tool" || !["completed", "failed"].includes(tool.state)
            || runtime.result_digest(runtime.tool_result_value(tool)) !== location.digest) fail("transfer_result_snapshot_changed");
          continue;
        }
      }
      add({ kind: "result", agent_id: runtime.agent_id, ...location });
    }
  }
  return [...sources.values()];
}

/** 来源仅在当前 Agent 权限内精确解析；显式保留缺失来源不会放宽身份或摘要校验。 */
export function verify_sources(database, record, sources, runtime, allow_unresolved = false) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION < 13) return verify_historical_sources(database, record, sources, runtime, allow_unresolved);
  const unresolved = [];
  for (const source of sources) {
    if (!uuid_pattern.test(source.session_id ?? "") || !["session", "fork", "result"].includes(source.kind)) fail("transfer_source_identity_invalid");
    if (source.agent_id !== runtime.agent_id) { unresolved.push(source); continue; }
    const own = source.session_id === record.metadata.session_id;
    const row = own ? { ...record.metadata, session_key: null }
      : database.prepare("SELECT * FROM sessions WHERE session_id=?").get(source.session_id);
    if (!row) { unresolved.push(source); continue; }
    if (row.session_id !== source.session_id || (source.type && row.type !== source.type)) fail("transfer_source_identity_conflict");
    if (source.kind === "session") continue;
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
