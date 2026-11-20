/** 将完成与委派快照转成当前 Session 协议；只解释框架字段，保留历史事件和业务正文。 */
import { createHash } from "node:crypto";
import path from "node:path";
import { load_runtime } from "./session-runtime.mjs";
import { convert_actor, convert_origin } from "./session-descriptor-conversion.mjs";
import { convert_input_identity } from "./session-v12-conversion.mjs";
import { exists } from "./session-v8-files.mjs";
import { open_source } from "./session-v9-database.mjs";
import { digest, fail } from "./session-v7-database.mjs";

const runtime = await load_runtime(true);
const { restore_session_descriptor } = runtime;
const delivery_states = new Set(["pending", "delivered", "cancelled", "saved"]);
const execution_states = new Set(["pending", "running", "succeeded", "failed", "stopped"]);

/** 只读查询当前已迁移的 Session 库，补全旧快照缺少的分区并核查待执行委派。 */
export async function with_session_catalog(root_path, action) {
  const databases = new Map();
  const read_session = (agent_id, session_id) => {
    if (!agent_id || agent_id === "." || agent_id === ".." || /[\\/\0]/u.test(agent_id)) fail("invalid_journal_agent");
    if (!databases.has(agent_id)) {
      const database_path = path.join(root_path, "agents", agent_id, "sessions.db");
      databases.set(agent_id, exists(database_path) ? open_source(database_path) : null);
    }
    const database = databases.get(agent_id);
    if (!database) return;
    const row = database.prepare("SELECT session_key, type, kind, relations FROM sessions WHERE session_id = ?").get(session_id);
    if (!row) return;
    const descriptor = restore_session_descriptor({ ...JSON.parse(row.relations), type: row.type, kind: row.kind }, row.type);
    return {
      descriptor,
      has_messages: (turn_id) => !!(turn_id
        ? database.prepare("SELECT 1 FROM messages WHERE session_key = ? AND turn_id = ? LIMIT 1").get(row.session_key, turn_id)
        : database.prepare("SELECT 1 FROM messages WHERE session_key = ? LIMIT 1").get(row.session_key)),
      has_tool_call: (turn_id, call_id) => !!database.prepare(`SELECT 1 FROM messages
        JOIN message_parts USING (session_key, message_id)
        WHERE session_key = ? AND turn_id = ? AND type = 'tool'
        AND json_extract(content, '$.tool_call_id') = ? LIMIT 1`).get(row.session_key, turn_id, call_id),
    };
  };
  try { return await action(read_session); }
  finally { for (const database of databases.values()) database?.close(); }
}

/** 补全旧来源，并在展开过渡描述时保留创建事实，拒绝覆盖日志自身的字段。 */
function read_descriptor(origin, nested, identity, session) {
  if (origin !== undefined) {
    if (!origin || nested !== undefined || identity.type !== undefined) fail("mixed_journal_descriptor_fields");
    const type = origin.category ?? session?.descriptor.type;
    if (!type) fail("journal_session_type_unknown");
    return convert_origin(origin, type, runtime);
  }
  const input = nested === undefined ? identity : nested;
  if (!input?.type || !input.kind) fail("journal_descriptor_missing");
  const descriptor = restore_session_descriptor(input);
  if (nested === undefined) return descriptor;
  if (Object.keys(nested).some(key => Object.hasOwn(identity, key))) fail("mixed_journal_descriptor_fields");
  return { ...nested, ...descriptor };
}

/** 事件与 Retry 快照各自转换，消息边界、顺序和输入身份沿用各自的原始快照。 */
function convert_event(event, identity) {
  if (event?.completion_id !== identity.completion_id || event.session_id !== identity.session_id
    || event.turn_id !== identity.turn_id || !Array.isArray(event.messages) || !event.result) fail("invalid_completion_event");
  for (const message of event.messages) {
    convert_actor(message.meta);
    if (!Array.isArray(message.parts)) fail("invalid_completion_message");
    message.parts = message.parts.map(part => {
      if (part.type === "power") return { ...part, type: "view" };
      if (part.type === "inbox") part = { ...convert_input_identity(part), type: "input" };
      if (part.type === "input") convert_actor(part.meta);
      return part;
    });
  }
}

