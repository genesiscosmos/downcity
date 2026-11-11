/**
 * Agent Message 稳定前缀的存储不变量。
 *
 * 水位包含对应 sequence 的 Part，只能覆盖连续且全部终态的前缀。已稳定的内容
 * 不允许被后续快照修改或省略；推进前还需核对数据库事实，避免漏报 changed_parts
 * 使模型投影与实际持久化内容不一致。完整 Step 的提交边界由 Writer 决定。
 */
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import type { SessionAgentMessagePart, SessionMessage } from "@downcity/type";
import { encode_session_part_row, type SessionMessagePartRow } from "./SessionStorageCodec.js";

/** 判断会改变执行结果的 Part 是否已经终态。 */
function is_terminal_part(part: SessionAgentMessagePart): boolean {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.state === "done";
    case "tool":
    case "action":
      return part.state === "completed" || part.state === "failed";
    default:
      return true;
  }
}

/** 校验水位的数值、连续前缀及终态；User 固定使用数据库水位 0。 */
export function validate_session_stable_prefix(message: SessionMessage): void {
  if (message.role !== "agent") return;
  const watermark = message.stable_part_sequence;
  if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > message.parts.length) {
    throw new Error(`Invalid stable Part sequence: ${message.message_id}`);
  }
  for (let index = 0; index < watermark; index += 1) {
    const part = message.parts[index];
    if (!part || part.sequence !== index + 1 || !is_terminal_part(part)) {
      throw new Error(`Stable prefix requires existing terminal Parts: ${message.message_id}`);
    }
  }
}

/** 比较持久化内容与候选内容；JSON 对象字段顺序不构成内容变化。 */
function same_part_content(row: SessionMessagePartRow, message: SessionMessage, part: SessionMessage["parts"][number]): boolean {
  const candidate = encode_session_part_row(message, part);
  return row.part_id === candidate.part_id && row.sequence === candidate.sequence
    && row.step_id === candidate.step_id && row.type === candidate.type
    && is_deep_strict_equal(JSON.parse(row.content), JSON.parse(candidate.content));
}

/** 拒绝修改或省略已有稳定 Part；也用于提交后核对新增稳定前缀与数据库一致。 */
export function assert_persisted_stable_prefix(
  database: DatabaseSync,
  message: SessionMessage,
  watermark: number,
): void {
  if (watermark === 0) return;
  const rows = database.prepare(
    "SELECT * FROM message_parts WHERE message_id = ? AND sequence <= ? ORDER BY sequence ASC",
  ).all(message.message_id, watermark) as unknown as SessionMessagePartRow[];
  if (rows.length !== watermark) throw new Error(`Stable prefix contains missing Parts: ${message.message_id}`);
  for (const row of rows) {
    const part = message.parts[row.sequence - 1];
    if (!part || !same_part_content(row, message, part)) {
      throw new Error(`Stable Part cannot change or disappear: ${row.part_id}`);
    }
  }
}
