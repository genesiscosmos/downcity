/**
 * v8 逻辑地址到 v9 永久 Session UUID 的批次映射。
 * v8 storage_id 原值提升为目标 session_id；旧逻辑地址仅用于离线来源解析。
 * 只有明确活动地址的业务路由允许选择活动记录，历史引用有歧义时拒绝猜测。
 */
import { createHash as create_hash } from "node:crypto";
import { fail } from "./session-v7-database.mjs";

export const uuid_pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 离线批次身份策略；缺省或其他策略必须独立审阅，不能作为本策略重入。 */
export const identity_policy = "preserve-record-uuid-v1";

/** 清单仅保存映射，不保存正文；记录永久身份保持源 UUID。 */
export function identity_rows(database, agent_id) {
  return database.prepare("SELECT session_key,storage_id,session_id,category,archived,origin FROM sessions ORDER BY session_key").all().map(row => ({
    agent_id, session_key: row.session_key, source_storage_id: row.storage_id,
    source_session_id: row.session_id, category: row.category, archived: Boolean(row.archived),
    origin_type: JSON.parse(row.origin).type, session_id: row.storage_id,
  }));
}

/** 所有跨 Agent 引用共用同一全根映射，不能逐库重新分配。 */
export function create_resolver(agents) {
  const agent_ids = new Set();
  const all = agents.flatMap(agent => {
    if (typeof agent.agent_id !== "string" || !agent.agent_id || agent_ids.has(agent.agent_id)
      || !Array.isArray(agent.identities)) fail("identity_agent_mapping_invalid");
    agent_ids.add(agent.agent_id);
    const session_keys = new Set();
    for (const row of agent.identities) {
      if (!row || row.agent_id !== agent.agent_id || !Number.isSafeInteger(row.session_key) || row.session_key < 1
        || session_keys.has(row.session_key) || typeof row.source_session_id !== "string" || !row.source_session_id
        || typeof row.category !== "string" || !row.category || typeof row.archived !== "boolean") fail("identity_row_mapping_invalid");
      session_keys.add(row.session_key);
    }
    return agent.identities;
  });
  const storage = new Map(); const address = new Map(); const permanent = new Set(); const source_uuids = new Set();
  for (const row of all) {
    if (!uuid_pattern.test(row.source_storage_id)) fail("invalid_source_storage_uuid");
    if (source_uuids.has(row.source_storage_id)) fail("source_uuid_has_multiple_owners");
    source_uuids.add(row.source_storage_id);
    if (row.session_id !== row.source_storage_id) fail("identity_mapping_policy_mismatch");
    if (!uuid_pattern.test(row.session_id) || permanent.has(row.session_id)) fail("duplicate_target_session_identity");
    permanent.add(row.session_id);
    const storage_key = JSON.stringify([row.agent_id, row.source_storage_id]);
    if (storage.has(storage_key)) fail("duplicate_source_storage_identity");
    storage.set(storage_key, row);
    const key = JSON.stringify([row.agent_id, row.source_session_id]);
    const entries = address.get(key) ?? []; entries.push(row); address.set(key, entries);
  }
  return (agent_id, session_id, category, source_storage_id, active = false) => {
    if (!agent_id || !session_id) fail("incomplete_session_reference");
    let matches = source_storage_id ? [storage.get(JSON.stringify([agent_id, source_storage_id]))].filter(Boolean)
      : address.get(JSON.stringify([agent_id, session_id])) ?? [];
    matches = matches.filter(row => row.source_session_id === session_id && (!category || row.category === category) && (!active || !row.archived));
    if (matches.length !== 1) {
      const error = new Error(matches.length ? "ambiguous_session_reference" : "session_reference_not_found");
      error.migration_code = error.message;
      error.reference = { agent_id, session_id, ...(category ? { category } : {}), ...(source_storage_id ? { source_storage_id } : {}) };
      throw error;
    }
    return matches[0].session_id;
  };
}

