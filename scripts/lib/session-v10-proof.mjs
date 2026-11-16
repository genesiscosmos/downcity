/**
 * v9→v10 预检：默认只证明已有快照，显式恢复策略才派生迁移快照。
 * 冻结 v9 与正式 v10 的校验边界独立；报告仅含身份、水位、摘要及变化原因。
 */
import { DatabaseSync } from "node:sqlite";
import { digest, fail, check_integrity } from "./session-v7-database.mjs";
import { schema_descriptor, validate_v9 } from "./session-v9-database.mjs";
import { read_record } from "./session-transfer-record.mjs";
import { record_sources, verify_sources } from "./session-transfer-sources.mjs";
import { terminal_policy, recovery_policy, prepare_record, checkpoint_covers } from "./session-v10-recovery.mjs";

export { terminal_policy };

/** Compare full table/index/trigger definitions, not just a numeric format marker. */
export function assert_protocol_database(database, agent_id, runtime) {
  runtime.assert_agent_session_schema(database, agent_id);
  const expected = new DatabaseSync(":memory:");
  const normalized = items => items.map(item => ({ ...item, sql: item.sql?.replace(/\s+/gu, " ").trim() }));
  try {
    expected.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    if (digest(normalized(schema_descriptor(database))) !== digest(normalized(schema_descriptor(expected)))) fail("session_protocol_schema_mismatch");
  } finally { expected.close(); }
  check_integrity(database);
}

/** 按批次策略检验原快照或迁移快照，并验证全部正式结果引用的精确来源。 */
export function inspect_record(record, agent_id, runtime, database, policy = terminal_policy, historical = runtime) {
  const prepared = prepare_record(record, runtime, policy);
  const original = record;
  record = prepared.record;
  const tools = []; const blockers = [];
  for (const row of record.message_parts.filter(row => row.type === "tool")) {
    const message = record.messages.find(message => message.message_id === row.message_id);
    const base = { session_id: record.metadata.session_id, message_id: row.message_id, part_id: row.part_id,
      part_sequence: row.sequence, stable_part_sequence: message?.stable_part_sequence,
      stable: row.sequence <= (message?.stable_part_sequence ?? 0),
      affected_checkpoints: original.composer_checkpoints.filter(checkpoint => checkpoint_covers(checkpoint, message?.sequence, row.sequence)).length };
    try {
      if (!message) fail("tool_message_missing");
      const blocked = prepared.blockers.find(blocker => blocker.part_id === row.part_id);
      if (blocked) fail(blocked.reason);
      const content = JSON.parse(row.content);
      const part = { ...content, type: "tool", part_id: row.part_id, sequence: row.sequence };
      runtime.assert_tool_terminal(part);
      const terminal = part.state === "completed" || part.state === "failed";
      tools.push({ ...base, state: part.state, evidence: terminal ? "saved-complete-snapshot" : "first-recovery-pending",
        ...(terminal ? { disclosure_version: part.disclosure_version, model_output_sha256: digest(part.model_output),
          result_ref_sha256: digest(part.result_ref), output_sha256: digest(runtime.tool_result_value(part)) } : {}),
        ...prepared.repairs.get(row.part_id) });
    } catch (error) {
      const reason = /^[a-z][a-z0-9_]+$/u.test(error.message) ? error.message : "tool_snapshot_invalid";
      tools.push({ ...base, evidence: "blocked", reason }); blockers.push({ ...base, reason });
    }
  }
  if (!blockers.length) {
    try {
      for (const message of record.messages) runtime.decode_session_message(message,
        record.message_parts.filter(part => part.message_id === message.message_id), record.metadata.session_id);
      // 重建前后的显式引用都必须成立，不能通过替换旧模型视图消除原有引用冲突。
      for (const evidence of policy === recovery_policy ? [original, record] : [record]) {
        const source_runtime = { ...runtime, agent_id,
          decode_session_message: evidence === original && policy === recovery_policy ? historical.decode_session_message : runtime.decode_session_message };
        const sources = record_sources(evidence, source_runtime).filter(source => source.kind === "result");
        if (sources.length && !database) fail("tool_reference_external_evidence_required");
        // 源库尚未重建；外部结果以冻结 codec 读取 canonical，摘要仍按目标协议验证。
        if (sources.length) verify_sources(database, evidence, sources, { ...source_runtime, decode_session_message: historical.decode_session_message });
      }
    } catch (error) {
      blockers.push({ session_id: record.metadata.session_id, reason: /^[a-z][a-z0-9_]+$/u.test(error.message) ? error.message : "tool_reference_evidence_invalid" });
    }
  }
  return { tools, blockers, checkpoint_count: original.composer_checkpoints.length,
    ...(policy === recovery_policy ? { cleared_checkpoints: prepared.cleared_checkpoints.map(checkpoint => ({
      session_id: record.metadata.session_id, namespace: checkpoint.namespace, checkpoint_id: checkpoint.checkpoint_id,
      source_sha256: digest(checkpoint), through_message_sequence: checkpoint.through_message_sequence,
      through_part_sequence: checkpoint.through_part_sequence })) } : {}) };
}

/** Audit every canonical message, including unstable tools, without touching source rows. */
export function inspect_database(database, agent_id, historical, runtime, policy = terminal_policy) {
  assert_protocol_database(database, agent_id, historical);
  validate_v9(database, agent_id, historical);
  const tools = []; const blockers = []; const cleared_checkpoints = []; let checkpoint_count = 0;
  for (const session of database.prepare("SELECT session_id FROM sessions ORDER BY session_key").iterate()) {
    const result = inspect_record(read_record(database, session.session_id), agent_id, runtime, database, policy, historical);
    tools.push(...result.tools); blockers.push(...result.blockers); checkpoint_count += result.checkpoint_count;
    cleared_checkpoints.push(...(result.cleared_checkpoints ?? []));
  }
  return { tools, blockers, checkpoint_count, ...(policy === recovery_policy ? { cleared_checkpoints } : {}) };
}

/** Validate the published target using the current codec, preserving stable/checkpoint facts. */
export function validate_target(database, agent_id, runtime) {
  assert_protocol_database(database, agent_id, runtime);
  validate_v9(database, agent_id, runtime);
  for (const session of database.prepare("SELECT session_id FROM sessions ORDER BY session_key").iterate()) {
    const proof = inspect_record(read_record(database, session.session_id), agent_id, runtime, database);
    if (proof.blockers.length) fail(proof.blockers[0].reason);
  }
}
