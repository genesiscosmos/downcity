/**
 * Agent附件维护协调：运行时DB连接持SHARED租约，显式离线清理持EXCLUSIVE租约。
 * 独立DELETE-journal协调库不承载业务事实；只读获取不创建文件，缺失协调描述明确拒绝。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash as create_hash } from "node:crypto";

/** 普通目录/文件校验，不允许协调路径通过链接借用其他Agent的锁。 */
function ordinary(file_path: string, directory = false): void {
  const stat = fs.lstatSync(file_path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink !== 1)) throw new Error("session_attachment_path_invalid");
}

/** 连接持有附件访问边界；业务DB必须先关，再释放文件访问租约。 */
export class AgentSessionFileLease {
  private connection: DatabaseSync | undefined;
  private constructor(connection: DatabaseSync) { this.connection = connection; }

  /** create仅用于已校验的写初始化/正式迁移，浏览不得初始化协调文件。 */
  static acquire(database_path: string, agent_id: string, exclusive = false, create = false): AgentSessionFileLease {
    const agent_path = path.dirname(database_path);
    ordinary(agent_path, true);
    const canonical = fs.realpathSync(agent_path);
    const lease_path = path.join(canonical, "session-files.lease.db");
    const identity = create_hash("sha256").update(canonical).update("\0").update(agent_id).digest("hex");
    let exists = true;
    try { ordinary(lease_path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    if (!exists && !create) throw new Error("session_attachment_coordination_required");
    const connection = new DatabaseSync(lease_path, { readOnly: exists && !exclusive && !create });
    try {
      connection.exec("PRAGMA busy_timeout=0;");
      const uninitialized = !connection.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
      if (uninitialized && !create) throw new Error("session_attachment_coordination_required");
      if (!exists || (create && uninitialized)) {
        connection.exec("BEGIN EXCLUSIVE; CREATE TABLE file_lease (identity TEXT PRIMARY KEY) STRICT;");
        connection.prepare("INSERT INTO file_lease VALUES (?)").run(identity);
        connection.exec("COMMIT;");
        fs.chmodSync(lease_path, 0o600);
      }
      if (connection.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") throw new Error("session_attachment_coordination_invalid");
      connection.exec(exclusive ? "BEGIN EXCLUSIVE;" : "BEGIN;");
      const rows = connection.prepare("SELECT identity FROM file_lease").all();
      if (rows.length !== 1 || rows[0]!.identity !== identity) throw new Error("session_attachment_identity_conflict");
      return new AgentSessionFileLease(connection);
    } catch (error) {
      connection.close();
      const sqlite_code = (error as { /** SQLite扩展错误码。 */ errcode?: number }).errcode;
      if (typeof sqlite_code === "number" && [5, 6].includes(sqlite_code & 0xff)) throw new Error("session_attachments_in_use");
      throw error;
    }
  }

  release(): void { this.connection?.close(); this.connection = undefined; }
}
