/**
 * @file 旧 Session 文件存储到 SQLite 的一次性迁移实现。
 *
 * 本模块只供仓库外部脚本和测试使用。Runtime、Desktop 与 SDK 不导入它，也不会在
 * 启动时隐式修改用户磁盘。迁移先构建并校验临时数据库，再原子写入 session.db。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SEGMENT_FILE_PATTERN = /^\d+-\d+\.jsonl$/u;
const MESSAGE_PART_TYPES = new Set([
  "text", "context", "reasoning", "tool", "interaction",
  "file", "data", "action", "error",
]);
const USER_PART_TYPES = new Set(["text", "context", "file", "data"]);

/** 迁移脚本冻结使用的 v1 Session schema。 */
const SESSION_STORAGE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE session_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  session_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  origin TEXT NOT NULL CHECK (json_valid(origin)),
  timezone TEXT NOT NULL,
  title TEXT,
  model_label TEXT,
  approval_mode TEXT CHECK (approval_mode IS NULL OR approval_mode IN ('ask', 'always-allow')),
  system_snapshot TEXT,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  preview_text TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  turn_id TEXT,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  input_type TEXT CHECK (input_type IS NULL OR input_type IN ('prompt', 'steer')),
  status TEXT NOT NULL CHECK (status IN ('streaming', 'completed', 'stopped', 'failed')),
  visibility TEXT NOT NULL CHECK (visibility IN ('visible', 'internal')),
  origin_session_id TEXT,
  origin_message_id TEXT,
  origin_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((role = 'user' AND input_type IS NOT NULL AND status = 'completed') OR (role = 'agent' AND input_type IS NULL))
);

CREATE TABLE message_parts (
  part_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  step_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('text', 'context', 'reasoning', 'tool', 'interaction', 'file', 'data', 'action', 'error')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(message_id, sequence)
);

CREATE INDEX messages_turn_sequence_index ON messages(turn_id, sequence);
CREATE INDEX messages_visibility_sequence_index ON messages(visibility, sequence);
CREATE INDEX message_parts_message_sequence_index ON message_parts(message_id, sequence);
CREATE INDEX message_parts_step_index ON message_parts(step_id, message_id, sequence);
CREATE INDEX message_parts_type_index ON message_parts(type, message_id);

CREATE TRIGGER messages_role_immutable BEFORE UPDATE OF role ON messages
WHEN OLD.role <> NEW.role BEGIN SELECT RAISE(ABORT, 'message role is immutable'); END;

CREATE TRIGGER message_parts_validate_role_insert BEFORE INSERT ON message_parts
WHEN NOT (
  ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user' AND NEW.type IN ('text', 'context', 'file', 'data')) OR
  ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent' AND NEW.type IN ('text', 'reasoning', 'tool', 'interaction', 'file', 'data', 'action', 'error'))
) BEGIN SELECT RAISE(ABORT, 'message part type is incompatible with message role'); END;