/** 确认曾经完成的记录仍为终态，待确认记录保留原处理器和重试状态。 */
function convert_completion(record, agent_id, file_id, read_session) {
  const { origin, descriptor: current_descriptor, ...rest } = record;
  const { event, current, state, deliveries } = rest;
  if (!event?.session_id || !event.turn_id || event.completion_id !== `completion:${event.session_id}:${event.turn_id}`
    || createHash("sha256").update(event.completion_id).digest("hex") !== file_id
    || !["prepared", "pending", "delivered"].includes(state) || !deliveries || typeof deliveries !== "object"
    || Array.isArray(deliveries)) fail("invalid_completion_record");
  const recipients = Object.values(deliveries);
  if (recipients.some(delivery => typeof delivery?.delivered !== "boolean" || !Number.isFinite(delivery.retry_at)
    || !Number.isSafeInteger(delivery.attempt_count) || delivery.attempt_count < 0)
    || (state === "delivered" && recipients.some(delivery => !delivery.delivered))) fail("invalid_completion_delivery_state");
  const session = read_session(agent_id, event.session_id);
  const descriptor = read_descriptor(origin, current_descriptor, rest, session);
  if (session && session.descriptor.type !== descriptor.type) fail("completion_session_type_mismatch");
  if (origin && state !== "delivered" && !session?.has_messages(event.turn_id)) fail("pending_completion_turn_missing");
  convert_event(event, event);
  if (current) convert_event(current, event);
  return { ...rest, ...descriptor };
}

/** 缺少执行代次的历史身份用明确的归档标识表示，永远不会与当前执行的 UUID 匹配。 */
function convert_delegation(record, agent_id, file_id, read_session) {
  const { caller, ...rest } = record;
  if (record.delegation_id !== file_id || !caller?.agent_id || !caller.session_id || !caller.turn_id || !caller.tool_call_id
    || !record.work_session_id || !delivery_states.has(record.delivery_state) || !execution_states.has(record.execution_state)) fail("invalid_delegation_record");
  const { origin, descriptor: current_descriptor, ...identity } = caller;
  const { execution_id } = identity;
  const parent = read_session(caller.agent_id, caller.session_id);
  const descriptor = read_descriptor(origin, current_descriptor, identity, parent);
  if (parent && parent.descriptor.type !== descriptor.type) fail("delegation_caller_type_mismatch");
  if ((!origin || execution_id !== undefined) && (typeof execution_id !== "string" || !execution_id.trim())) fail("invalid_delegation_execution_id");
  const unbound = !execution_id && record.delivery_state === "pending";
  if (unbound) {
    const child = read_session(agent_id, record.work_session_id);
    if (record.execution_state !== "pending" || record.work_turn_id || record.result
      || !parent?.has_tool_call(caller.turn_id, caller.tool_call_id) || child?.descriptor.type !== "work" || child.has_messages()) fail("unbound_delegation_requires_review");
    rest.execution_state = "stopped";
    rest.delivery_state = "cancelled";
  }
  return { ...rest, caller: { ...identity, ...descriptor, execution_id: execution_id ?? `legacy-delegation:${file_id}` } };
}

/** 返回待发布字节；已经是当前格式的记录通过同一校验并保留原始字节。 */
export function convert_journal(source, scope, read_session) {
  const record = JSON.parse(source);
  const before = digest(record);
  const args = [record, scope.agent_id, scope.file_id, read_session];
  const converted = scope.kind === "completions" ? convert_completion(...args) : convert_delegation(...args);
  // 对象布局不应让已迁移的记录反复重写。
  const { state, execution_state, delivery_state } = converted;
  const unchanged = digest(converted) === before;
  return { content: unchanged ? source : Buffer.from(JSON.stringify(converted)),
    state: state ?? delivery_state, stopped: scope.kind === "delegations" && record.execution_state !== execution_state };
}
