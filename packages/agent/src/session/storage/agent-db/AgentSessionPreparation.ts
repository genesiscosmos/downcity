/**
 * 宿主启动的显式会话访问准备。调用方必须已取得存储根独占所有权，
 * 并在开放 Browser、执行器及附件访问之前调用；不创建业务库、不迁移、不清理附件。
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentSessionPreparationInput } from "@/types/store/AgentSessionPreparation.js";
import { attachment_stat, assert_attachment_directory } from "./AgentAttachmentFiles.js";
import { assert_agent_session_schema } from "./AgentSessionSchema.js";
import { AgentSessionFileLease } from "./AgentSessionFileLease.js";

/** 先只读校验业务库身份，再幂等准备协调描述；失败保留原始原因。 */
export function prepare_agent_session_storage(input: AgentSessionPreparationInput): void {
  if (!input.agent_id.trim() || input.agent_id !== input.agent_id.trim()) throw new Error("session_storage_address_invalid");
  if (!path.isAbsolute(input.storage_root_path) || !assert_attachment_directory(input.storage_root_path)) {
    throw new Error("session_attachment_path_invalid");
  }
  const database_path = path.join(input.storage_root_path, "sessions.db");
  const stat = attachment_stat(database_path);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("session_attachment_path_invalid");
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout=250;");
    assert_agent_session_schema(database, input.agent_id);
  } finally { database.close(); }
  AgentSessionFileLease.acquire(database_path, input.agent_id, false, true).release();
}