CREATE TRIGGER message_parts_validate_role_update BEFORE UPDATE OF message_id, type ON message_parts
WHEN NOT (
  ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user' AND NEW.type IN ('text', 'context', 'file', 'data')) OR
  ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent' AND NEW.type IN ('text', 'reasoning', 'tool', 'interaction', 'file', 'data', 'action', 'error'))
) BEGIN SELECT RAISE(ABORT, 'message part type is incompatible with message role'); END;
`;

/** 迁移一个根目录中的全部或指定 Session。 */
export async function migrate_session_storage_to_sqlite(input) {
  const root_path = path.resolve(input.root_path);
  const sessions = await find_session_directories(root_path, input.agent_id, input.session_id);
  const result = {
    scanned_sessions: sessions.length,
    migrated_sessions: 0,
    skipped_sessions: 0,
    dry_run: Boolean(input.dry_run),
    sessions: [],
  };
  for (const session of sessions) {
    const migration = await migrate_session_directory(session, Boolean(input.dry_run));
    result.sessions.push(migration);
    if (migration.status === "migrated") result.migrated_sessions += 1;
    else result.skipped_sessions += 1;
  }
  return result;
}

/** 扫描 Agent 数据根中的 Session 目录。 */
async function find_session_directories(root_path, selected_agent_id, selected_session_id) {
  const agents_path = path.join(root_path, "agents");
  const agent_entries = await read_directory(agents_path);
  const sessions = [];
  for (const agent_entry of agent_entries) {
    if (!agent_entry.isDirectory()) continue;
    const agent_id = decode_path_segment(agent_entry.name);
    if (selected_agent_id && selected_agent_id !== agent_id) continue;
    const agent_root_path = path.join(agents_path, agent_entry.name);
    await visit_agent_directories(agent_root_path, async (session_path, archived, inferred_origin_type) => {
      const metadata = await read_json_file(path.join(session_path, "meta.json"), null);
      const session_id = String(metadata?.session_id || decode_path_segment(path.basename(session_path))).trim();
      if (!session_id || (selected_session_id && selected_session_id !== session_id)) return;
      sessions.push({
        source_path: session_path,
        agent_root_path,
        agent_id,
        session_id,
        archived,
        inferred_origin_type,
      });
    });
  }
  sessions.sort((left, right) => left.source_path.localeCompare(right.source_path));
  const targets = new Map();
  for (const session of sessions) {
    const metadata = await read_json_file(path.join(session.source_path, "meta.json"), null);
    const origin_type = normalize_origin_type(metadata?.origin?.type || session.inferred_origin_type || "chat");
    const target_path = resolve_target_path(session, origin_type);
    const previous = targets.get(target_path);
    if (previous && previous !== session.source_path) {
      throw new Error(`多个旧 Session 会迁移到同一路径：${target_path}`);
    }
    targets.set(target_path, session.source_path);
  }
  return sessions;
}

/** 只在 sessions/archived-sessions 领域树中识别 Session 根。 */
async function visit_agent_directories(agent_root_path, accept) {
  async function visit(directory_path, session_partition) {
    const entries = await read_directory(directory_path);
    const names = new Set(entries.map((entry) => entry.name));
    const is_session = Boolean(session_partition) && (
      names.has("meta.json") || names.has("instruction.md") ||
      names.has("messages") || names.has("session.db")
    );
    if (is_session) {
      await accept(directory_path, session_partition.archived, infer_origin_type(directory_path, session_partition.root_path));
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "messages" || entry.name === "attachments") continue;
      const child_path = path.join(directory_path, entry.name);
      const next_partition = entry.name === "sessions"
        ? { root_path: child_path, archived: false }
        : entry.name === "archived-sessions"
          ? { root_path: child_path, archived: true }
          : session_partition;
      await visit(child_path, next_partition);
    }
  }
  await visit(agent_root_path, null);
}

/** 从标准的 `<partition>/<origin>/<session>` 层级推断来源。 */
function infer_origin_type(session_path, partition_path) {
  const relative_parts = path.relative(partition_path, session_path).split(path.sep).filter(Boolean);
  return relative_parts.length === 2 ? decode_path_segment(relative_parts[0]) : "chat";
}

/** 迁移单个 Session，并在成功后移除旧 canonical 文件。 */
async function migrate_session_directory(session, dry_run) {
  const legacy = await read_legacy_session(session);
  const target_path = resolve_target_path(session, legacy.origin.type);
  const database_path = path.join(target_path, "session.db");
  const existing_database_path = path.join(session.source_path, "session.db");
  const source_is_target = session.source_path === target_path;
  const existing_path = await is_file(existing_database_path)
    ? existing_database_path
    : await is_file(database_path)
      ? database_path
      : null;
  const has_legacy_data = await contains_legacy_data(session.source_path);

  if (existing_path) {
    assert_existing_database(existing_path, legacy, has_legacy_data);
    if (dry_run) return describe_session(session, target_path, "skipped");
    if (!source_is_target && existing_path === existing_database_path) {
      await relocate_session_directory(session.source_path, target_path);
    }
    await remove_legacy_files(target_path);
    return describe_session(session, target_path, "skipped");
  }
  if (dry_run) return describe_session(session, target_path, "migrated", legacy.messages.length);

  if (!source_is_target && await path_exists(target_path)) {
    throw new Error(`Session 目标目录已经存在：${target_path}`);
  }
  const temporary_path = path.join(
    session.source_path,
    `.session.db.migration-${randomUUID()}.tmp`,
  );
  try {
    write_session_database(temporary_path, legacy);
    await fs.chmod(temporary_path, 0o600);
    await fs.rename(temporary_path, existing_database_path);
    if (!source_is_target) await relocate_session_directory(session.source_path, target_path);
    assert_existing_database(database_path, legacy);
    await remove_legacy_files(target_path);
  } catch (error) {
    await fs.rm(temporary_path, { force: true }).catch(() => undefined);
    throw error;
  }
  return describe_session(session, target_path, "migrated", legacy.messages.length);
}

/** 读取 Metadata、Instruction、Segment、Active 与运行草稿。 */
async function read_legacy_session(session) {
  const metadata_path = path.join(session.source_path, "meta.json");
  const metadata = await read_json_file(metadata_path, {});
  const session_id = String(metadata.session_id || session.session_id).trim();
  const agent_id = String(metadata.agent_id || session.agent_id).trim();
  if (session_id !== session.session_id) throw new Error(`Session ID 与目录不一致：${session.source_path}`);
  if (agent_id !== session.agent_id) throw new Error(`Session Agent 所有权不一致：${session.source_path}`);
  const origin = normalize_origin(metadata.origin, session.inferred_origin_type);
  const instruction = await fs.readFile(path.join(session.source_path, "instruction.md"), "utf8")
    .then((value) => value.trim() || null)
    .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  const { messages, summaries } = await read_legacy_messages(session.source_path, session_id);
  const created_at = normalize_timestamp(metadata.created_at, messages[0]?.created_at ?? Date.now());
  const updated_at = Math.max(
    normalize_timestamp(metadata.updated_at, created_at),
    messages.at(-1)?.updated_at ?? created_at,
  );
  return {
    session_id,
    agent_id,
    workspace_id: normalize_optional_string(metadata.workspace_id),
    origin,
    timezone: normalize_optional_string(metadata.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    title: normalize_optional_string(metadata.title),
    model_label: normalize_optional_string(metadata.model_label),
    approval_mode: metadata.approval_mode === "ask" || metadata.approval_mode === "always-allow" ? metadata.approval_mode : null,
    instruction,
    created_at,
    updated_at,
    messages,
    summary: select_latest_summary(summaries, messages),
  };
}

/** 按 revision 折叠旧 Message，并提取最新累计摘要。 */
async function read_legacy_messages(session_path, session_id) {
  const messages_path = path.join(session_path, "messages");
  const values = [];
  const summaries = [];
  const segment_entries = (await read_directory(path.join(messages_path, "segments")))
    .filter((entry) => entry.isFile() && SEGMENT_FILE_PATTERN.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of segment_entries) {
    const rows = await read_jsonl_file(path.join(messages_path, "segments", entry.name));
    for (const row of rows) row.record_type === "summary" ? summaries.push(row) : values.push(row);
  }
  values.push(...await read_jsonl_file(path.join(messages_path, "active.jsonl"), true));
  for (const draft_name of ["assistant_message.json", "agent_message.json"]) {
    const draft = await read_json_file(path.join(messages_path, draft_name), null);
    if (draft) values.push(draft);
  }

  const by_id = new Map();
  for (const value of values) {
    const converted = normalize_legacy_message(value, session_id, summaries);
    if (!converted) continue;
    const previous = by_id.get(converted.message_id);
    if (!previous || converted.revision > previous.revision) by_id.set(converted.message_id, converted);
  }
  const messages = [...by_id.values()].sort((left, right) => left.sequence - right.sequence);
  const message_ids = new Set();
  const sequences = new Set();
  const part_ids = new Set();
  for (const message of messages) {
    if (message_ids.has(message.message_id) || sequences.has(message.sequence)) {
      throw new Error(`Session Message identity/sequence 冲突：${session_path}`);
    }
    message_ids.add(message.message_id);
    sequences.add(message.sequence);
    for (const part of message.parts) {
      if (part_ids.has(part.part_id)) throw new Error(`Session Part ID 冲突：${part.part_id}`);
      part_ids.add(part.part_id);
    }
  }
  return { messages, summaries };
}

/** 把旧顶层 Message 转换为新的 User/Agent Message。 */
function normalize_legacy_message(value, session_id, summaries) {
  if (!value || typeof value !== "object") throw new Error("Session Message 必须是对象");
  if (value.record_type === "summary") {
    summaries.push(value);
    return null;
  }
  if (value.kind === "summary") {
    summaries.push({
      record_type: "summary",
      session_id,
      summary_id: value.message_id,
      through_message_id: value.summary_through_message_id,
      text: (value.parts || []).filter((part) => part.type === "text").map((part) => part.text).join("\n"),
      created_at: value.created_at,
    });
    return null;
  }
  const source_role = value.role || value.type;
  const wrapped = source_role === "action"
    ? wrap_action_message(value)
    : source_role === "error"
      ? wrap_error_message(value)
      : source_role === "assistant"
        ? { ...value, role: "agent" }
        : { ...value, role: source_role };
  if (wrapped.role !== "user" && wrapped.role !== "agent") {
    throw new Error(`不支持的 Session Message role：${String(source_role)}`);
  }
  if (String(wrapped.session_id || session_id) !== session_id) {
    throw new Error(`Session Message session_id 不一致：${String(wrapped.message_id)}`);
  }
  const message_id = normalize_required_string(wrapped.message_id, "message_id");
  const sequence = normalize_positive_integer(wrapped.sequence, "message sequence");
  const revision = normalize_positive_integer(wrapped.revision ?? 1, "message revision");
  const created_at = normalize_timestamp(wrapped.created_at, Date.now());
  const updated_at = normalize_timestamp(wrapped.updated_at, created_at);
  if (!Array.isArray(wrapped.parts)) throw new Error(`Session Message parts 缺失：${message_id}`);
  const parts = normalize_parts(wrapped.role, wrapped.parts, message_id, updated_at);
  return recover_interrupted_message({
    message_id,
    session_id,
    turn_id: normalize_optional_string(wrapped.turn_id),
    sequence,
    revision,
    role: wrapped.role,
    input_type: wrapped.role === "user" && wrapped.input_type === "steer" ? "steer" : "prompt",
    status: wrapped.role === "agent" && ["streaming", "completed", "stopped", "failed"].includes(wrapped.status) ? wrapped.status : "completed",
    visibility: wrapped.visibility === "internal" ? "internal" : "visible",
    origin: normalize_message_origin(wrapped.origin),
    created_at,
    updated_at,
    parts,
  });
}

/** 将旧 Action 顶层消息折叠成 Agent Action Part。 */
function wrap_action_message(value) {
  return {
    ...value,
    role: "agent",
    status: "completed",
    parts: [{
      part_id: `action-part:${String(value.message_id)}`,
      type: "action",
      action_id: String(value.message_id),
      action_type: String(value.action_type || "action"),
      state: ["running", "completed", "failed"].includes(value.status) ? value.status : "completed",
      title: String(value.title || value.action_type || "Action"),
      ...(value.description !== undefined ? { description: value.description } : {}),
      ...(value.data !== undefined ? { data: value.data } : {}),
    }],
  };
}

/** 将旧 Error 顶层消息折叠成 Agent Error Part。 */
function wrap_error_message(value) {
  return {
    ...value,
    role: "agent",
    status: "failed",
    parts: [{
      part_id: `error-part:${String(value.message_id)}`,
      type: "error",
      scope: value.scope === "session" ? "session" : "turn",
      code: String(value.code || "unknown"),
      message: String(value.message || "Unknown error"),
      recoverable: Boolean(value.recoverable),
    }],
  };
}

/** 规范化 Part 身份、顺序，并为旧 Agent 输出推导 Step。 */
function normalize_parts(role, source_parts, message_id) {
  let step_index = 1;
  let tool_seen_in_step = false;
  return source_parts.map((source, index) => {
    if (!source || typeof source !== "object" || !MESSAGE_PART_TYPES.has(source.type)) {
      throw new Error(`不支持的 Session Part：${String(source?.type)}`);
    }
    if (role === "user" && !USER_PART_TYPES.has(source.type)) {
      throw new Error(`User Message 不能包含 ${source.type} Part`);
    }
    if (role === "agent" && tool_seen_in_step && (source.type === "text" || source.type === "reasoning")) {
      step_index += 1;
      tool_seen_in_step = false;
    }
    const derived_step_id = role === "agent" && source.type !== "action" && source.type !== "error"
      ? `step:${message_id}:${String(step_index)}`
      : undefined;
    if (role === "agent" && source.type === "tool") tool_seen_in_step = true;
    return {
      ...source,
      part_id: `${message_id}:part:${String(index + 1)}`,
      sequence: index + 1,
      ...(normalize_optional_string(source.step_id) || derived_step_id
        ? { step_id: normalize_optional_string(source.step_id) || derived_step_id }
        : {}),
    };
  });
}

/** 将运行中状态收口为可恢复的终态。 */
function recover_interrupted_message(message) {
  if (message.role !== "agent") return message;
  let changed = message.status === "streaming";
  const parts = message.parts.map((part) => {
    if (part.type === "action" && part.state === "running") {
      changed = true;
      return { ...part, state: "failed", description: part.description || "Action interrupted before completion." };
    }
    if (part.type === "interaction" && part.status === "pending") {
      changed = true;
      return { ...part, status: "cancelled", cancel_reason: "runtime_interrupted", resolved_at: message.updated_at };
    }
    if (part.type === "tool" && part.state !== "completed" && part.state !== "failed") {
      changed = true;
      return { ...part, state: "failed", error: part.error || "Tool interrupted before completion." };
    }
    if ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") {
      changed = true;
      return { ...part, state: "done" };
    }
    return part;
  });
  return changed ? {
    ...message,
    status: message.status === "streaming" ? "stopped" : message.status,
    revision: message.revision + 1,
    updated_at: Math.max(Date.now(), message.updated_at),
    parts,
  } : message;
}

/** 选择边界仍存在的最新累计摘要。 */
function select_latest_summary(summaries, messages) {
  const message_by_id = new Map(messages.map((message) => [message.message_id, message]));
  return summaries.flatMap((summary) => {
    const through_message = summary.through_message_id
      ? message_by_id.get(summary.through_message_id)
      : messages.find((message) => message.sequence === Number(summary.through_sequence));
    const text = String(summary.text || summary.summary || "").trim();
    if (!through_message || !text) return [];
    return [{
      summary_id: normalize_optional_string(summary.summary_id) || `summary:migrated:${through_message.message_id}`,
      through_message_id: through_message.message_id,
      through_sequence: through_message.sequence,
      summary: text,
      policy_version: 1,
      created_at: normalize_timestamp(summary.created_at, through_message.updated_at),
    }];
  }).sort((left, right) => left.through_sequence - right.through_sequence).at(-1) || null;
}

/** 写入并完整校验一个临时 Session 数据库。 */
function write_session_database(database_path, session) {
  const database = new DatabaseSync(database_path);
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
    database.exec(SESSION_STORAGE_SCHEMA_SQL);
    database.exec("PRAGMA user_version = 1; BEGIN IMMEDIATE;");
    const preview_text = resolve_message_preview(session.messages.at(-1)).slice(0, 180) || null;
    database.prepare(`
      INSERT INTO session_state (
        singleton_id, session_id, agent_id, workspace_id, origin, timezone,
        title, model_label, approval_mode, system_snapshot, message_count,
        preview_text, revision, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      session.session_id, session.agent_id, session.workspace_id, JSON.stringify(session.origin),
      session.timezone, session.title, session.model_label, session.approval_mode,
      session.instruction, session.messages.length, preview_text, session.created_at, session.updated_at,
    );
    const insert_message = database.prepare(`
      INSERT INTO messages (
        message_id, turn_id, sequence, revision, role, input_type, status,
        visibility, origin_session_id, origin_message_id, origin_turn_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insert_part = database.prepare(`
      INSERT INTO message_parts (
        part_id, message_id, sequence, step_id, type, content, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const message of session.messages) {
      insert_message.run(
        message.message_id, message.turn_id, message.sequence, message.revision, message.role,
        message.role === "user" ? message.input_type : null,
        message.role === "agent" ? message.status : "completed",
        message.visibility, message.origin?.session_id ?? null, message.origin?.message_id ?? null,
        message.origin?.turn_id ?? null, message.created_at, message.updated_at,
      );
      for (const part of message.parts) {
        const { part_id, sequence, step_id, type, ...content } = part;
        insert_part.run(
          part_id, message.message_id, sequence, step_id ?? null, type,
          JSON.stringify(content), message.created_at, message.updated_at,
        );
      }
    }
    if (session.summary) {
      database.exec(`
        CREATE TABLE composer_sequence_summaries (
          summary_id TEXT PRIMARY KEY,
          through_message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
          through_sequence INTEGER NOT NULL UNIQUE,
          summary TEXT NOT NULL,
          policy_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      database.prepare(`
        INSERT INTO composer_sequence_summaries (
          summary_id, through_message_id, through_sequence, summary, policy_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        session.summary.summary_id, session.summary.through_message_id,
        session.summary.through_sequence, session.summary.summary,
        session.summary.policy_version, session.summary.created_at,
      );
    }
    database.exec("COMMIT;");
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") throw new Error(`SQLite integrity_check 失败：${String(integrity?.integrity_check)}`);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* 没有活动事务时无需处理。 */ }
    throw error;
  } finally {
    database.close();
  }
}

