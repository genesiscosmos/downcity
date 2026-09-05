/**
 * Task Run 只读存储投影。
 *
 * 从统一 Task 聚合目录中的完成元数据、进度快照和用户可见产物生成稳定协议，
 * 不创建第二份索引或事实源。
 */

import path from "node:path";
import type { PluginStorage } from "@downcity/city/plugin";
import type { TaskRunDetailView, TaskRunHistoryItemView } from "@/task/types/TaskCommand.js";
import type {
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
  ShipTaskRunTriggerV1,
} from "@/task/types/Task.js";
import { getTaskDir, getTaskRunDir, is_task_run_timestamp } from "./Paths.js";

const MAX_ARTIFACT_BYTES = 512 * 1024;

/** 列出一个 Task 的全部运行记录，并按最新时间倒序排列。 */
export async function list_task_runs(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** Task 的稳定目录 ID。 */
  readonly task_id: string;
}): Promise<TaskRunHistoryItemView[]> {
  const task_directory = getTaskDir(params.storage.path, params.task_id);
  const entries = await params.storage.files.read_directory(task_directory).catch(() => []);
  const timestamps = entries
    .filter((entry) => entry.is_directory && is_task_run_timestamp(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const runs = await Promise.all(timestamps.map((timestamp) => read_task_run_summary({
    ...params,
    timestamp,
  })));
  return runs.filter((run): run is TaskRunHistoryItemView => Boolean(run));
}

/** 读取一条 Task Run 的摘要与用户可见产物。 */
export async function read_task_run_detail(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** Task 的稳定目录 ID。 */
  readonly task_id: string;
  /** Run 目录使用的稳定 UTC 时间戳。 */
  readonly timestamp: string;
}): Promise<TaskRunDetailView> {
  const summary = await read_task_run_summary(params);
  if (!summary) throw new Error(`Task run not found: ${params.timestamp}`);
  const run_directory = getTaskRunDir(params.storage.path, params.task_id, params.timestamp);
  const meta = await read_json_object(params.storage, path.join(run_directory, "run.json"));
  const [output, error_detail] = await Promise.all([
    read_artifact(params.storage, path.join(run_directory, "output.md"), "# Task Output"),
    read_artifact(params.storage, path.join(run_directory, "error.md"), "# Task Error"),
  ]);
  return {
    ...summary,
    output,
    error_detail,
    result_errors: read_string_array(meta?.resultErrors),
    ...(typeof meta?.dialogueRounds === "number" ? { dialogue_rounds: meta.dialogueRounds } : {}),
  };
}

/** 从完成元数据或运行进度生成一条历史摘要。 */
async function read_task_run_summary(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** Task 的稳定目录 ID。 */
  readonly task_id: string;
  /** Run 目录使用的稳定 UTC 时间戳。 */
  readonly timestamp: string;
}): Promise<TaskRunHistoryItemView | undefined> {
  const run_directory = getTaskRunDir(params.storage.path, params.task_id, params.timestamp);
  const [meta, progress] = await Promise.all([
    read_json_object(params.storage, path.join(run_directory, "run.json")),
    read_json_object(params.storage, path.join(run_directory, "run-progress.json")),
  ]);
  if (meta) return completed_summary(params.timestamp, meta);
  if (progress) return progress_summary(params.timestamp, progress);
  return undefined;
}

/** 将已完成的 run.json 投影为稳定摘要。 */
function completed_summary(timestamp: string, meta: Record<string, unknown>): TaskRunHistoryItemView | undefined {
  const started_at = read_number(meta.startedAt);
  const ended_at = read_number(meta.endedAt);
  const status = read_run_status(meta.status);
  const trigger = read_trigger(meta.trigger);
  if (started_at === undefined || ended_at === undefined || !status || !trigger) return undefined;
  const execution_id = read_string(meta.executionId);
  const execution_status = read_execution_status(meta.executionStatus);
  const result_status = read_result_status(meta.resultStatus);
  const error = read_string(meta.error);
  return {
    timestamp,
    ...(execution_id ? { execution_id } : {}),
    status,
    trigger,
    started_at,
    updated_at: ended_at,
    ended_at,
    duration_ms: Math.max(0, ended_at - started_at),
    ...(execution_status ? { execution_status } : {}),
    ...(result_status ? { result_status } : {}),
    ...(error ? { error } : {}),
  };
}

