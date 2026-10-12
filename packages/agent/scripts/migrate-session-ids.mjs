/**
 * Offline migration of one Agent's local Session IDs to lowercase.
 * Usage: node scripts/migrate-session-ids.mjs <agent-root> [--apply --offline]
 * Preview is the default. Stop Downcity before applying. The complete active and
 * archived Session trees are backed up before writes. Only canonical identity
 * fields and attachment paths are rewritten; message text and opaque IDs remain
 * unchanged. External Power/task/messenger references must be migrated by their
 * owners using the emitted manifest before restarting Downcity.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const root_arg = args.find((value) => !value.startsWith("--"));
if (!root_arg || args.some((value) => value.startsWith("--") && !["--apply", "--offline"].includes(value))) {
  throw new Error("Usage: migrate-session-ids.mjs <agent-root> [--apply --offline]");
}
const root_path = path.resolve(root_arg);
if (!(await fs.stat(root_path)).isDirectory()) throw new Error("Agent root must be an existing directory");
const apply = args.includes("--apply");
if (apply && !args.includes("--offline")) throw new Error("Stop Downcity, then pass --apply --offline");

/** Encode a normalized identity using the same safe directory rules as storage. */
function encode_segment(value) {
  let encoded = [...Buffer.from(value)].map((byte) =>
    (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || [45, 95, 126].includes(byte)
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(encoded)) {
    encoded = `%${encoded.codePointAt(0).toString(16).toUpperCase()}${encoded.slice(1)}`;
  }
  return encoded;
}

/** Return directory entries; an absent archive tree is valid. */
async function read_directories(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const sessions = [];
for (const area of ["sessions", "archived-sessions"]) {
  for (const origin of await read_directories(path.join(root_path, area))) {
    const origin_path = path.join(root_path, area, origin.name);
    const targets = new Set();
    for (const entry of await read_directories(origin_path)) {
      const source_path = path.join(origin_path, entry.name);
      const database_path = path.join(source_path, "session.db");
      await fs.access(database_path);
      const database = new DatabaseSync(database_path, { readOnly: true });
      let row;
      try {
        row = database.prepare("SELECT session_id FROM session_state WHERE singleton_id = 1").get();
      } finally {
        database.close();
      }
      if (!row?.session_id || decodeURIComponent(entry.name) !== row.session_id) {
        throw new Error(`Directory/database identity mismatch: ${source_path}`);
      }
      const session_id = row.session_id.trim().toLowerCase();
      const target_path = path.join(origin_path, encode_segment(session_id));
      if (targets.has(target_path.toLowerCase())) throw new Error(`Case collision: ${target_path}`);
      targets.add(target_path.toLowerCase());
      sessions.push({ area, origin: origin.name, old_id: row.session_id, session_id, source_path, target_path });
    }
  }
}
const changes = sessions.filter((item) => item.old_id !== item.session_id || item.source_path !== item.target_path);
console.log(JSON.stringify({ mode: apply ? "apply" : "preview", changes }, null, 2));
if (!apply || !changes.length) process.exit(0);

const backup_path = path.join(root_path, `session-id-backup-${Date.now()}`);
await fs.mkdir(backup_path);
for (const area of ["sessions", "archived-sessions"]) {
  try {
    await fs.cp(path.join(root_path, area), path.join(backup_path, area), { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await fs.writeFile(path.join(backup_path, "manifest.json"), JSON.stringify(changes, null, 2));

/** Rewrite structured Session identity keys and paths, without altering prose. */
function rewrite_value(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => rewrite_value(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, rewrite_value(item, field)]));
  }
  if (typeof value !== "string") return value;
  if (["session_id", "origin_session_id", "source_session_id", "owner_context_id"].includes(key)) {
    return value.trim().toLowerCase();
  }
  if (["path", "file_path", "url", "local_path"].includes(key)) {
    for (const change of changes) {
      if (value.startsWith(`${change.source_path}/`)) return change.target_path + value.slice(change.source_path.length);
    }
  }
  return value;
}

try {
  // Update every database, including unchanged IDs that refer to a changed source.
  for (const item of sessions) {
    const database = new DatabaseSync(path.join(item.source_path, "session.db"));
    try {
      database.exec("BEGIN IMMEDIATE");
      database.prepare("UPDATE session_state SET session_id = ? WHERE singleton_id = 1").run(item.session_id);
      const update_origin = database.prepare("UPDATE messages SET origin_session_id = ? WHERE message_id = ?");
      for (const row of database.prepare("SELECT message_id, origin_session_id FROM messages WHERE origin_session_id IS NOT NULL").all()) {
        update_origin.run(row.origin_session_id.trim().toLowerCase(), row.message_id);
      }
      const update_part = database.prepare("UPDATE message_parts SET content = ? WHERE part_id = ?");
      for (const row of database.prepare("SELECT part_id, content FROM message_parts").all()) {
        const content = JSON.stringify(rewrite_value(JSON.parse(row.content)));
        if (content !== row.content) update_part.run(content, row.part_id);
      }
      database.exec("COMMIT");
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
  }
  for (const item of changes) {
    if (item.source_path !== item.target_path) await fs.rename(item.source_path, item.target_path);
  }
  console.log(`Migrated ${changes.length} Sessions. Backup and external-reference manifest: ${backup_path}`);
} catch (error) {
  throw new Error(`Migration stopped; keep Downcity offline and restore Session trees from ${backup_path}`, { cause: error });
}
