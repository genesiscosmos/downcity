/**
 * 数据根租约。独立的 DELETE-journal SQLite 文件只承载协调信息。
 * 宿主/离线写持 BEGIN EXCLUSIVE，离线浏览持只读事务的 SHARED 文件锁；
 * 租约不写入业务数据库，进程异常退出后由操作系统释放，不依赖 PID 回收。
 * 只读获取只打开已有描述，既不创建文件，也不修复或迁移它。
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve_local_root_path } from "../runtime/LocalPaths.js";
import { ResourceError, is_missing_file } from "./ResourceError.js";

/** 在不创建目录的前提下解析 root，现有路径通过 realpath 消除别名。 */
export function resolve_resource_root(input?: string): string {
  const root_path = resolve_local_root_path(input);
  try { return fs.realpathSync(root_path); }
  catch (error) {
    if (!is_missing_file(error)) throw error;
    const parent_path = path.dirname(root_path);
    return parent_path === root_path ? root_path : path.join(resolve_resource_root(parent_path), path.basename(root_path));
  }
}

/** root 身份绑定规范路径，不能拿另一目录的管理地址执行请求。 */
export function get_root_identity(root_path: string): string {
  return createHash("sha256").update(resolve_resource_root(root_path)).digest("hex");
}

/** root 是否存在；权限错误向上传递。 */
export function resource_root_exists(root_path: string): boolean {
  try { return fs.statSync(root_path).isDirectory(); }
  catch (error) { if (is_missing_file(error)) return false; throw error; }
}

/** 由数据库连接实际持有的跨进程 root 租约。 */
export class RootLease {
  /** 当前连接；空 root 的只读查询没有创建锁文件。 */
  private database: DatabaseSync | undefined;

  private constructor(database?: DatabaseSync) { this.database = database; }

  /** 获取独占写租约；必须早于任何业务 DB、迁移、装配或恢复执行。 */
  static acquire_write(root_path: string): RootLease {
    // 仍在运行的旧宿主可能尚未持有新租约。先拒绝其登记，不能趁升级并发写入。
    const host_path = path.join(root_path, "runtimes", "city", "host.json");
    try {
      const host = JSON.parse(fs.readFileSync(host_path, "utf8")) as {
        /** 已登记宿主的操作系统进程。 */
        pid?: number;
      };
      if (!Number.isSafeInteger(host.pid) || Number(host.pid) <= 0) throw new ResourceError("coordination_required", "Invalid host descriptor prevents exclusive root access", 5);
      let alive = true;
      try { process.kill(host.pid!, 0); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") alive = false; else throw error; }
      if (alive) throw new ResourceError("host_unreachable", "A City host already owns this root; use its management channel", 5);
    } catch (error) { if (!is_missing_file(error)) throw error; }
    const lease_path = path.join(root_path, "runtimes", "city", "coordination.db");
    fs.mkdirSync(path.dirname(lease_path), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(lease_path);
    try {
      database.exec("PRAGMA busy_timeout = 0;");
      // 此文件从不启用 WAL，EXCLUSIVE 与只读连接的 SHARED 必须互斥。
      const mode = database.prepare("PRAGMA journal_mode;").get();
      if (mode?.journal_mode !== "delete") throw new ResourceError("coordination_required", "Root coordination database must use DELETE journal mode", 5);
      database.exec("BEGIN EXCLUSIVE;");
      database.exec("CREATE TABLE IF NOT EXISTS root_identity (version INTEGER NOT NULL, identity TEXT NOT NULL);");
      const row = database.prepare("SELECT version, identity FROM root_identity;").get();
      const identity = get_root_identity(root_path);
      if (!row) database.prepare("INSERT INTO root_identity VALUES (1, ?);").run(identity);
      else RootLease.validate_identity(row, identity);
      // 初始化在独占区间提交，再立即重取锁；窗口内其他宿主可以获锁，
      // 因此第二次 BEGIN 失败必须退出，不能继续装配。
      database.exec("COMMIT; BEGIN EXCLUSIVE;");
      fs.chmodSync(lease_path, 0o600);
      return new RootLease(database);
    } catch (error) {
      database.close();
      throw RootLease.map_lock_error(error);
    }
  }

  /** 获取共享读取租约；没有协调描述的旧 root 必须先显式启动宿主。 */
  static acquire_read(root_path: string): RootLease {
    if (!resource_root_exists(root_path)) return new RootLease();
    const lease_path = path.join(root_path, "runtimes", "city", "coordination.db");
    try { fs.statSync(lease_path); }
    catch (error) {
      if (!is_missing_file(error)) throw error;
      throw new ResourceError("coordination_required", "Start a supported City host explicitly to prepare this root for offline browsing", 5);
    }
    const database = new DatabaseSync(lease_path, { readOnly: true });
    try {
      database.exec("PRAGMA busy_timeout = 0; BEGIN;");
      const row = database.prepare("SELECT version, identity FROM root_identity;").get();
      RootLease.validate_identity(row, get_root_identity(root_path));
      return new RootLease(database);
    } catch (error) {
      database.close();
      throw RootLease.map_lock_error(error);
    }
  }

  /** 持有连接直至所有业务连接释放；幂等释放，不删除协调文件。 */
  release(): void {
    const database = this.database;
    this.database = undefined;
    database?.close();
  }

  private static validate_identity(row: Record<string, unknown> | undefined, identity: string): void {
    if (row?.version !== 1 || row.identity !== identity) {
      throw new ResourceError("host_identity_mismatch", "Root coordination identity does not match this directory", 5);
    }
  }

  private static map_lock_error(error: unknown): unknown {
    if (error instanceof Error && "errcode" in error && (error.errcode === 5 || error.errcode === 6)) {
      return new ResourceError("host_unreachable", "This root is owned by a host or another resource operation; retry after it is ready", 5, true);
    }
    return error;
  }
}
