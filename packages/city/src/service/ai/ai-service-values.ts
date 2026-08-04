/**
 * AIService 值解析与类型守卫模块。
 *
 * 集中管理 AIChannel 输出、usage 和图片任务数据的纯函数转换，让 AIService 主模块
 * 只保留路由、生命周期与持久化编排。
 */

import { httpError } from "../../utils/helpers.js";
import type { AsyncJobRecord, AsyncJobStatus } from "../../types/AsyncJob.js";
import type {
  AICharge,
  AIChargedResult,
  AIImageCreateResult,
  AIImageResult,
} from "../../types/AI.js";
import { normalizeAIUsage } from "./helpers.js";

/** AIChannel action 拆包后的统一输出。 */
export interface ResolvedChannelOutput {
  /** AIChannel 对外输出。 */
  output: unknown;
  /** AIChannel 计算的可选扣费行。 */
  charge?: AICharge | Promise<AICharge | undefined>;
}

/** 可转存到 Federation storage 的图片文件 part。 */
export type StoredImagePart = Record<string, unknown> & {
  /** 固定文件 part 类型。 */
  type: "file";
  /** 可抓取的 HTTP(S) URL。 */
  url: string;
};

/** 判断一个值是否为 HTTP Response。 */
export function isResponse(value: unknown): value is Response {
  return typeof value === "object" && value !== null && "status" in value && "headers" in value;
}

/** 判断一个值是否为普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 判断 AIChannel 是否返回了带账单 Response。 */
export function isChannelChargedOutput(value: unknown): value is AIChargedResult {
  return isRecord(value) && "output" in value;
}

/** 判断一个值是否为 Promise-like。 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value && typeof (value as { then?: unknown }).then === "function");
}

/** 读取可选字符串。 */
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 读取可选 opaque 字符串，不对值做 trim 或其它改写。 */
export function read_optional_opaque_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 读取可空字符串字段。 */
function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 读取可空数字字符串字段。 */
function readNullableNumberString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value : null;
}

/** 读取可选数字。 */
export function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 读取正数配置。 */
export function normalizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 读取任务状态。 */
function readJobStatus(value: unknown): AsyncJobStatus {
  return value === "queued" || value === "running" || value === "fetching" || value === "succeeded" || value === "failed"
    ? value
    : "failed";
}

/** 安全解析 JSON 对象。 */
export function parseRecordJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 安全解析 UIMessage。 */
export function parseImageMessage(value: unknown): AIImageResult["result"] | undefined {
  const record = parseRecordJson(value);
  return record.role === "assistant" && Array.isArray(record.parts)
    ? record as unknown as AIImageResult["result"]
    : undefined;
}

/** 把 TableApi 普通行转成图片任务记录。 */
export function rowToAsyncJobRecord(row: Record<string, unknown>): AsyncJobRecord {
  return {
    job_id: String(row.job_id ?? ""),
    job_type: String(row.job_type ?? ""),
    status: readJobStatus(row.status),
    input_json: String(row.input_json ?? "{}"),
    state_json: readNullableString(row.state_json),
    result_json: readNullableString(row.result_json),
    error: readNullableString(row.error),
    message: readNullableString(row.message),
    poll_after_ms: readNullableNumberString(row.poll_after_ms),
    bureau_id: readNullableString(row.bureau_id),
    user_id: readNullableString(row.user_id),
    service_id: readNullableString(row.service_id),
    model_id: readNullableString(row.model_id),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

/** 保留已知 HTTP 错误状态，其它异常统一包装成上游错误。 */
export function imageActionError(error: unknown, fallback_message: string): Error {
  if (error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number") return error;
  return httpError(502, error instanceof Error ? error.message : fallback_message);
}

/** 从输出对象中读取上游 usage。 */
export function extractUsage(output: unknown): unknown {
  if (!isRecord(output)) return undefined;
  const metadata = isRecord(output.metadata) ? output.metadata : undefined;
  if (metadata && "usage" in metadata) return metadata.usage;
  if (metadata && "usageMetadata" in metadata) return metadata.usageMetadata;
  if ("usage" in output) return output.usage;
  return undefined;
}

/** 兼容常见上游 usage 字段。 */
export function normalizeUsage(usage: unknown): {
  /** 输入 token 数。 */
  input_tokens?: number;
  /** 输出 token 数。 */
  output_tokens?: number;
  /** 缓存命中的输入 token 数。 */
  cached_tokens?: number;
  /** 推理 token 数。 */
  reasoning_tokens?: number;
} {
  return normalizeAIUsage(usage);
}

/** 统计 UIMessage file parts 里的图片数量。 */
export function countImageOutputs(output: unknown): number | undefined {
  if (!isRecord(output) || !Array.isArray(output.parts)) return undefined;
  const count = output.parts.filter((part) => {
    if (!isRecord(part)) return false;
    const type = String(part.type ?? "");
    const media_type = String(part.mediaType ?? part.media_type ?? "");
    return type === "file" && media_type.startsWith("image/");
  }).length;
  return count > 0 ? count : undefined;
}

/** 判断 file part URL 是否是可转存的远程 URL。 */
export function isStorableRemoteFilePart(part: unknown): part is StoredImagePart {
  if (!isRecord(part) || part.type !== "file") return false;
  const url = readOptionalString(part.url);
  return Boolean(url && /^https?:\/\//iu.test(url));
}

/** 读取 file part 的媒体类型。 */
export function readFilePartMediaType(part: Record<string, unknown>): string {
  return readOptionalString(part.mediaType) ?? readOptionalString(part.media_type) ?? "application/octet-stream";
}

/** 读取 file part 的建议文件名。 */
export function readFilePartFilename(part: Record<string, unknown>): string | undefined {
  return readOptionalString(part.filename);
}

/** 判断 AIChannel 是否返回了图片任务创建结果。 */
export function isImageChannelCreateResult(value: unknown): value is AIImageCreateResult {
  if (!value || typeof value !== "object") return false;
  const record = value as { job_id?: unknown; status?: unknown };
  return typeof record.job_id === "string" && Boolean(record.job_id.trim()) && isImageJobStatus(record.status);
}

/** 判断 AIChannel 是否返回了图片任务查询结果。 */
export function isImageChannelResult(value: unknown): value is AIImageResult {
  if (!value || typeof value !== "object") return false;
  const record = value as { job_id?: unknown; status?: unknown; result?: unknown };
  if (typeof record.job_id !== "string" || !record.job_id.trim() || !isImageJobStatus(record.status)) return false;
  if (record.status === "succeeded") {
    const result = isRecord(record.result) ? record.result : undefined;
    if (!result || result.role !== "assistant" || !Array.isArray(result.parts)) return false;
  }
  return true;
}

/** 判断图片任务状态。 */
function isImageJobStatus(value: unknown): boolean {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}
