/**
 * @file 一次性迁移本地 Session Message 磁盘数据。
 *
 * 该脚本只扫描 `<root>/agents` 下名为 messages 的 Session 目录，
 * 不会被 SDK、CLI 或 Desktop 自动调用。
 * 旧顶层 assistant/action/error 会分别迁移为 agent Message 或其内部 Part。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEGMENT_FILE_PATTERN = /^\d+-\d+\.jsonl$/;

/** 将一条旧 Message 转换为双主体结构。 */
export function migrate_session_message(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Session Message must be an object");
  }
  if (value.record_type === "summary") return { value, changed: false };
  if (value.type === "user" || value.type === "agent") {
    if (!Array.isArray(value.parts)) {
      throw new Error(`Session ${String(value.type)} Message parts must be an array`);
    }
    return { value, changed: false };
  }
  if (value.type === "assistant") {
    if (!Array.isArray(value.parts)) {
      throw new Error("Legacy assistant Message parts must be an array");
    }
    return { value: { ...value, type: "agent" }, changed: true };
  }
  if (value.type === "action") {
    const { action_type, status, title, description, data, ...base } = value;
    return {
      changed: true,
      value: {
        ...base,
        type: "agent",
        kind: "normal",
        status: "completed",
        parts: [{
          part_id: `action-part:${String(value.message_id)}`,
          sequence: 1,
          type: "action",
          action_id: value.message_id,
          action_type,
          state: status,
          title,
          ...(description !== undefined ? { description } : {}),
          ...(data !== undefined ? { data } : {}),
        }],
      },
    };
  }
  if (value.type === "error") {
    const { scope, code, message, recoverable, ...base } = value;
    return {
      changed: true,
      value: {
        ...base,
        type: "agent",
        kind: "normal",
        status: "failed",
        parts: [{
          part_id: `error-part:${String(value.message_id)}`,
          sequence: 1,
          type: "error",
          scope,
          code,
          message,
          recoverable,
        }],
      },
    };
  }
  throw new Error(`Unsupported Session Message type: ${String(value.type)}`);
}

/** 原子覆盖一个已有文件，并保留原权限。 */
async function write_file_atomically(file_path, content) {
  const temporary_path = `${file_path}.migration-${randomUUID()}.tmp`;
  const mode = (await fs.stat(file_path).catch(() => null))?.mode;
  await fs.writeFile(temporary_path, content, "utf8");
  if (mode !== undefined) await fs.chmod(temporary_path, mode);
  await fs.rename(temporary_path, file_path);
}

/** 迁移一个 JSONL 文件中的全部 Message revision。 */
async function migrate_jsonl_file(file_path, dry_run) {
  const raw = await fs.readFile(file_path, "utf8");
  let changed = false;
  const values = raw.split("\n").filter((line) => line.trim()).map((line) => {
    const result = migrate_session_message(JSON.parse(line));
    changed ||= result.changed;
    return result.value;
  });
  if (changed && !dry_run) {
    const content = values.length > 0
      ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n`
      : "";
    await write_file_atomically(file_path, content);
  }
  return changed;
}

/** 读取并转换一个草稿。 */
async function read_draft(file_path) {
  try {
    const result = migrate_session_message(JSON.parse(await fs.readFile(file_path, "utf8")));
    if (result.value.type !== "agent" || result.value.status !== "streaming") {
      throw new Error(`Session draft must be a streaming Agent Message: ${file_path}`);
    }
    return result;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** 迁移并重命名旧 Assistant 草稿。 */
async function migrate_draft(messages_dir_path, dry_run) {
  const legacy_path = path.join(messages_dir_path, "assistant_message.json");
  const current_path = path.join(messages_dir_path, "agent_message.json");
  const legacy = await read_draft(legacy_path);
  const current = await read_draft(current_path);
  if (!legacy && !current) return false;
  if (legacy && current && legacy.value.message_id !== current.value.message_id) {
    throw new Error(`Conflicting Session drafts: ${messages_dir_path}`);
  }
  const selected = !legacy
    ? current
    : !current || legacy.value.revision > current.value.revision
      ? legacy
      : current;
  const changed = Boolean(legacy || selected?.changed);
  if (changed && !dry_run) {
    await write_file_atomically(current_path, `${JSON.stringify(selected.value, null, 2)}\n`);
    if (legacy) await fs.rm(legacy_path);
  }
  return changed;
}

/** 递归收集 Agent Session 的 messages 目录，不扫描日志或插件数据。 */
async function find_messages_directories(root_path) {
  const agents_path = path.join(root_path, "agents");
  const directories = [];
  async function visit(directory_path, inside_sessions = false) {
    const entries = await fs.readdir(directory_path, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child_path = path.join(directory_path, entry.name);
      const child_inside_sessions = inside_sessions ||
        entry.name === "sessions" ||
        entry.name === "archived-sessions";
      if (entry.name === "messages" && child_inside_sessions) directories.push(child_path);
      else await visit(child_path, child_inside_sessions);
    }
  }
  await visit(agents_path);
  return directories.sort();
}

/** 迁移一个 Session 的 Active、Segments 和草稿。 */
async function migrate_messages_directory(messages_dir_path, dry_run) {
  let changed_files = 0;
  const active_path = path.join(messages_dir_path, "active.jsonl");
  if (await fs.stat(active_path).then((value) => value.isFile()).catch(() => false)) {
    if (await migrate_jsonl_file(active_path, dry_run)) changed_files += 1;
  }
  const segments_path = path.join(messages_dir_path, "segments");
  const entries = await fs.readdir(segments_path, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile() || !SEGMENT_FILE_PATTERN.test(entry.name)) continue;
    if (await migrate_jsonl_file(path.join(segments_path, entry.name), dry_run)) {
      changed_files += 1;
    }
  }
  if (await migrate_draft(messages_dir_path, dry_run)) changed_files += 1;
  return changed_files;
}

/** 执行一次完整的本地迁移。 */
export async function migrate_session_message_storage({ root_path, dry_run = false }) {
  const directories = await find_messages_directories(path.resolve(root_path));
  let changed_sessions = 0;
  let changed_files = 0;
  for (const messages_dir_path of directories) {
    const session_changed_files = await migrate_messages_directory(messages_dir_path, dry_run);
    if (session_changed_files > 0) changed_sessions += 1;
    changed_files += session_changed_files;
  }
  return {
    scanned_sessions: directories.length,
    changed_sessions,
    changed_files,
    dry_run,
  };
}

/** 解析一次性脚本参数。 */
function parse_arguments(arguments_) {
  let root_path = path.join(os.homedir(), ".downcity");
  let dry_run = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") dry_run = true;
    else if (argument === "--root" && arguments_[index + 1]) root_path = arguments_[++index];
    else throw new Error(`Unknown argument: ${String(argument)}`);
  }
  return { root_path, dry_run };
}

const current_file_path = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  const result = await migrate_session_message_storage(parse_arguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
