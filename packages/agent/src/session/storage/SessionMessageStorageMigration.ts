/**
 * Session Message v1 到 v2 的一次性磁盘迁移。
 *
 * v1 使用 user/assistant/action/error 四类顶层 Message；v2 只保留 user/agent，
 * 并把 action/error 下沉为 Agent Part。调用方必须持有当前 Session Message 写锁，
 * 本模块逐文件原子替换并最后写入版本标记，因此中断后可以安全重试。
 */

import path from "node:path";
import type { SessionAgentMessage, SessionMessage } from "@downcity/type";
import type { SessionSegmentSummary } from "@/types/session/SessionSegment.js";
import type {
  MigratableSessionMessage,
  SessionMessageStorageMigrationInput,
} from "@/types/session/SessionMessageMigration.js";

const CURRENT_MESSAGE_SCHEMA_VERSION = 2;
const MESSAGE_SCHEMA_FILE_NAME = "schema.json";
const LEGACY_ASSISTANT_MESSAGE_FILE_NAME = "assistant_message.json";
const SEGMENT_FILE_PATTERN = /^\d+-\d+\.jsonl$/;

/** 在调用方持有写锁时，把当前 Session 的全部新旧消息统一迁移到 v2。 */
export async function migrate_session_message_storage_unsafe(
  input: SessionMessageStorageMigrationInput,
): Promise<void> {
  const messages_dir_path = path.dirname(input.active_file_path);
  const schema_file_path = path.join(messages_dir_path, MESSAGE_SCHEMA_FILE_NAME);
  if (await has_current_schema(input, schema_file_path)) return;

  const segments_dir_path = path.join(messages_dir_path, "segments");
  const legacy_file_path = path.join(
    messages_dir_path,
    LEGACY_ASSISTANT_MESSAGE_FILE_NAME,
  );
  const has_segments = await input.files.path_exists(segments_dir_path);
  const has_storage = has_segments ||
    await input.files.path_exists(input.active_file_path) ||
    await input.files.path_exists(input.agent_message_file_path) ||
    await input.files.path_exists(legacy_file_path);
  if (!has_storage) return;

  const segment_entries = has_segments
    ? await input.files.read_directory(segments_dir_path)
    : [];
  for (const entry of segment_entries) {
    if (!entry.is_file || !SEGMENT_FILE_PATTERN.test(entry.name)) continue;
    await migrate_segment_file(input, path.join(segments_dir_path, entry.name));
  }
  await migrate_active_file(input);
  await migrate_draft_file(input);
  await input.files.write_file_atomically(
    schema_file_path,
    `${JSON.stringify({ version: CURRENT_MESSAGE_SCHEMA_VERSION }, null, 2)}\n`,
  );
}

