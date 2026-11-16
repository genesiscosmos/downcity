/**
 * v9 终态的显式离线恢复策略。只派生新的模型快照，不改原始结果、身份或稳定水位。
 * 每条变化绑定原 content 和目标 content 摘要；审计明确标为迁移生成，不能充当首次披露证明。
 * 未知版本、已有引用冲突及缺少原始结果继续阻断，正式运行时不加载本模块。
 */
import { digest, fail } from "./session-v7-database.mjs";

export const terminal_policy = "preserve-proven-first-disclosure-v1";
export const recovery_policy = "rebuild-reviewed-terminal-snapshots-v1";

/** 批次只接受两个已定义的策略；缺省始终是保留已有证据。 */
export function assert_terminal_policy(policy) {
  if (![terminal_policy, recovery_policy].includes(policy)) fail("batch_terminal_policy_requires_review");
}

/** 派生检查点覆盖了变化 Part 时，其摘要不能继续描述旧模型视图。 */
export function checkpoint_covers(checkpoint, message_sequence, part_sequence) {
  return checkpoint.through_message_sequence > message_sequence
    || (checkpoint.through_message_sequence === message_sequence && checkpoint.through_part_sequence >= part_sequence);
}

/**
 * 单条终态恢复。已有完整快照直接复用；其余仅接受缺字段或预算超限两类可恢复异常。
 * 新引用只绑定本地 canonical 精确位置，已有引用仍须通过原 Part/结果摘要及后续来源校验。
 */
export function recover_tool(content, row, message, metadata, runtime) {
  const part = { ...content, type: "tool", part_id: row.part_id, sequence: row.sequence };
  let reason;
  try { runtime.assert_tool_terminal(part); return null; }
  catch (error) {
    reason = error.message;
    if (!["tool_terminal_snapshot_required", "result_disclosure_budget_exceeded"].includes(reason)) throw error;
  }
  if (part.output === undefined && typeof part.error !== "string") fail("tool_recovery_result_missing");
  const value = runtime.tool_result_value(part);
  const view = part.model_output;
  if (view && typeof view === "object" && !Array.isArray(view) && view.view === "folded_result"
    && (view.status !== part.state || typeof view.result_ref !== "string"
      || (part.result_ref !== undefined && view.result_ref !== part.result_ref))) fail("tool_terminal_model_view_conflict");
  if (part.result_ref !== undefined) {
    const location = runtime.parse_result_ref(part.result_ref);
    if (location.part_id !== row.part_id || location.digest !== runtime.result_digest(value)) fail("tool_terminal_result_ref_conflict");
  }
  const result_ref = part.result_ref ?? runtime.create_result_ref({ session_id: metadata.session_id,
    category: metadata.category, message_id: message.message_id, message_sequence: message.sequence, part_id: row.part_id }, value);
  const next = { ...content, result_ref, disclosure_version: runtime.DISCLOSURE_VERSION,
    model_output: runtime.disclose_result(value, result_ref, part.state) };
  runtime.assert_tool_terminal({ ...part, ...next });
  const target_content = JSON.stringify(next);
  return { target_content, audit: { evidence: "migration-rebuilt-snapshot", reason,
    source_content_sha256: digest(row.content), target_content_sha256: digest(target_content),
    output_sha256: digest(value), model_output_sha256: digest(next.model_output), result_ref_sha256: digest(result_ref),
    ...(content.model_output !== undefined ? { source_model_output_sha256: digest(content.model_output) } : {}),
    reference_created: part.result_ref === undefined, disclosure_version: runtime.DISCLOSURE_VERSION } };
}

/**
 * 为预检及 stage 提供相同的纯转换；返回新行和变化清单，原 record 与数据库均不修改。
 * 检查点按覆盖范围去重失效，较早且未受影响的检查点逐值保留。
 */
export function prepare_record(record, runtime, policy = terminal_policy) {
  assert_terminal_policy(policy);
  if (policy === terminal_policy) return { record, repairs: new Map(), blockers: [], cleared_checkpoints: [] };
  const messages = new Map(record.messages.map(message => [message.message_id, message]));
  const repairs = new Map(); const blockers = []; const boundaries = [];
  const message_parts = record.message_parts.map(row => {
    if (row.type !== "tool") return row;
    try {
      const message = messages.get(row.message_id);
      if (!message) fail("tool_message_missing");
      const recovered = recover_tool(JSON.parse(row.content), row, message, record.metadata, runtime);
      if (!recovered) return row;
      repairs.set(row.part_id, recovered.audit); boundaries.push([message.sequence, row.sequence]);
      return { ...row, content: recovered.target_content };
    } catch (error) {
      blockers.push({ session_id: record.metadata.session_id, message_id: row.message_id, part_id: row.part_id,
        reason: /^[a-z][a-z0-9_]+$/u.test(error.message) ? error.message : "tool_recovery_invalid" });
      return row;
    }
  });
  const cleared_checkpoints = record.composer_checkpoints.filter(checkpoint => boundaries.some(
    ([message_sequence, part_sequence]) => checkpoint_covers(checkpoint, message_sequence, part_sequence)));
  const cleared = new Set(cleared_checkpoints);
  return { record: { ...record, message_parts, composer_checkpoints: record.composer_checkpoints.filter(checkpoint => !cleared.has(checkpoint)) },
    repairs, blockers, cleared_checkpoints };
}
