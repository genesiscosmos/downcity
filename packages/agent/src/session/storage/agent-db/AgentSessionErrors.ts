/** 存储边界的错误分类；仅固定错误码与 SQLite 数字码可以跨 Worker，不复制原始异常。 */
import type { AgentSessionReadCommand, AgentSessionWriteCommand, AgentSessionStorageFailure } from "@/types/store/AgentSessionWorker.js";

/** 主线程重建的安全存储异常，命令来自已派发请求，不包含 SQL 或业务参数。 */
export class AgentSessionStorageError extends Error {
  /** 已派发的语义命令名。 */
  readonly command: AgentSessionReadCommand["command"] | AgentSessionWriteCommand["command"];
  /** SQLite 原始数字错误码，保留 extended code 便于判断失败类型。 */
  readonly sqlite_code?: number;

  constructor(command: AgentSessionStorageError["command"], failure: AgentSessionStorageFailure, cause?: unknown) {
    super(failure.code, { cause });
    this.name = "AgentSessionStorageError";
    this.command = command;
    this.sqlite_code = failure.sqlite_code;
  }
}

/** SQLite 的主错误类别固定，不根据可能包含正文的错误消息进行分类。 */
const sqlite_error_codes: Readonly<Record<number, string>> = {
  5: "session_storage_busy",
  6: "session_storage_locked",
  8: "session_storage_readonly",
  10: "session_storage_io_failed",
  11: "session_storage_corrupt",
  13: "session_storage_full",
  14: "session_storage_open_failed",
  19: "session_storage_constraint_failed",
  26: "session_storage_not_database",
};

/** 领域错误保留短码；SQLite 保留类别与数字，未知异常只暴露固定失败码。 */
export function agent_session_failure(error: unknown): AgentSessionStorageFailure {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  if (/^session_[a-z_]+$/u.test(code)) return { code };
  const sqlite_code = error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && typeof error.errcode === "number" && Number.isSafeInteger(error.errcode)
    && error.errcode > 0 && error.errcode <= 0x7fffffff ? error.errcode : undefined;
  return {
    code: sqlite_code === undefined ? "session_storage_transaction_failed"
      : sqlite_error_codes[sqlite_code & 0xff] ?? "session_storage_transaction_failed",
    ...(sqlite_code === undefined ? {} : { sqlite_code }),
  };
}
