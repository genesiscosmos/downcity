/**
 * v10→v11 单库离线副本转换入口，复用整根迁移的正式校验与内容保留证明。
 * 不替换源库、不修改根标记、不启动宿主；整根恢复使用 migrate-session-sqlite-v11.mjs。
 * 用法：node scripts/migrate-session-current-error.mjs source.sqlite target.sqlite agent_id
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { load_runtime } from "./lib/session-runtime.mjs";
import { load_runtime as load_historical } from "./lib/session-v10-runtime.mjs";
import { convert_database } from "./lib/session-v11-conversion.mjs";
import { exists, ordinary, sync_path } from "./lib/session-v8-files.mjs";

const [source_argument, target_argument, agent_id, ...extra] = process.argv.slice(2);
if (!source_argument || !target_argument || !agent_id || extra.length) throw new Error("Usage: migrate-session-current-error.mjs source.sqlite target.sqlite agent_id");
const source_path = path.resolve(source_argument);
const target_path = path.resolve(target_argument);
if (source_path === target_path || exists(target_path)) throw new Error("Target must be a new database file");
ordinary(path.dirname(target_path), true);
const stage_path = `${target_path}.${random_uuid()}.stage`;
try {
  const proof = await convert_database(source_path, stage_path, agent_id, await load_historical(), await load_runtime(true));
  sync_path(stage_path); fs.linkSync(stage_path, target_path); fs.unlinkSync(stage_path); sync_path(path.dirname(target_path));
  console.log(JSON.stringify({ source: source_path, target: target_path, schema_version: 11, content_sha256: proof.content_sha256 }));
} finally {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${stage_path}${suffix}`, { force: true });
}
