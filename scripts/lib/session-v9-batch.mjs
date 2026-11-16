/**
 * v9 批次的耐久文件边界。每个数据库先通过 SQLite backup 制作含 WAL 的一致性副本，
 * 全部目标验证完成后才发布；根 migrating 标记让宿主在跨文件中间态拒绝访问。
 * 原始副本永不覆盖；重入只接受原指纹或已规划目标指纹，业务写入后拒绝恢复。
 */
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID as random_uuid } from "node:crypto";
import { digest, fail } from "./session-v7-database.mjs";
import { attachment_inventory, copy_attachments, copy_verified_file, exists, file_hash, inside, ordinary, save_json, sync_path } from "./session-v8-files.mjs";
import { fingerprint_file, open_source } from "./session-v9-database.mjs";
import { audit_directory } from "./session-v9-recovery.mjs";

/** 原始/暂存路径均在私有批次内，不能由来源内容控制绝对路径。 */
export function batch_file(batch_path, area, item) { return path.join(batch_path, area, `${item.key}.${item.kind === "database" ? "db" : "data"}`); }

/** 清单更新持久化到 rename 边界，崩溃后无需猜测哪个步骤完成。 */
export function save_manifest(batch_path, manifest) { save_json(path.join(batch_path, "manifest.json"), manifest, true); }

/** 结构化工件；清单不包含文件正文或数据库消息。 */
export function artifact(kind, relative_path, source_fingerprint, target_relative = relative_path) {
  return { kind, relative_path, target_relative, source_fingerprint, key: digest([kind, relative_path]) };
}

/** 目录转换仅重命名，指纹绑定附件及其他普通文件；所有权清单单独备份和转换。 */
export function directory_fingerprint(file_path) {
  return digest(attachment_inventory(file_path).filter(item => item.relative_path !== ".owned-attachments.json"));
}

/** 发布时目录尚未重命名；最终验证时文件引用跟随其唯一所属目录。 */
export function final_relative(item, directories) {
  const directory = directories.find(entry => item.target_relative.startsWith(`${entry.relative_path}${path.sep}`));
  return directory ? directory.target_relative + item.target_relative.slice(directory.relative_path.length) : item.target_relative;
}

/** 只读或已停止写者条件下的完整工件摘要。 */
export function current_fingerprint(file_path, kind) {
  return kind === "database" ? fingerprint_file(file_path) : kind === "directory" ? directory_fingerprint(file_path) : file_hash(file_path);
}

/** 可重入的一致性备份；中断产生的 pending 文件不被当作成功备份。 */
export async function backup_artifact(root_path, batch_path, item) {
  const source_path = inside(root_path, item.relative_path);
  const backup_path = batch_file(batch_path, "original", item);
  fs.mkdirSync(path.dirname(backup_path), { recursive: true, mode: 0o700 });
  if (exists(backup_path)) {
    if (item.kind === "directory" && current_fingerprint(backup_path, item.kind) !== item.source_fingerprint) {
      if (current_fingerprint(source_path, item.kind) !== item.source_fingerprint) fail("source_changed_since_preflight");
      copy_attachments(source_path, backup_path, attachment_inventory(source_path));
    }
    const fingerprint = current_fingerprint(backup_path, item.kind);
    if (fingerprint !== item.source_fingerprint) fail("original_backup_changed");
    return;
  }
  if (current_fingerprint(source_path, item.kind) !== item.source_fingerprint) fail("source_changed_since_preflight");
  if (item.kind === "directory") {
    copy_attachments(source_path, backup_path, attachment_inventory(source_path));
  } else if (item.kind === "database") {
    const source = open_source(source_path);
    const pending = `${backup_path}.pending`;
    try {
      if (exists(pending)) fs.unlinkSync(pending);
      await backup(source, pending);
      fs.chmodSync(pending, 0o600);
      if (fingerprint_file(pending) !== item.source_fingerprint) fail("backup_snapshot_mismatch");
      sync_path(pending); fs.renameSync(pending, backup_path);
    } finally { source.close(); }
  } else {
    copy_verified_file(source_path, backup_path, item.source_fingerprint, path.join(batch_path, "original-pending"));
  }
  if (current_fingerprint(backup_path, item.kind) !== item.source_fingerprint) fail("backup_snapshot_mismatch");
  sync_path(path.dirname(backup_path));
}

