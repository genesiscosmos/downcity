/**
 * canonical Tool Part 的持久定位与版本固定派生。引用不包含路径，也不授予权限；
 * 宿主必须在当前 Agent 的只读 SessionStore 内解析，并验证快照摘要。
 * 分支可先验证本地复制的 Part 和保留的引用，再退回原会话；不得接受内容不同的同名 Part。
 */
import { createHash } from "node:crypto";
import type { ModelJsonValue, SessionAgentToolPart } from "@downcity/type";
import { project_tool_result } from "../messages/ToolResultProjection.js";
import { DISCLOSURE_VERSION, RESULT_BYTES, result_bytes } from "./ResultDisclosure.js";

import { assert_session_id } from "../../session/SessionIdentity.js";
import type { ResultLocation, ResultSnapshot } from "@/types/model/ResultReference.js";
export type { ResultLocation, ResultSnapshot } from "@/types/model/ResultReference.js";

/** 只对已清理的阅读值计算固定格式摘要。 */
export function result_digest(value: ModelJsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

/** 生成可跨重启解析的引用；调用方只在持久化成功后向模型发布。 */
export function create_result_ref(location: ResultLocation, value: ModelJsonValue): string {
  assert_session_id(location.session_id);
  return `res_2_${Buffer.from(JSON.stringify({ ...location, digest: result_digest(value) })).toString("base64url")}`;
}

/** 校验引用语法，位置只作为宿主读取参数，绝不拼接物理路径。 */
export function parse_result_ref(result_ref: string): ResultSnapshot {
  if (typeof result_ref !== "string" || !result_ref.startsWith("res_2_") || result_ref.length > 4096) throw new Error("result_ref_invalid");
  let value: ResultSnapshot;
  try { value = JSON.parse(Buffer.from(result_ref.slice(6), "base64url").toString()); }
  catch { throw new Error("result_ref_invalid"); }
  if (!value || typeof value.session_id !== "string" || typeof value.message_id !== "string" || typeof value.part_id !== "string"
    || typeof value.digest !== "string" || !Number.isSafeInteger(value.message_sequence) || value.message_sequence < 1
    || !value.message_id || !value.part_id || !/^[A-Za-z0-9_-]{43}$/u.test(value.digest)
    || (value.category !== undefined && (typeof value.category !== "string" || !value.category.trim()))
    || Object.keys(value).some(key => !["session_id", "message_id", "message_sequence", "part_id", "category", "digest"].includes(key))) throw new Error("result_ref_invalid");
  try { assert_session_id(value.session_id); } catch { throw new Error("result_ref_invalid"); }
  return value;
}

/** 统一阅读事实源；二进制只保留元信息，不将载荷当文本分页。 */
export function tool_result_value(part: SessionAgentToolPart): ModelJsonValue {
  return project_tool_result(part.output !== undefined ? part.output : part.error ?? null);
}

/** Validate JSON without stringify normalization: undefined, non-finite numbers and exotic objects are invalid. */
function assert_json_value(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("tool_terminal_model_output_invalid");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("tool_terminal_model_output_invalid");
  }
  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) assert_json_value(item, ancestors);
  ancestors.delete(value);
}

/** Enforce the persisted v10 Tool contract without deriving or replacing its fixed view. */
export function assert_tool_terminal(part: SessionAgentToolPart): void {
  if (part.disclosure_version !== undefined && part.disclosure_version !== DISCLOSURE_VERSION) {
    throw new Error("tool_disclosure_version_unsupported");
  }
  const terminal = part.state === "completed" || part.state === "failed";
  if (!terminal) {
    if (part.disclosure_version !== undefined || part.model_output !== undefined || part.result_ref !== undefined) {
      throw new Error("tool_terminal_snapshot_on_running_part");
    }
    return;
  }
  if (part.disclosure_version !== DISCLOSURE_VERSION || part.model_output === undefined || typeof part.result_ref !== "string") {
    throw new Error("tool_terminal_snapshot_required");
  }
  assert_json_value(part.model_output);
  if (result_bytes(part.model_output) > RESULT_BYTES) throw new Error("result_disclosure_budget_exceeded");
  const view = part.model_output;
  if (view && typeof view === "object" && !Array.isArray(view) && view.view === "folded_result"
    && (view.result_ref !== part.result_ref || view.status !== part.state)) {
    throw new Error("tool_terminal_model_view_conflict");
  }
  const snapshot = parse_result_ref(part.result_ref);
  if (snapshot.part_id !== part.part_id || snapshot.digest !== result_digest(tool_result_value(part))) {
    throw new Error("tool_terminal_result_ref_conflict");
  }
}

/** History and summaries read only the validated immutable first-disclosure snapshot. */
export function disclosed_tool_result(part: SessionAgentToolPart): ModelJsonValue {
  assert_tool_terminal(part);
  if (part.state !== "completed" && part.state !== "failed") throw new Error("tool_terminal_snapshot_required");
  return structuredClone(part.model_output!);
}