/** 将尚未完成或异常中断的 run-progress.json 投影为稳定摘要。 */
function progress_summary(timestamp: string, progress: Record<string, unknown>): TaskRunHistoryItemView | undefined {
  const started_at = read_number(progress.startedAt);
  const updated_at = read_number(progress.updated_at);
  const progress_status = read_string(progress.status);
  const trigger = read_trigger(progress.trigger);
  if (started_at === undefined || updated_at === undefined || !trigger) return undefined;
  const status = progress_status === "running"
    ? "running"
    : progress_status === "success" || progress_status === "failure"
      ? progress_status
      : undefined;
  if (!status) return undefined;
  const execution_id = read_string(progress.execution_id);
  const ended_at = read_number(progress.endedAt);
  const phase = read_string(progress.phase);
  const message = read_string(progress.message);
  const execution_status = read_execution_status(progress.executionStatus);
  const result_status = read_result_status(progress.resultStatus);
  return {
    timestamp,
    ...(execution_id ? { execution_id } : {}),
    status,
    trigger,
    started_at,
    updated_at,
    ...(ended_at !== undefined ? { ended_at, duration_ms: Math.max(0, ended_at - started_at) } : {}),
    ...(phase ? { phase } : {}),
    ...(message ? { message } : {}),
    ...(execution_status ? { execution_status } : {}),
    ...(result_status ? { result_status } : {}),
  };
}

/** 安全读取一个 JSON object；损坏文件由调用方按缺失记录处理。 */
async function read_json_object(
  storage: PluginStorage,
  file_path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse((await storage.files.read_file(file_path)).toString("utf-8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/** 读取有限大小的用户可见产物，避免单次 JSON action 无界膨胀。 */
async function read_artifact(
  storage: PluginStorage,
  file_path: string,
  heading: string,
): Promise<string> {
  try {
    const bytes = await storage.files.read_file(file_path);
    const bounded = bytes.byteLength <= MAX_ARTIFACT_BYTES
      ? bytes
      : bytes.subarray(0, MAX_ARTIFACT_BYTES);
    const raw_content = bounded.toString("utf-8");
    const content = raw_content.startsWith(`${heading}\n`)
      ? raw_content.slice(heading.length).trimStart().trimEnd()
      : raw_content;
    return bytes.byteLength <= MAX_ARTIFACT_BYTES
      ? content
      : `${content}\n\n[内容过长，已截断]`;
  } catch {
    return "";
  }
}

/** 读取一个非空字符串。 */
function read_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 读取一个有限数字。 */
function read_number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读取 Task Run 的最终状态。 */
function read_run_status(value: unknown): ShipTaskRunStatusV1 | undefined {
  return value === "success" || value === "failure" || value === "skipped" ? value : undefined;
}

/** 读取 Task Run 的执行阶段状态。 */
function read_execution_status(value: unknown): ShipTaskRunExecutionStatusV1 | undefined {
  return value === "success" || value === "failure" || value === "skipped" ? value : undefined;
}

/** 读取 Task Run 的结果校验状态。 */
function read_result_status(value: unknown): ShipTaskRunResultStatusV1 | undefined {
  return value === "valid" || value === "invalid" || value === "not_checked" ? value : undefined;
}

/** 读取 Task Run 的触发来源。 */
function read_trigger(value: unknown): ShipTaskRunTriggerV1["type"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const trigger_type = (value as Record<string, unknown>).type;
  return trigger_type === "manual" || trigger_type === "cron" || trigger_type === "time"
    ? trigger_type
    : undefined;
}

/** 读取字符串数组并丢弃损坏成员。 */
function read_string_array(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