/** 单文件原子替换，保留原始副本；不把大数据库先读成 Buffer。 */
function install_file(source_path, target_path) {
  ordinary(source_path); ordinary(path.dirname(target_path), true);
  const pending = path.join(path.dirname(target_path), `.session-v9-${random_uuid()}.pending`);
  try {
    fs.copyFileSync(source_path, pending, fs.constants.COPYFILE_EXCL); fs.chmodSync(pending, 0o600);
    sync_path(pending); fs.renameSync(pending, target_path); sync_path(path.dirname(target_path));
  } finally { if (exists(pending)) fs.unlinkSync(pending); }
}

/** 业务 DB 替换前先排空 WAL；源内容已通过完整备份和指纹核验。 */
function checkpoint(database_path) {
  const database = new DatabaseSync(database_path);
  try {
    database.exec("PRAGMA busy_timeout=0;");
    const result = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (result.busy) fail("database_locked");
    database.exec("BEGIN EXCLUSIVE; COMMIT;");
  } finally { database.close(); }
}

/** 同一路径已是目标时只核验；不同路径的尾部删除也可以在崩溃后继续。 */
export function publish_file(root_path, batch_path, item) {
  const source_path = inside(root_path, item.relative_path);
  const target_path = inside(root_path, item.target_relative);
  const staged = batch_file(batch_path, "staged", item);
  if (item.target_relative.startsWith(`${audit_directory}${path.sep}`)) {
    // 审计目录逐层拒绝链接，不能因递归 mkdir 跟随预置路径跳出所属根。
    let parent = root_path;
    for (const segment of path.dirname(item.target_relative).split(path.sep)) {
      parent = path.join(parent, segment);
      if (exists(parent)) ordinary(parent, true); else { fs.mkdirSync(parent, { mode: 0o700 }); sync_path(path.dirname(parent)); }
    }
  }
  if (current_fingerprint(staged, item.kind) !== item.target_fingerprint) fail("staged_target_changed");
  if (exists(target_path) && current_fingerprint(target_path, item.kind) === item.target_fingerprint) {
    if (source_path !== target_path && exists(source_path)) {
      if (current_fingerprint(source_path, item.kind) !== item.source_fingerprint) fail("source_changed_during_publish");
      fs.unlinkSync(source_path); sync_path(path.dirname(source_path));
    }
    return;
  }
  if (source_path !== target_path && exists(target_path)) fail("target_path_occupied");
  if (!exists(source_path) || current_fingerprint(source_path, item.kind) !== item.source_fingerprint) fail("source_changed_during_publish");
  if (item.kind === "database") checkpoint(source_path);
  install_file(staged, target_path);
  if (source_path !== target_path) { fs.unlinkSync(source_path); sync_path(path.dirname(source_path)); }
}

/** 同路径附件仅核验；有明确路径变化时使用同卷 rename，保留文件与媒体版本。 */
export function publish_directory(root_path, item) {
  const source_path = inside(root_path, item.relative_path); const target_path = inside(root_path, item.target_relative);
  if (source_path === target_path) {
    if (!exists(source_path) || directory_fingerprint(source_path) !== item.source_fingerprint) fail("attachments_changed");
    return;
  }
  if (exists(target_path)) {
    if (exists(source_path) || directory_fingerprint(target_path) !== item.source_fingerprint) fail("attachment_directory_conflict");
    return;
  }
  if (directory_fingerprint(source_path) !== item.source_fingerprint) fail("attachments_changed");
  fs.renameSync(source_path, target_path); sync_path(path.dirname(source_path));
}

/** 恢复由调用方先做全批校验；文件顺序逆转，目录先移回才能恢复所属清单。 */
export function restore_artifact(root_path, batch_path, item) {
  if (item.kind === "directory") {
    const source = inside(root_path, item.target_relative); const target = inside(root_path, item.relative_path);
    if (source === target) {
      if (!exists(source) || directory_fingerprint(source) !== item.source_fingerprint) fail("target_changed_during_restore");
      return;
    }
    if (exists(source)) { if (exists(target)) fail("restore_target_occupied"); fs.renameSync(source, target); sync_path(path.dirname(target)); }
    return;
  }
  const target = inside(root_path, item.relative_path); const published = inside(root_path, item.target_relative);
  if (item.kind === "database" && exists(published)) checkpoint(published);
  install_file(batch_file(batch_path, "original", item), target);
  if (target !== published && exists(published)) fs.unlinkSync(published);
  sync_path(path.dirname(target));
}
