/**
 * canonical Tool Part 的持久定位与版本固定派生。引用不包含路径，也不授予权限；
 * 宿主必须在当前 Agent 的只读 SessionStore 内解析，并验证快照摘要。
 * 分支可先验证本地复制的 Part 和保留的引用，再退回原会话；不得接受内容不同的同名 Part。
 */
import { createHash } from "node:crypto";
import type { ModelJsonValue, SessionAgentToolPart } from "@downcity/type";
import { project_tool_result } from "../messages/ToolResultProjection.js";
import { disclose_result } from "./ResultDisclosure.js";

/** 结果引用定位的不可变 canonical 身份。 */
export interface ResultLocation {
  /** 源会话稳定 ID。 */
  session_id: string;
  /** 源消息稳定 ID；分支另分配消息 ID，并在复制的 Part 中保留此引用。 */
  message_id: string;
  /** 源消息 sequence，用于精确读取，包含 internal 消息。 */
  message_sequence: number;
  /** canonical Tool Part 稳定 ID，与 tool_call_id 职责分离。 */
  part_id: string;
  /** 已知源物理分类；旧数据可以由调用边界补充。 */
  category?: string;
}

/** 引用解码后的快照定位，摘要绑定结果而非执行调用。 */
export interface ResultSnapshot extends ResultLocation {
  /** 稳定阅读值的 SHA-256 摘要，防止源结果被后续状态替换。 */
  digest: string;
}

/** 只对已清理的阅读值计算固定格式摘要。 */
export function result_digest(value: ModelJsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

/** 生成可跨重启解析的引用；调用方只在持久化成功后向模型发布。 */
export function create_result_ref(location: ResultLocation, value: ModelJsonValue): string {
  return `res_1_${Buffer.from(JSON.stringify({ ...location, digest: result_digest(value) })).toString("base64url")}`;
}

/** 校验引用语法，位置只作为宿主读取参数，绝不拼接物理路径。 */
export function parse_result_ref(result_ref: string): ResultSnapshot {
  if (typeof result_ref !== "string" || !result_ref.startsWith("res_1_") || result_ref.length > 4096) throw new Error("result_ref_invalid");
  let value: ResultSnapshot;
  try { value = JSON.parse(Buffer.from(result_ref.slice(6), "base64url").toString()); }
  catch { throw new Error("result_ref_invalid"); }
  if (!value || typeof value.session_id !== "string" || typeof value.message_id !== "string" || typeof value.part_id !== "string"
    || typeof value.digest !== "string" || !Number.isSafeInteger(value.message_sequence) || value.message_sequence < 1
    || (value.category !== undefined && typeof value.category !== "string")) throw new Error("result_ref_invalid");
  return value;
}

/** 统一阅读事实源；二进制只保留元信息，不将载荷当文本分页。 */
export function tool_result_value(part: SessionAgentToolPart): ModelJsonValue {
  return project_tool_result(part.output ?? part.error ?? null);
}

/** 历史/摘要只读已经保存的披露视图；没有记录的旧结果才派生首次视图。 */
export function disclosed_tool_result(part: SessionAgentToolPart, location: ResultLocation): ModelJsonValue {
  if (part.disclosure_version === 1 && part.model_output !== undefined) return part.model_output;
  const value = tool_result_value(part);
  return disclose_result(value, create_result_ref(location, value), part.state === "failed" ? "failed" : "completed");
}