/** 验证已存在数据库与旧数据一致，防止幂等重跑覆盖新事实。 */
function assert_existing_database(database_path, session, compare_message_count = true) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    const state = database.prepare("SELECT session_id, agent_id, message_count FROM session_state WHERE singleton_id = 1").get();
    const count = Number(database.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count ?? -1);
    if (
      state?.session_id !== session.session_id || state?.agent_id !== session.agent_id ||
      Number(state.message_count) !== count ||
      (compare_message_count && count !== session.messages.length)
    ) {
      throw new Error(`已有 session.db 与旧数据不一致：${database_path}`);
    }
  } finally {
    database.close();
  }
}

/** 判断目录中是否仍保留旧 canonical Session 文件。 */
async function contains_legacy_data(session_path) {
  return await path_exists(path.join(session_path, "meta.json")) ||
    await path_exists(path.join(session_path, "instruction.md")) ||
    await path_exists(path.join(session_path, "messages"));
}

/** 把迁移完成的 Session 放入标准来源分区。 */
async function relocate_session_directory(source_path, target_path) {
  if (source_path === target_path) return;
  if (await path_exists(target_path)) throw new Error(`Session 目标目录已经存在：${target_path}`);
  await fs.mkdir(path.dirname(target_path), { recursive: true, mode: 0o700 });
  await fs.rename(source_path, target_path);
}

