/** 离线转换收件箱的旧会话目标，按当前 NotificationStore 校验整份数据后原子发布。 */
import fs from "node:fs";
import path from "node:path";
import { LocalFileSystem } from "../packages/city/bin/workspace/LocalFileSystem.js";
import { RootLease, resolve_resource_root } from "../packages/city/bin/local/resources/RootLease.js";
import { NotificationStore } from "../packages/implementations/powers/bin/notification/NotificationStore.js";
import { diagnostic, ordinary, sync_path } from "./lib/session-v8-files.mjs";

/** 只解释旧 agent_session 目标里的两个已知字段，混用新旧字段时拒绝覆盖。 */
function convert_target(target) {
  if (target?.kind !== "agent_session" || (!Object.hasOwn(target, "category") && !Object.hasOwn(target, "origin_type"))) return target;
  const { category: type, origin_type, ...identity } = target;
  if ("type" in identity || "session_kind" in identity) throw new Error("mixed_notification_target_fields");
  return { ...identity, type, session_kind: type === "chat" && origin_type === "agent" ? "main" : origin_type };
}

async function migrate(root_path, backup_path) {
  const powers_path = path.join(root_path, "powers");
  const storage_path = path.join(powers_path, "notification");
  const file_path = path.join(storage_path, "notifications.json");
  const files = new LocalFileSystem({ root_path: storage_path, file_mode: 0o600 });
  const lease = RootLease.acquire_write(root_path);
  try {
    ordinary(powers_path, true);
    ordinary(storage_path, true);
    return await files.with_file_lock("notifications.lock", async () => {
      ordinary(file_path);
      const original = fs.readFileSync(file_path);
      const items = JSON.parse(original.toString("utf8"));
      if (!Array.isArray(items)) throw new Error("invalid_notification_records");
      let converted = 0;
      const rows = items.map((item) => {
        const target = convert_target(item.target);
        if (target === item.target) return item;
        converted++;
        return { ...item, target };
      });
      const staged = Buffer.from(JSON.stringify(rows));
      const candidate = new NotificationStore({ files: { path_exists: async () => true, read_file: async () => staged } });
      await candidate.list();
      if (!converted) return { records: rows.length, converted };

      // 备份原始字节并同步后才覆盖，整份文件可用于停写恢复。
      fs.mkdirSync(backup_path, { mode: 0o700 });
      const backup_file = path.join(backup_path, "notifications.json");
      fs.writeFileSync(backup_file, original, { flag: "wx", mode: 0o600 });
      sync_path(backup_file);
      sync_path(backup_path);
      sync_path(path.dirname(backup_path));
      await files.write_file_atomically("notifications.json", staged);
      await new NotificationStore({ files }).list();
      return { records: rows.length, converted, backup_file };
    });
  } finally { lease.release(); }
}

try {
  const [root_input, backup_input, ...extra] = process.argv.slice(2);
  if (!root_input || !backup_input || extra.length !== 1 || extra[0] !== "--writers-stopped") throw new Error("usage: migrate-notification-targets.mjs DATA_ROOT NEW_BACKUP_DIRECTORY --writers-stopped");
  const root_path = fs.realpathSync(root_input);
  const backup_path = resolve_resource_root(backup_input);
  if (backup_path === root_path || backup_path.startsWith(`${root_path}${path.sep}`)) throw new Error("backup_must_be_outside_data_root");
  console.log(JSON.stringify(await migrate(root_path, backup_path)));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) }));
  process.exitCode = 1;
}