/** 已完成的版本标记使后续初始化不再扫描不可变历史 Segment。 */
async function has_current_schema(
  input: SessionMessageStorageMigrationInput,
  schema_file_path: string,
): Promise<boolean> {
  if (!(await input.files.path_exists(schema_file_path))) return false;
  const value = JSON.parse(
    (await input.files.read_file(schema_file_path)).toString("utf8"),
  ) as { version?: unknown };
  if (value.version !== CURRENT_MESSAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Session Message schema version: ${String(value.version)}`);
  }
  return true;
}

/** 迁移 Active 中的全部 revision 行，保留原始追加日志语义。 */
async function migrate_active_file(input: SessionMessageStorageMigrationInput): Promise<void> {
  if (!(await input.files.path_exists(input.active_file_path))) return;
  const raw = (await input.files.read_file(input.active_file_path)).toString("utf8");
  const migrated = migrate_message_lines(raw);
  if (migrated.changed) {
    await input.files.write_file_atomically(input.active_file_path, migrated.content);
  }
}

/** 迁移不可变 Segment 正文，同时原样保留累计 Summary footer。 */
async function migrate_segment_file(
  input: SessionMessageStorageMigrationInput,
  file_path: string,
): Promise<void> {
  const raw = (await input.files.read_file(file_path)).toString("utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const summary = JSON.parse(lines.pop() || "null") as SessionSegmentSummary | null;
  if (!summary || summary.record_type !== "summary") {
    throw new Error(`Session Segment summary footer is required: ${file_path}`);
  }
  let changed = false;
  const messages = lines.map((line) => {
    const result = migrate_message(JSON.parse(line));
    changed ||= result.changed;
    return result.message;
  });
  if (!changed) return;
  await input.files.write_file_atomically(
    file_path,
    `${[...messages.map((message) => JSON.stringify(message)), JSON.stringify(summary)].join("\n")}\n`,
  );
}

/** 把旧草稿文件名和旧 assistant 判别值统一迁移到 Agent 草稿。 */
async function migrate_draft_file(input: SessionMessageStorageMigrationInput): Promise<void> {
  const legacy_file_path = path.join(
    path.dirname(input.active_file_path),
    LEGACY_ASSISTANT_MESSAGE_FILE_NAME,
  );
  const legacy = await read_migrated_draft(input, legacy_file_path);
  const current = await read_migrated_draft(input, input.agent_message_file_path);
  if (!legacy && !current) return;
  if (legacy && current && legacy.message.message_id !== current.message.message_id) {
    throw new Error("Legacy and current Session Agent drafts have different message_id values");
  }
  const selected = !legacy
    ? current
    : !current || legacy.message.revision > current.message.revision
      ? legacy
      : current;
  if (!selected || selected.message.type !== "agent" || selected.message.status !== "streaming") {
    throw new Error("Session Agent draft must be a streaming Agent Message");
  }
  if (legacy || selected.changed) {
    await input.files.write_file_atomically(
      input.agent_message_file_path,
      `${JSON.stringify(selected.message, null, 2)}\n`,
    );
  }
  if (legacy) await input.files.remove_path(legacy_file_path);
}

/** 读取并迁移一个可能存在的草稿文件。 */
async function read_migrated_draft(
  input: SessionMessageStorageMigrationInput,
  file_path: string,
): Promise<{ message: SessionMessage; changed: boolean } | null> {
  if (!(await input.files.path_exists(file_path))) return null;
  return migrate_message(JSON.parse((await input.files.read_file(file_path)).toString("utf8")));
}

/** 迁移普通 JSONL 消息行。 */
function migrate_message_lines(raw: string): { content: string; changed: boolean } {
  let changed = false;
  const messages = raw.split("\n").filter((line) => line.trim()).map((line) => {
    const result = migrate_message(JSON.parse(line));
    changed ||= result.changed;
    return result.message;
  });
  return {
    content: messages.length > 0
      ? `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
      : "",
    changed,
  };
}

/** 将一条旧顶层消息确定性映射为新的双主体结构。 */
function migrate_message(value: unknown): { message: SessionMessage; changed: boolean } {
  if (!value || typeof value !== "object") throw new Error("Session Message must be an object");
  const message = value as MigratableSessionMessage;
  if (message.type === "user" || message.type === "agent") {
    if (!Array.isArray(message.parts)) {
      throw new Error(`Session ${message.type} Message parts must be an array`);
    }
    return { message, changed: false };
  }
  if (message.type === "assistant") {
    if (!Array.isArray(message.parts)) {
      throw new Error("Legacy Session assistant Message parts must be an array");
    }
    return { message: { ...message, type: "agent" }, changed: true };
  }
  if (message.type === "action") {
    const { action_type, status, title, description, data, ...base } = message;
    return {
      message: {
        ...base,
        type: "agent",
        kind: "normal",
        status: "completed",
        parts: [{
          part_id: `action-part:${message.message_id}`,
          sequence: 1,
          type: "action",
          action_id: message.message_id,
          action_type,
          state: status,
          title,
          ...(description !== undefined ? { description } : {}),
          ...(data !== undefined ? { data } : {}),
        }],
      },
      changed: true,
    };
  }
  if (message.type === "error") {
    const { scope, code, message: error_message, recoverable, ...base } = message;
    return {
      message: {
        ...base,
        type: "agent",
        kind: "normal",
        status: "failed",
        parts: [{
          part_id: `error-part:${message.message_id}`,
          sequence: 1,
          type: "error",
          scope,
          code,
          message: error_message,
          recoverable,
        }],
      },
      changed: true,
    };
  }
  throw new Error(`Unsupported Session Message type: ${String((message as { type?: unknown }).type)}`);
}
