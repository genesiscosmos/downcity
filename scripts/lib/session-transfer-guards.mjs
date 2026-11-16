/**
 * v9 单记录转移的身份与操作边界。扫描同根其他 Agent 时只开已存在的只读库，
 * 不初始化、不跨 Agent 解析来源；永久 UUID、退休身份与历史操作均不能被导入接管。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { digest, fail } from "./session-v7-database.mjs";
import { schema_descriptor } from "./session-v9-database.mjs";
import { exists, ordinary } from "./session-v8-files.mjs";

/** 正式 DDL、版本和 Agent 所属均需匹配；禁止仅改 user_version 的库进入转移。 */
export function assert_transfer_database(database, agent_id, runtime) {
  runtime.assert_agent_session_schema(database, agent_id);
  const expected = new DatabaseSync(":memory:");
  try {
    expected.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    const normalized = db => schema_descriptor(db).map(row => ({ ...row, sql: row.sql?.replace(/\s+/gu, " ").trim() }));
    if (digest(normalized(database)) !== digest(normalized(expected))) fail("transfer_schema_definition_mismatch");
  } finally { expected.close(); }
}

/** 旧操作审计、归档操作或其他业务 receipt 不允许复用为本次转移。 */
export function assert_operation(database, operation_id, allow_receipt = false) {
  if (database.prepare("SELECT 1 FROM legacy_operation_ids WHERE operation_id=?").get(operation_id)
    || database.prepare("SELECT 1 FROM archive_operations WHERE operation_id=?").get(operation_id)
    || (!allow_receipt && database.prepare("SELECT 1 FROM operation_receipts WHERE operation_id=?").get(operation_id))) fail("transfer_operation_conflict");
}

/** 包不携带归档计划，参与尚未完成计划的任何节点都不可单独导出。 */
export function assert_no_pending_archive(database, session_id) {
  if (database.prepare(`SELECT 1 FROM archive_operations AS operation
    WHERE operation.completed_at IS NULL AND (operation.root_session_id=? OR EXISTS
      (SELECT 1 FROM archive_operation_nodes AS node WHERE node.operation_id=operation.operation_id AND node.session_id=?)) LIMIT 1`)
    .get(session_id, session_id)) fail("transfer_pending_archive_conflict");
}

/** 同库活记录、退休/待清理/历史身份和创建键占用均不能被新导入复活。 */
export function assert_available(database, session_id) {
  if (database.prepare("SELECT 1 FROM sessions WHERE session_id=?").get(session_id)) fail("transfer_session_id_conflict");
  for (const table of ["retired_session_ids", "attachment_cleanup", "operation_receipts", "archive_operation_nodes", "session_creation_keys"]) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE session_id=? LIMIT 1`).get(session_id)) fail("transfer_historical_identity_conflict");
  }
  if (database.prepare("SELECT 1 FROM archive_operations WHERE root_session_id=? LIMIT 1").get(session_id)) fail("transfer_historical_identity_conflict");
}

/** 导出只承认源记录所属附件；旧无清单记录仅接受运行时保留的生成文件名。 */
export function assert_attachment_owner(record_path, agent_id, session_id, files) {
  const manifest_path = path.join(record_path, ".owned-attachments.json");
  if (!exists(manifest_path)) {
    if (files.some(file => !/^att_[A-Za-z0-9_-]{16}\.[a-z0-9]{1,10}$/u.test(file.relative_path))) fail("transfer_attachment_ownership_invalid");
    return;
  }
  const stat = ordinary(manifest_path);
  if (stat.mode & 0o077 || stat.size > 2 * 1024 * 1024) fail("transfer_attachment_ownership_invalid");
  const value = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  if (Object.keys(value).sort().join(",") !== "agent_id,files,format_version,session_id" || value.format_version !== 2
    || value.agent_id !== agent_id || value.session_id !== session_id || !Array.isArray(value.files)
    || value.files.length !== new Set(value.files).size || value.files.length !== files.length
    || files.some(file => !value.files.includes(file.relative_path))) fail("transfer_attachment_ownership_invalid");
}

/** 根租约持有期间检查所有其他 Agent 的 UUID 与历史占用，避免跨拥有者重复。 */
export function assert_root_identity(root_path, agent_id, session_id, runtime) {
  const agents_path = path.join(root_path, "agents"); ordinary(agents_path, true);
  for (const entry of fs.readdirSync(agents_path, { withFileTypes: true })) {
    if (entry.name === agent_id) continue;
    const agent_path = path.join(agents_path, entry.name); ordinary(agent_path, true);
    if (fs.realpathSync(agent_path) !== agent_path) fail("unsafe_storage_path");
    const database_path = path.join(agent_path, "sessions.db");
    if (!exists(database_path)) continue;
    ordinary(database_path);
    const database = new DatabaseSync(database_path, { readOnly: true });
    try {
      database.exec("PRAGMA query_only=ON; BEGIN;");
      assert_transfer_database(database, entry.name, runtime);
      assert_available(database, session_id);
    } finally { database.close(); }
  }
}
