/**
 * 持久日志的异常白名单投影。
 *
 * 不输出 message、stack、SQL、路径或 Provider 原始字段；仅复制固定分类及有界原因树。
 * 允许从 Error.message 精确匹配已知领域代码，绝不按前缀放行任意异常消息。
 */
import type { SafeErrorDiagnostic } from "@/types/agent/SafeErrorDiagnostic.js";

const error_names = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError",
  "AggregateError", "AbortError", "DataCloneError", "AgentSessionCommitError", "ModelStreamFailure", "ModelResponseCommitFailure",
  "ResultSaveFailure", "SessionFailure", "AgentSessionStorageError", "CompletionPersistenceError",
]);
const error_codes = new Set([
  "ERR_WORKER_OUT_OF_MEMORY", "ERR_WORKER_INIT_FAILED", "ERR_WORKER_NOT_RUNNING",
  "ERR_WORKER_UNSERIALIZABLE_ERROR", "ERR_WORKER_INVALID_EXEC_ARGV", "ERR_DLOPEN_FAILED",
  "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_SQLITE_ERROR", "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE", "ERR_MISSING_ARGS", "ERR_OPERATION_FAILED", "ERR_DATA_CLONE_ERROR",
  "ENOMEM", "ENOSPC", "EIO", "EACCES", "EPERM", "ENOENT",
  "provider_error", "provider_timeout", "authentication_failed", "permission_denied",
  "model_unavailable", "rate_limited", "invalid_request", "context_length_exceeded",
  "content_rejected", "transport_error", "internal_error", "cancelled",
  "session_storage_unknown", "session_storage_not_committed",
  "session_storage_read_failed", "session_storage_outcome_unknown", "session_storage_worker_unavailable",
  "session_storage_busy", "session_storage_locked", "session_storage_readonly", "session_storage_io_failed",
  "session_storage_corrupt", "session_storage_full", "session_storage_open_failed",
  "session_storage_constraint_failed", "session_storage_not_database", "session_storage_transaction_failed",
  "session_storage_not_found", "session_storage_closed", "session_storage_backpressure",
  "session_storage_queue_timeout", "session_storage_cancelled", "session_storage_projection_unavailable",
]);
const failure_phases = new Set([
  "abort_step", "show_model_error", "advance_context", "cancel_children", "flush_inputs",
  "turn_finalize", "dispose_context", "prepare", "execute", "delivery", "record_retry", "retry_scan", "cancel",
]);

/** 白名单异常树，循环与深度限制保证日志始终可序列化。 */
export function safe_error_diagnostic(error: unknown): SafeErrorDiagnostic {
  try { return project_error(error, 0, new Set(), [64]); }
  catch { return { name: "UnknownError" }; }
}

/** 仅访问固定白名单字段；异常 getter 或非法聚合值由外层丢弃。 */
function project_error(error: unknown, depth: number, seen: Set<unknown>, budget: number[]): SafeErrorDiagnostic {
  if (--budget[0] < 0 || depth >= 6 || seen.has(error)) return { name: "UnknownError", truncated: true };
  if (!(error instanceof Error)) return { name: "UnknownError" };
  seen.add(error);
  const name = error_names.has(error.name) ? error.name : "UnknownError";
  const record = error as Error & Record<string, unknown>;
  const candidate = typeof record.code === "string" ? record.code : error.message;
  const code = error_codes.has(candidate) ? candidate : undefined;
  const phase = typeof record.phase === "string" && failure_phases.has(record.phase) ? record.phase : undefined;
  const sqlite_code = typeof record.sqlite_code === "number" && Number.isSafeInteger(record.sqlite_code)
    && record.sqlite_code > 0 && record.sqlite_code <= 0x7fffffff ? record.sqlite_code : undefined;
  const diagnostic: SafeErrorDiagnostic = { name, ...(code ? { code } : {}), ...(phase ? { phase } : {}),
    ...(sqlite_code ? { sqlite_code } : {}) };
  if (error.cause !== undefined) diagnostic.cause = project_error(error.cause, depth + 1, seen, budget);
  if (record.secondary_error !== undefined) diagnostic.secondary_error = project_error(record.secondary_error, depth + 1, seen, budget);
  if (error instanceof AggregateError) {
    diagnostic.errors = error.errors.slice(0, 8).map(item => project_error(item, depth + 1, seen, budget));
    if (error.errors.length > 8) diagnostic.truncated = true;
  }
  seen.delete(error);
  return diagnostic;
}
