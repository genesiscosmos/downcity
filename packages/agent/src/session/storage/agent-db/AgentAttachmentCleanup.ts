/**
 * 显式离线附件维护：只消费结构删除事务已提交的attachment_cleanup日志。
 * 宿主需先取得根独占维护权；本服务再取得Agent文件独占租约，拒绝Browser/导出读者。
 * 文件失败保留日志与attempts，完成删除后才结算日志；从不扫描无日志的UUID。
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assert_agent_session_schema } from "./AgentSessionSchema.js";
import { AgentSessionFileLease } from "./AgentSessionFileLease.js";
import { attachment_stat, assert_attachment_directory, remove_record_attachment_files } from "./AgentAttachmentFiles.js";
import type { AgentAttachmentCleanupInput, AgentAttachmentCleanupResult } from "@/types/store/AgentAttachmentCleanup.js";

/** 不把原始FS路径、SQL或错误正文放入公开结果。 */
function failure_code(error: unknown): string {
  const value = error as NodeJS.ErrnoException;
  if (value.code === "EACCES" || value.code === "EPERM") return "session_attachment_permission_denied";
  if (typeof value.message === "string" && /^session_attachment_[a-z_]+$/u.test(value.message)) return value.message;
  return "session_attachment_io_failed";
}

/** 需显式调用，不从创建、打开、dispose或启动流程自动触发。 */
export function cleanup_agent_session_attachments(input: AgentAttachmentCleanupInput): AgentAttachmentCleanupResult {
  const limit = input.limit ?? 20;
  const max_entries = input.max_entries ?? 10_000;
  if (!input.agent_id.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(max_entries) || max_entries < 1 || max_entries > 100_000) throw new Error("session_attachment_cleanup_input_invalid");
  const agent_path = path.resolve(input.storage_root_path);
  if (!path.isAbsolute(input.storage_root_path) || !assert_attachment_directory(agent_path)) throw new Error("session_attachment_path_invalid");
  const database_path = path.join(agent_path, "sessions.db");
  const stat = attachment_stat(database_path);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("session_attachment_path_invalid");
  // 在初始化协调描述之前先验证业务库身份，不能为未知库创建维护状态。
  const check = new DatabaseSync(database_path, { readOnly: true });
  try { assert_agent_session_schema(check, input.agent_id); } finally { check.close(); }
  const lease = AgentSessionFileLease.acquire(database_path, input.agent_id, true, Boolean(input.prepare_only));
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(database_path, { readOnly: Boolean(input.prepare_only) });
    assert_agent_session_schema(database, input.agent_id);
    const result: AgentAttachmentCleanupResult = { agent_id: input.agent_id, prepared: Boolean(input.prepare_only), completed: [], failed: [], remaining: 0 };
    if (!input.prepare_only) {
      database.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;");
      if (process.platform === "darwin") database.exec("PRAGMA fullfsync=ON; PRAGMA checkpoint_fullfsync=ON;");
      const rows = database.prepare("SELECT session_id FROM attachment_cleanup ORDER BY attempts, requested_at, session_id LIMIT ?").all(limit);
      for (const row of rows) {
        const session_id = String(row.session_id);
        // 尝试登记先提交，不能让后续文件错误回滚结构删除或丢失待清理事实。
        database.prepare("UPDATE attachment_cleanup SET attempts=attempts+1 WHERE session_id=?").run(session_id);
        try {
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(session_id)) throw new Error("session_attachment_identity_invalid");
          if (database.prepare("SELECT 1 FROM sessions WHERE session_id=?").get(session_id)) throw new Error("session_attachment_record_exists");
          remove_record_attachment_files(agent_path, input.agent_id, session_id, max_entries);
          // 独占文件租约仍持有：合作写者不能在文件删除与日志结算间重建该记录。
          const settled = database.prepare("DELETE FROM attachment_cleanup WHERE session_id=? AND NOT EXISTS (SELECT 1 FROM sessions WHERE session_id=?)").run(session_id, session_id);
          if (settled.changes !== 1) throw new Error("session_attachment_log_changed");
          result.completed.push(session_id);
        } catch (error) { result.failed.push({ session_id, code: failure_code(error) }); }
      }
    }
    result.remaining = Number(database.prepare("SELECT COUNT(*) AS count FROM attachment_cleanup").get()!.count);
    return result;
  } finally { database?.close(); lease.release(); }
}
