/** 精确UUID的附件目录删除：先有界校验整棵所属树，再后序删除；不跟随链接。 */
import { ATTACHMENT_OWNERSHIP_FILE, attachment_owned_files, generated_attachment_name } from "./AgentAttachmentOwnership.js";
import fs from "node:fs";
import path from "node:path";

/** 不存在可幂等处理，其余权限/IO错误不能当成已不存在。 */
export function attachment_stat(file_path: string): fs.Stats | undefined {
  try { return fs.lstatSync(file_path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}

/** 维护根必须为规范普通目录，不允许根自身或其中路径段通过符号链接越界。 */
export function assert_attachment_directory(directory: string): boolean {
  const stat = attachment_stat(directory);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error("session_attachment_path_invalid");
  return true;
}

/** 所属树目录项有上限；用户额外放置的根级文件不会被当成附件一并删除。 */
export function remove_record_attachment_files(agent_path: string, agent_id: string, session_id: string, max_entries: number): void {
  const files_path = path.join(agent_path, "session-files");
  if (!assert_attachment_directory(files_path)) return;
  const record_path = path.join(files_path, session_id);
  if (!assert_attachment_directory(record_path)) return;
  const root = fs.opendirSync(record_path);
  try {
    for (let entry = root.readSync(); entry; entry = root.readSync()) {
      if (!["attachments", ".session-migration-copies", ATTACHMENT_OWNERSHIP_FILE].includes(entry.name)) throw new Error("session_attachment_unmanaged_files");
    }
  } finally { root.closeSync(); }
  const copy_path = path.join(record_path, ".session-migration-copies");
  if (assert_attachment_directory(copy_path)) {
    const directory = fs.opendirSync(copy_path);
    try { if (directory.readSync()) throw new Error("session_attachment_unmanaged_files"); }
    finally { directory.closeSync(); }
  }
  const owned = attachment_owned_files(record_path, agent_id, session_id, max_entries);
  const owned_directories = new Set<string>();
  for (const file of owned) {
    for (let directory = path.dirname(file); directory !== "."; directory = path.dirname(directory)) owned_directories.add(directory);
  }
  const owner_device = fs.lstatSync(agent_path).dev;
  const pending: string[] = [];
  const tree: Array<readonly [string, fs.Stats]> = [];
  const attachments_path = path.join(record_path, "attachments");
  if (attachment_stat(attachments_path)) pending.push(attachments_path);
  while (pending.length) {
    const item = pending.pop()!;
    const stat = fs.lstatSync(item);
    if (stat.dev !== owner_device || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)
      || fs.realpathSync(item) !== item) throw new Error("session_attachment_path_invalid");
    const relative = path.relative(attachments_path, item);
    if (stat.isFile() && !owned.has(relative) && !generated_attachment_name(relative)) throw new Error("session_attachment_unmanaged_files");
    if (stat.isDirectory() && relative && !owned_directories.has(relative)) throw new Error("session_attachment_unmanaged_files");
    tree.push([item, stat]);
    if (tree.length > max_entries) throw new Error("session_attachment_cleanup_budget_exceeded");
    if (!stat.isDirectory()) continue;
    const directory = fs.opendirSync(item);
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (tree.length + pending.length >= max_entries) throw new Error("session_attachment_cleanup_budget_exceeded");
        pending.push(path.join(item, entry.name));
      }
    } finally { directory.closeSync(); }
  }
  // 再次核验inode与父目录；所有合作写/读者在独占文件租约外，不能与本删除并发。
  for (const [item, expected] of tree.reverse()) {
    assert_attachment_directory(path.dirname(item));
    const actual = fs.lstatSync(item);
    if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.isSymbolicLink() || (actual.isFile() && actual.nlink !== 1)) throw new Error("session_attachment_path_changed");
    if (actual.isDirectory()) fs.rmdirSync(item); else fs.unlinkSync(item);
  }
  if (attachment_stat(copy_path)) fs.rmdirSync(copy_path);
  const manifest_path = path.join(record_path, ATTACHMENT_OWNERSHIP_FILE);
  if (attachment_stat(manifest_path)) fs.unlinkSync(manifest_path);
  fs.rmdirSync(record_path);
  const descriptor = fs.openSync(files_path, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