/** 成功后删除旧 canonical 文件；附件目录不受影响。 */
async function remove_legacy_files(session_path) {
  await Promise.all([
    fs.rm(path.join(session_path, "meta.json"), { force: true }),
    fs.rm(path.join(session_path, "meta.json.lock"), { force: true }),
    fs.rm(path.join(session_path, "instruction.md"), { force: true }),
    fs.rm(path.join(session_path, "messages"), { recursive: true, force: true }),
  ]);
}

/** 返回新标准 Session 目录。 */
function resolve_target_path(session, origin_type) {
  return path.join(
    session.agent_root_path,
    session.archived ? "archived-sessions" : "sessions",
    encode_path_segment(origin_type),
    encode_path_segment(session.session_id),
  );
}

/** 生成不包含用户消息正文的迁移报告。 */
function describe_session(session, target_path, status, message_count = 0) {
  return {
    agent_id: session.agent_id,
    session_id: session.session_id,
    archived: session.archived,
    source_path: session.source_path,
    target_path,
    message_count,
    status,
  };
}

/** 从最新消息提取列表预览。 */
function resolve_message_preview(message) {
  if (!message) return "";
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim();
  if (text) return text;
  if (message.role !== "agent") return "";
  const action = message.parts.find((part) => part.type === "action");
  if (action) return [action.title, action.description].filter(Boolean).join("\n");
  const error = message.parts.find((part) => part.type === "error");
  if (error) return String(error.message || "").trim();
  const tools = [...new Set(message.parts.filter((part) => part.type === "tool").map((part) => String(part.tool_name || "").trim()).filter(Boolean))];
  return tools.length > 0 ? `[tool] ${tools.join(", ")}` : "";
}

