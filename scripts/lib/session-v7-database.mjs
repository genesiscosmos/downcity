/**
 * SQLite snapshot, constraint reconstruction and atomic v7 import for the offline tool.
 *
 * Logical hashes include schema, every table and every row (including derived data), so
 * backup/work/source comparisons detect concurrent changes without checkpointing source
 * WAL. All transformations, constraints and user_version commit in one database transaction.
 * Errors crossing the CLI boundary use fixed codes: SQLite/codec errors may contain input.
 */
import { createHash as create_hash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const canonical_tables = ["session_state", "session_model_binding", "session_execution_profile", "messages", "message_parts"];
export const derived_tables = ["composer_adaptive_part_checkpoints", "composer_sequence_summaries"];

/** A fixed-code diagnostic; never attach message bodies or raw parser/SQL errors. */
export function fail(code) { const error = new Error(code); error.migration_code = code; throw error; }

/** Quote an SQLite identifier obtained from sqlite_master, never concatenate it unquoted. */
export function quote_identifier(value) { return `"${value.replaceAll('"', '""')}"`; }

/** Stable serialization for fingerprints, independent of object key insertion order. */
export function canonical_json(value) {
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical_json(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Hash logical contents rather than the mutable SQLite page layout. */
export function digest(value) { return create_hash("sha256").update(canonical_json(value)).digest("hex"); }

/** Keep source connections read-only; do not checkpoint, recover or set journal_mode. */
export function open_readonly(database_path) {
  const database = new DatabaseSync(database_path, { readOnly: true });
  database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 0;");
  return database;
}

/** Reject SQLite structural corruption and dangling foreign keys before reading content. */
export function check_integrity(database) {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") fail("integrity_check_failed");
  if (database.prepare("PRAGMA foreign_key_check").all().length) fail("foreign_key_check_failed");
}

/** Read a coherent logical snapshot inside the caller's read or write transaction. */
export function read_snapshot(database) {
  check_integrity(database);
  const version = Number(database.prepare("PRAGMA user_version").get().user_version);
  const schema = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const tables = {};
  const columns = {};
  for (const item of schema.filter(item => item.type === "table")) {
    const name = quote_identifier(item.name);
    columns[item.name] = database.prepare(`PRAGMA table_info(${name})`).all();
    const primary_columns = columns[item.name].filter(column => column.pk > 0).sort((left, right) => left.pk - right.pk);
    const keyed_rows = database.prepare(`SELECT * FROM ${name}`).all().map(row => ({
      row,
      key: canonical_json(primary_columns.length ? primary_columns.map(column => row[column.name]) : row),
    }));
    tables[item.name] = keyed_rows.sort((left, right) => left.key.localeCompare(right.key)).map(item => item.row);
  }
  const snapshot = { version, schema, columns, tables };
  return { ...snapshot, fingerprint: digest(snapshot) };
}

/** Read-only transaction prevents version/envelope/Parts being read at different moments. */
export function snapshot_file(database_path) {
  const database = open_readonly(database_path);
  try {
    database.exec("BEGIN;");
    return read_snapshot(database);
  } finally { database.close(); }
}

/** Produce a trusted empty v7 schema descriptor from the checked-out runtime. */
export function target_descriptor(runtime) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(runtime.SESSION_STORAGE_SCHEMA_SQL);
    return read_snapshot(database);
  } finally { database.close(); }
}

/** Validate exact column sets and SQL affinity/PK; optional v5/v6 tables may be absent. */
export function validate_source_structure(snapshot, expected) {
  if (![5, 6, 7].includes(snapshot.version)) fail("unsupported_schema_version");
  for (const table of canonical_tables) {
    const actual = snapshot.columns[table];
    if (!actual && ["session_model_binding", "session_execution_profile"].includes(table) && snapshot.version < 7) {
      if (table === "session_execution_profile" && snapshot.version === 6) fail("missing_execution_profile_table");
      continue;
    }
    if (!actual) fail("missing_canonical_table");
    let wanted = expected.columns[table];
    if (table === "messages" && snapshot.version < 7) {
      wanted = wanted.filter(column => column.name !== "stable_part_sequence");
      wanted = [...wanted, { name: "visibility", type: "TEXT", pk: 0 }];
    }
    const signature = columns => columns.map(column => [column.name, column.type.toUpperCase(), column.pk]).sort();
    if (canonical_json(signature(actual)) !== canonical_json(signature(wanted))) fail("unexpected_canonical_columns");
  }
  const known_objects = new Set([...expected.schema.map(item => item.name), "messages_visibility_sequence_index", ...derived_tables]);
  for (const item of snapshot.schema) {
    if (!known_objects.has(item.name)) fail("unknown_schema_object");
    if (item.type === "table" && !canonical_tables.includes(item.name) && !derived_tables.includes(item.name)) fail("unknown_table");
  }
  if (snapshot.tables.session_state.length !== 1) fail("session_identity_not_unique");
}

/** Index Part references once; histories with large Tool results must not be repeatedly scanned. */
export function group_parts_by_message(parts) {
  const grouped = new Map();
  for (const part of parts) {
    const group = grouped.get(part.message_id) ?? [];
    group.push(part);
    grouped.set(part.message_id, group);
  }
  for (const group of grouped.values()) group.sort((left, right) => left.sequence - right.sequence);
  return grouped;
}

/** Require canonical target DDL, not merely a user_version claiming to be v7. */
export function validate_target(database, runtime, expected, staged = false) {
  const snapshot = read_snapshot(database);
  if (!staged && snapshot.version !== 7) fail("target_version_mismatch");
  validate_source_structure({ ...snapshot, version: 7 }, expected);
  const normalize = sql => sql.replace(/\bIF NOT EXISTS\b/gi, "").replace(/\s+/g, " ").trim();
  for (const item of expected.schema) {
    const actual = snapshot.schema.find(candidate => candidate.name === item.name && candidate.type === item.type);
    if (!actual || normalize(actual.sql) !== normalize(item.sql)) fail("target_schema_definition_mismatch");
  }
  const state = snapshot.tables.session_state[0];
  const messages = snapshot.tables.messages.sort((left, right) => left.sequence - right.sequence);
  const decoded = [];
  const inbox_ids = new Set();
  const grouped_parts = group_parts_by_message(snapshot.tables.message_parts);
  for (const row of messages) {
    if (typeof row.message_id !== "string" || !row.message_id || !Number.isSafeInteger(row.sequence) || row.sequence < 1) fail("invalid_message_identity");
    const parts = grouped_parts.get(row.message_id) ?? [];
    if (parts.some(part => typeof part.part_id !== "string" || !part.part_id)) fail("invalid_part_identity");
    if (parts.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_part_sequence");
    let message;
    try { message = runtime.decode_session_message(row, parts, state.session_id); }
    catch { fail("target_codec_rejected_content"); }
    if (message.role === "agent") {
      const ceiling = runtime.resolve_stable_part_sequence(message.parts, 0);
      if (message.stable_part_sequence > ceiling) fail("stable_prefix_crosses_step_boundary");
      for (const part of message.parts.filter(part => part.type === "inbox")) {
        if (inbox_ids.has(part.inbox_id)) fail("duplicate_inbox_id");
        inbox_ids.add(part.inbox_id);
      }
    }
    decoded.push(message);
  }
  if (state.message_count !== messages.length) fail("message_count_mismatch");
  return decoded;
}

/** Insert full row objects with bound parameters, keeping JSON bytes and timestamps intact. */
function insert_rows(database, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const insert = database.prepare(`INSERT INTO ${quote_identifier(table)} (${columns.map(quote_identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  for (const row of rows) insert.run(...columns.map(column => row[column]));
}

/**
 * Reconstruct all canonical constraints in one transaction. Source rows remain in JS memory;
 * no renamed legacy table or old trigger can redirect foreign keys. Known composer tables
 * are dropped; unknown tables/views/triggers have already blocked planning.
 */
export function import_plan(database, plan, runtime, expected) {
  database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
  try {
    if (read_snapshot(database).fingerprint !== plan.source_fingerprint) fail("source_changed_since_preflight");
    for (const table of [...derived_tables, "message_parts", "messages", "session_model_binding", "session_execution_profile", "session_state"]) {
      database.exec(`DROP TABLE IF EXISTS ${quote_identifier(table)};`);
    }
    database.exec(runtime.SESSION_STORAGE_SCHEMA_SQL);
    for (const table of ["session_state", "session_model_binding", "session_execution_profile", "messages", "message_parts"]) {
      insert_rows(database, table, plan.tables[table]);
    }
    const advance = database.prepare("UPDATE messages SET stable_part_sequence = ? WHERE message_id = ?");
    for (const [message_id, watermark] of plan.watermarks) advance.run(watermark, message_id);
    validate_target(database, runtime, expected, true);
    database.exec("PRAGMA user_version = 7;");
    if (Number(database.prepare("PRAGMA user_version").get().user_version) !== 7) fail("version_write_failed");
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/** Validate a proposed import in an ephemeral database without touching source or disk. */
export function validate_plan(plan, runtime, expected) {
  const database = new DatabaseSync(":memory:");
  try {
    // Source tables are serialized by name, not foreign-key dependency order.
    database.exec("PRAGMA foreign_keys = OFF;");
    // Rehydrate only the source schema and rows for the exact same transaction path.
    for (const item of plan.source.schema.filter(item => item.type === "table")) database.exec(item.sql);
    for (const [table, rows] of Object.entries(plan.source.tables)) insert_rows(database, table, rows);
    for (const item of plan.source.schema.filter(item => item.type !== "table")) database.exec(item.sql);
    database.exec(`PRAGMA user_version = ${plan.source.version};`);
    import_plan(database, plan, runtime, expected);
  } finally { database.close(); }
}
