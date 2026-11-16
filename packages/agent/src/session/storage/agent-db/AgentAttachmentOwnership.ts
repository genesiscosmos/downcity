/** 附件删除的所属证据：框架保留命名空间，或正式迁移登记的精确相对文件清单。 */
import fs from "node:fs";
import path from "node:path";

export const ATTACHMENT_OWNERSHIP_FILE = ".owned-attachments.json";

/** 读取有界私有清单；缺失清单不允许按普通文件名猜测所属。 */
export function attachment_owned_files(record_path: string, agent_id: string, session_id: string, max_entries: number): Set<string> {
  const manifest_path = path.join(record_path, ATTACHMENT_OWNERSHIP_FILE);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(manifest_path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024 || (stat.mode & 0o077)
    || fs.realpathSync(manifest_path) !== manifest_path) throw new Error("session_attachment_ownership_invalid");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8")); } catch { throw new Error("session_attachment_ownership_invalid"); }
  if (!manifest || Object.keys(manifest).sort().join(",") !== "agent_id,files,format_version,session_id" || manifest.format_version !== 2
    || manifest.agent_id !== agent_id || manifest.session_id !== session_id || !Array.isArray(manifest.files) || manifest.files.length > max_entries) throw new Error("session_attachment_ownership_invalid");
  const files = new Set<string>();
  for (const relative of manifest.files) {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\0")
      || relative.split(/[\\/]/u).some(part => !part || part === "." || part === "..") || files.has(relative)) throw new Error("session_attachment_ownership_invalid");
    files.add(relative);
  }
  return files;
}

/** 运行时只在附件根创建该保留命名空间，普通手工文件不会因处于attachments目录就被承认。 */
export function generated_attachment_name(relative: string): boolean {
  return /^att_[A-Za-z0-9_-]{16}\.[a-z0-9]{1,10}$/u.test(relative);
}