/** 规范化 Session 来源。 */
function normalize_origin(value, fallback_type) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...source, type: normalize_origin_type(source.type || fallback_type || "chat") };
}

/** 规范化来源类型。 */
function normalize_origin_type(value) {
  return normalize_optional_string(value) || "chat";
}

/** 规范化 Fork 来源。 */
function normalize_message_origin(value) {
  if (!value || typeof value !== "object") return undefined;
  const session_id = normalize_optional_string(value.session_id);
  const message_id = normalize_optional_string(value.message_id);
  if (!session_id || !message_id) return undefined;
  const turn_id = normalize_optional_string(value.turn_id);
  return { session_id, message_id, ...(turn_id ? { turn_id } : {}) };
}

/** 校验必要字符串。 */
function normalize_required_string(value, name) {
  const normalized = normalize_optional_string(value);
  if (!normalized) throw new Error(`Session ${name} 不能为空`);
  return normalized;
}

/** 规范化可选字符串。 */
function normalize_optional_string(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

/** 校验正整数。 */
function normalize_positive_integer(value, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw new Error(`${name} 必须是正整数`);
  return normalized;
}

/** 规范化时间戳。 */
function normalize_timestamp(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}

/** 读取 JSONL；可选允许文件不存在。 */
async function read_jsonl_file(file_path, optional = false) {
  let raw;
  try {
    raw = await fs.readFile(file_path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return raw.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch (error) {
      throw new Error(`无法解析 ${file_path}:${String(index + 1)}`, { cause: error });
    }
  });
}

/** 读取 JSON 文件；不存在时返回 fallback。 */
async function read_json_file(file_path, fallback) {
  try {
    return JSON.parse(await fs.readFile(file_path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`无法解析 ${file_path}`, { cause: error });
  }
}

/** 安全读取目录。 */
async function read_directory(directory_path) {
  return await fs.readdir(directory_path, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
}

/** 判断路径是否存在。 */
async function path_exists(file_path) {
  return await fs.stat(file_path).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

/** 判断路径是否为文件。 */
async function is_file(file_path) {
  return await fs.stat(file_path).then((value) => value.isFile()).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

/** 使用与 Runtime 相同的安全、可逆目录编码。 */
function encode_path_segment(input) {
  let encoded = [...Buffer.from(String(input), "utf8")].map((byte) =>
    (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte === 45 || byte === 95 || byte === 126
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  ).join("");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(encoded)) {
    encoded = `%${encoded.codePointAt(0).toString(16).toUpperCase().padStart(2, "0")}${encoded.slice(1)}`;
  }
  return encoded;
}

/** 恢复路径段。 */
function decode_path_segment(input) {
  try { return decodeURIComponent(input); } catch { return input; }
}
