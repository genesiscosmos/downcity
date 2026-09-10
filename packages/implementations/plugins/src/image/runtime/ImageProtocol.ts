/**
 * ImagePlugin 与 City 图片服务之间的任务协议归一化。
 *
 * 关键点（中文）
 * - 本模块校验任务、模型与 Session 消息的最小稳定结构。
 * - 所有返回值保持为纯 JSON 数据，便于 Plugin Action 安全透传。
 * - 本模块不调用图片服务，也不持有任务或 Plugin 生命周期。
 */

import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type {
  ImagePluginJobCreateResult,
  ImagePluginJobResult,
  ImagePluginJobResultInput,
  ImagePluginModel,
  ImagePluginModelsResult,
  ImagePluginResult,
} from "@/image/types/ImagePlugin.js";

/** 判断值是否为普通对象。 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 把异常描述为字符串，并保留有限深度的 cause 诊断链。 */
export function describe_error(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [error.message || error.name || "Error"];
  let current_error: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current_error && depth < 3) {
    if (current_error instanceof Error) {
      const code = (current_error as { code?: unknown }).code;
      const code_text = typeof code === "string" && code ? `[${code}] ` : "";
      parts.push(`${code_text}${current_error.message || current_error.name}`.trim());
      current_error = (current_error as { cause?: unknown }).cause;
    } else {
      parts.push(String(current_error));
      break;
    }
    depth += 1;
  }
  return parts.filter(Boolean).join(" :: ");
}

/** 归一化图片任务查询 payload。 */
export function normalize_image_result_payload(
  payload: PluginJsonValue | undefined,
): ImagePluginJobResultInput {
  const record = to_record(payload ?? {});
  if (!record) {
    throw new TypeError("ImagePlugin.image_result payload must be an object");
  }
  const job_id = typeof record.job_id === "string" ? record.job_id.trim() : "";
  if (!job_id) {
    throw new TypeError("ImagePlugin.image_result payload must include job_id");
  }
  const until_done = record.until_done === true;
  const max_wait_ms = typeof record.max_wait_ms === "number" && Number.isFinite(record.max_wait_ms)
    ? Math.max(0, Math.floor(record.max_wait_ms))
    : undefined;
  const poll_interval_ms = typeof record.poll_interval_ms === "number"
    && Number.isFinite(record.poll_interval_ms)
    ? Math.max(0, Math.floor(record.poll_interval_ms))
    : undefined;
  return {
    ...record,
    job_id,
    ...(until_done ? { until_done: true } : {}),
    ...(max_wait_ms !== undefined ? { max_wait_ms } : {}),
    ...(poll_interval_ms !== undefined ? { poll_interval_ms } : {}),
  } as ImagePluginJobResultInput;
}

/** 校验图片服务返回的 Downcity Session 消息。 */
export function normalize_image_result(result: ImagePluginResult): ImagePluginResult {
  const record = to_record(result);
  if (!record || !Array.isArray(record.parts)) {
    throw new TypeError("ImagePlugin image provider must return a Downcity Session message");
  }
  if (record.role !== "agent") {
    throw new TypeError("ImagePlugin image provider must return an Agent Session message");
  }
  for (const part of record.parts) {
    const part_record = to_record(part);
    if (part_record?.type !== "file") continue;
    const url = String(part_record.url || "").trim();
    if (!url) throw new TypeError("ImagePlugin result file parts must include a url");
  }
  return result;
}

/** 归一化模型元数据为 JSON 对象。 */
function normalize_json_object(value: unknown): PluginJsonObject | undefined {
  const record = to_record(value);
  return record ? record as PluginJsonObject : undefined;
}

/** 归一化图片模型信息，并过滤非图片模型。 */
function normalize_image_model(value: ImagePluginModel): ImagePluginModel | null {
  const record = to_record(value);
  if (!record) return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;
  const modalities = Array.isArray(record.modalities)
    ? record.modalities.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!modalities.includes("image")) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => String(item || "").trim()).filter(Boolean)
    : undefined;
  const meta = normalize_json_object(record.meta);
  return {
    id,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    modalities,
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(meta ? { meta } : {}),
  };
}

/** 归一化模型列表结果。 */
export function normalize_image_models(values: ImagePluginModel[]): ImagePluginModelsResult {
  return {
    items: values
      .map((item) => normalize_image_model(item))
      .filter((item): item is ImagePluginModel => item !== null),
  };
}

/** 校验任务创建结果。 */
export function validate_created_job(value: ImagePluginJobCreateResult): void {
  if (
    !value
    || typeof value !== "object"
    || typeof value.job_id !== "string"
    || !value.job_id.trim()
  ) {
    throw new TypeError("ImagePlugin image_create must return a job_id");
  }
}

/** 校验任务查询结果。 */
export function validate_job_result(value: ImagePluginJobResult): void {
  const status = value?.status;
  if (
    status !== "queued"
    && status !== "running"
    && status !== "succeeded"
    && status !== "failed"
  ) {
    throw new TypeError("ImagePlugin image_result must return a valid job status");
  }
}
