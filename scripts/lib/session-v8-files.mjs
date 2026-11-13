/**
 * v8 离线合库的文件边界：严格枚举、附件清单、私有耐久 manifest 和独立副本。
 * 不跟随链接，不遗漏隐藏文件；所有本地附件必须有内容哈希，源文件永远不移动。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash as create_hash, randomUUID as random_uuid } from "node:crypto";
import { fail, digest } from "./session-v7-database.mjs";

/** 路径存在性不能把 EACCES 等访问错误解释为不存在。 */
export function exists(file_path) {
  try { fs.lstatSync(file_path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** 普通文件/目录均拒绝符号链接；数据库与附件也拒绝共享可写硬链接。 */
export function ordinary(file_path, directory = false) {
  const stat = fs.lstatSync(file_path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink !== 1)) fail("unsafe_storage_path");
  return stat;
}

/** 所有相对路径都必须留在预期拥有者内。 */
export function inside(root_path, relative_path) {
  if (typeof relative_path !== "string" || !relative_path || path.isAbsolute(relative_path)) fail("invalid_relative_path");
  const absolute_path = path.resolve(root_path, relative_path);
  if (!absolute_path.startsWith(`${path.resolve(root_path)}${path.sep}`)) fail("path_escapes_owner");
  return absolute_path;
}

/** 流式哈希不把大附件整体载入堆；输出只包含摘要。 */
export function file_hash(file_path) {
  ordinary(file_path);
  const hash = create_hash("sha256");
  const descriptor = fs.openSync(file_path, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) { const length = fs.readSync(descriptor, buffer); if (!length) break; hash.update(buffer.subarray(0, length)); }
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
}

/** 同步文件和父目录，保证 rename 后的批次阶段在崩溃后仍可解释。 */
export function sync_path(file_path) {
  const descriptor = fs.openSync(file_path, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

/** 清单首次排他创建，后续只原子替换本批次拥有的路径。 */
export function save_json(file_path, value, replace = false) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true, mode: 0o700 });
  if (!replace && exists(file_path)) fail("output_already_exists");
  const pending_path = `${file_path}.${random_uuid()}.pending`;
  const descriptor = fs.openSync(pending_path, "wx", 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  try {
    if (replace) fs.renameSync(pending_path, file_path);
    else { fs.linkSync(pending_path, file_path); fs.unlinkSync(pending_path); }
    sync_path(path.dirname(file_path));
  } finally { if (exists(pending_path)) fs.unlinkSync(pending_path); }
}

/** 附件树中的全部普通文件进入清单，空目录不承载 canonical 事实。 */
export function attachment_inventory(directory, prefix = "") {
  if (!exists(directory)) return [];
  ordinary(directory, true);
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const file_path = path.join(directory, entry.name);
    const relative_path = path.join(prefix, entry.name);
    if (entry.isDirectory()) output.push(...attachment_inventory(file_path, relative_path));
    else { const stat = ordinary(file_path); output.push({ relative_path, bytes: stat.size, sha256: file_hash(file_path) }); }
  }
  return output;
}

/** 复制后验证哈希并同步，绝不以硬链接把新旧附件绑定为同一可写文件。 */
export function copy_attachments(source_path, target_path, inventory) {
  if (digest(attachment_inventory(source_path)) !== digest(inventory)) fail("attachments_changed");
  fs.mkdirSync(target_path, { recursive: true, mode: 0o700 });
  const existing = attachment_inventory(target_path);
  for (const item of existing) {
    if (!inventory.some(expected => digest(expected) === digest(item))) fail("attachment_copy_mismatch");
  }
  for (const item of inventory) {
    const target = inside(target_path, item.relative_path);
    if (exists(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(inside(source_path, item.relative_path), target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
    if (file_hash(target) !== item.sha256) fail("attachment_copy_mismatch");
    sync_path(target); sync_path(path.dirname(target));
  }
  sync_path(target_path);
}

/** 严格枚举完整根，包含活动/归档及所有分类；异常项不能被悄悄跳过。 */
export function discover(root_path) {
  ordinary(root_path, true);
  const agents_path = path.join(root_path, "agents");
  if (!exists(agents_path)) return [];
  ordinary(agents_path, true);
  const agents = [];
  for (const agent_entry of fs.readdirSync(agents_path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const agent_path = path.join(agents_path, agent_entry.name);
    ordinary(agent_path, true);
    const sources = [];
    for (const partition of ["sessions", "archived-sessions"]) {
      const partition_path = path.join(agent_path, partition);
      if (!exists(partition_path)) continue;
      ordinary(partition_path, true);
      for (const category_entry of fs.readdirSync(partition_path, { withFileTypes: true })) {
        const category_path = path.join(partition_path, category_entry.name);
        ordinary(category_path, true);
        for (const session_entry of fs.readdirSync(category_path, { withFileTypes: true })) {
          const session_path = path.join(category_path, session_entry.name);
          ordinary(session_path, true);
          const retained_legacy_files = [];
          for (const name of fs.readdirSync(session_path)) {
            if (["session.db", "session.db-wal", "session.db-shm", "attachments"].includes(name)) continue;
            // 旧 Interaction 工具的原始备份不是 canonical；仅登记并原地保留，不作为迁移输入。
            if (!/^session\.db\.interactions-v1\.bak(?:-(?:wal|shm))?$/u.test(name)) fail("unknown_session_files");
            ordinary(path.join(session_path, name)); retained_legacy_files.push(name);
          }
          const database_path = path.join(session_path, "session.db");
          ordinary(database_path);
          sources.push({ agent_id: agent_entry.name, category: decodeURIComponent(category_entry.name), session_id: session_entry.name,
            partition, relative_path: path.relative(root_path, database_path), storage_id: random_uuid(), retained_legacy_files });
        }
      }
    }
    const target_path = path.join(agent_path, "sessions.db");
    if (sources.length || exists(target_path)) agents.push({ agent_id: agent_entry.name, sources: sources.sort((left, right) => left.relative_path.localeCompare(right.relative_path)), target_existed: exists(target_path) });
  }
  return agents;
}

/** 原始 SQLite/codec 诊断可能包含正文，只允许固定的诊断码进入清单。 */
export function diagnostic(error) {
  if (error?.migration_code) return error.migration_code;
  if (/busy|locked/iu.test(String(error?.message))) return "database_locked";
  if (error?.code === "ENOENT") return "storage_file_missing";
  return "operation_failed_details_redacted";
}

/** 正式源可能是经过清单批准的保留归档；备份工作区仍按规范相对地址定位。 */
export function source_database_path(root_path, source, source_root = root_path) {
  return source_root === root_path && source.recovered_from ? source.recovered_from : inside(source_root, source.relative_path);
}

/** 显式恢复来源只接受精确身份、原始指纹与完整附件清单，不自动搜索或批准备份。 */
export function load_recovered_sources(file_path) {
  if (!file_path) return [];
  ordinary(file_path);
  if (fs.statSync(file_path).mode & 0o077) fail("recovered_sources_requires_private_permissions");
  const manifest = JSON.parse(fs.readFileSync(file_path, "utf8"));
  if (manifest.format_version !== 1 || Object.keys(manifest).sort().join(",") !== "format_version,sources" || !Array.isArray(manifest.sources) || !manifest.sources.length) fail("recovered_sources_invalid");
  const identities = new Set(); const files = new Set();
  return manifest.sources.map(entry => {
    if (Object.keys(entry).sort().join(",") !== "agent_id,attachments,category,database_path,session_id,source_fingerprint"
      || ["agent_id", "session_id"].some(name => typeof entry[name] !== "string" || !entry[name] || /[\\/\0]/u.test(entry[name]) || [".", ".."].includes(entry[name]))
      || !["chat", "work"].includes(entry.category) || typeof entry.database_path !== "string" || !path.isAbsolute(entry.database_path)
      || fs.realpathSync(entry.database_path) !== entry.database_path || !/^[a-f0-9]{64}$/u.test(entry.source_fingerprint ?? "") || !Array.isArray(entry.attachments)) fail("recovered_sources_invalid");
    ordinary(entry.database_path);
    const relative_path = path.join("agents", entry.agent_id, "archived-sessions", encodeURIComponent(entry.category), entry.session_id, "session.db");
    if (identities.has(relative_path) || files.has(entry.database_path)) fail("duplicate_recovered_source");
    identities.add(relative_path); files.add(entry.database_path);
    if (digest(attachment_inventory(path.join(path.dirname(entry.database_path), "attachments"))) !== digest(entry.attachments)) fail("recovered_attachments_mismatch");
    return { agent_id: entry.agent_id, session_id: entry.session_id, category: entry.category, partition: "archived-sessions", relative_path,
      recovered_from: entry.database_path, source_fingerprint: entry.source_fingerprint, attachments: entry.attachments };
  });
}