/** 只改受信的来源关系，任意扩展字段及人类文本保持原值。 */
export function rewrite_origin(origin, agent_id, resolve) {
  const output = { ...origin };
  if (origin.parent_session_id !== undefined) output.parent_session_id = resolve(origin.parent_agent_id, origin.parent_session_id, origin.parent_session_category);
  if (origin.root_chat_session_id !== undefined) output.root_chat_session_id = resolve(agent_id, origin.root_chat_session_id, "chat");
  return output;
}

/** 普通输入与 Inbox 使用同一受信来源格式，callback/powers 载荷不做字符串替换。 */
export function rewrite_meta(meta, resolve) {
  if (!meta) return meta;
  if (meta.from?.kind !== "session") return meta;
  return { ...meta, from: { ...meta.from, session_id: resolve(meta.from.agent_id, meta.from.session_id, meta.from.category) } };
}

/** 转换已声明的结构化结果引用；摘要绑定原业务结果，旧游标重新绑定新引用。 */
export function rewrite_result_reference(reference, agent_id, resolve) {
  if (typeof reference !== "string" || !reference.startsWith("res_1_") || reference.length > 4096) fail("invalid_legacy_result_reference");
  let value;
  try { value = JSON.parse(Buffer.from(reference.slice(6), "base64url").toString()); } catch { fail("invalid_legacy_result_reference"); }
  if (!value || typeof value.message_id !== "string" || !value.message_id || typeof value.part_id !== "string" || !value.part_id
    || !Number.isSafeInteger(value.message_sequence) || value.message_sequence < 1 || !/^[A-Za-z0-9_-]{43}$/u.test(value.digest ?? "")
    || Object.keys(value).some(key => !["storage_id", "session_id", "category", "message_id", "message_sequence", "part_id", "digest"].includes(key))) fail("invalid_legacy_result_reference");
  const { storage_id, ...location } = value;
  return `res_2_${Buffer.from(JSON.stringify({ ...location, session_id: resolve(agent_id, value.session_id, value.category, storage_id) })).toString("base64url")}`;
}

/** 披露视图中的引用与游标是同一协议，必须一起转换。 */
export function rewrite_disclosure(value, agent_id, resolve, rewrite_reference = rewrite_result_reference) {
  if (!value || typeof value !== "object" || !["folded_result", "result_page"].includes(value.view) || !value.result_ref) return value;
  const result_ref = rewrite_reference(value.result_ref, agent_id, resolve);
  let next_cursor = value.next_cursor;
  if (next_cursor) {
    const decoded = Buffer.from(next_cursor, "base64url").toString();
    const match = /^1:(0|[1-9]\d*):([A-Za-z0-9_-]{43})$/u.exec(decoded);
    if (!match) fail("invalid_legacy_result_cursor");
    const payload = `1:${match[1]}`;
    const checksum = ref => create_hash("sha256").update(ref).update("\0").update(payload).digest("base64url");
    if (checksum(value.result_ref) !== match[2]) fail("invalid_legacy_result_cursor");
    next_cursor = Buffer.from(`${payload}:${checksum(result_ref)}`).toString("base64url");
  }
  return { ...value, result_ref, ...(value.next_cursor !== undefined ? { next_cursor } : {}) };
}

/** 只处理 Part 协议明确拥有的 meta 和工具披露字段。 */
export function rewrite_part(content, type, agent_id, resolve, rewrite_reference = rewrite_result_reference) {
  if (type === "inbox") return { ...content, ...(content.meta ? { meta: rewrite_meta(content.meta, resolve) } : {}) };
  if (type !== "tool") return content;
  return { ...content,
    ...(content.result_ref ? { result_ref: rewrite_reference(content.result_ref, agent_id, resolve) } : {}),
    ...(content.output !== undefined ? { output: rewrite_disclosure(content.output, agent_id, resolve, rewrite_reference) } : {}),
    ...(content.model_output !== undefined ? { model_output: rewrite_disclosure(content.model_output, agent_id, resolve, rewrite_reference) } : {}),
  };
}
