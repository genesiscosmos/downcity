/**
 * @file 将本地旧 Session JSONL 存储一次性迁移为每 Session 一个 session.db。
 *
 * 用法：
 * node scripts/migrate-session-storage-to-sqlite.mjs --dry-run
 * node scripts/migrate-session-storage-to-sqlite.mjs --agent <agent_id>
 * node scripts/migrate-session-storage-to-sqlite.mjs --agent <agent_id> --session <session_id>
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate_session_storage_to_sqlite } from "./lib/session-storage-migration.mjs";

/** 解析显式迁移范围；默认扫描 ~/.downcity。 */
export function parse_arguments(arguments_) {
  const input = {
    root_path: path.join(os.homedir(), ".downcity"),
    dry_run: false,
    agent_id: undefined,
    session_id: undefined,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") input.dry_run = true;
    else if (argument === "--root" && arguments_[index + 1]) input.root_path = arguments_[++index];
    else if (argument === "--agent" && arguments_[index + 1]) input.agent_id = arguments_[++index];
    else if (argument === "--session" && arguments_[index + 1]) input.session_id = arguments_[++index];
    else throw new Error(`未知参数：${String(argument)}`);
  }
  if (input.session_id && !input.agent_id) throw new Error("--session 必须与 --agent 一起使用");
  return input;
}

const current_file_path = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  const result = await migrate_session_storage_to_sqlite(parse_arguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
