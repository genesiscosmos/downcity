/** 归档部分成功/确认未知的可恢复句柄；不输出正文或推测业务回滚。 */
import type { AgentArchivePlan } from "@/types/store/AgentArchivePlan.js";

/** 宿主可在同一Agent上用原operation_id/root_storage_id继续固定计划。 */
export class SessionArchiveOperationError extends Error {
  readonly code = "session_archive_incomplete";
  /** 原根记录UUID，未成功prepare时使用请求提供值。 */
  readonly root_storage_id?: string;
  /** 已确认持久化计划的SHA-256。 */
  readonly plan_fingerprint?: string;
  constructor(readonly operation_id: string, cause: unknown, plan?: AgentArchivePlan, root_storage_id?: string) {
    super(`session_archive_incomplete: resume operation_id=${operation_id}; ${cause instanceof Error ? cause.message : "archive failed"}`, { cause });
    this.root_storage_id = plan?.root_storage_id ?? root_storage_id;
    this.plan_fingerprint = plan?.fingerprint;
  }
}
