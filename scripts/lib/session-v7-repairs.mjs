/**
 * Explicit, reviewed repairs for the offline Session v7 planner; never writes a database.
 *
 * A closed JSON manifest binds each decision to a relative database path, its complete
 * original logical fingerprint and exact message/Part row hashes. Sequence evidence is
 * a reviewed record of deleted Interaction rows and their identical nested Tool payloads.
 * No policy discovers or approves additional repairs. Unknown, repeated, stale or unused
 * entries fail closed. Raw original history remains in the mandatory consistency backup.
 */
import fs from "node:fs";
import { digest, fail, group_parts_by_message } from "./session-v7-database.mjs";

/** Require an exact object shape, including all required fields and no extension keys. */
function exact_keys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail("invalid_repair_manifest_fields");
}

/** Validate hashes and identities without normalizing user-supplied values. */
function hash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail("invalid_repair_hash"); }
function identity(value) { if (typeof value !== "string" || !value || value.includes("\u0000")) fail("invalid_repair_identity"); }
function sequence(value) { if (!Number.isSafeInteger(value) || value < 1) fail("invalid_repair_sequence"); }
function nonempty_array(value) { if (!Array.isArray(value) || !value.length) fail("empty_repair_entries"); }

/** Part references bind every persisted field through a full logical row hash. */
function validate_part_reference(part) {
  exact_keys(part, ["part_id", "row_sha256"]);
  identity(part.part_id);
  hash(part.row_sha256);
}

/** Parse a closed manifest before any source database is opened. No local IDs live here. */
export function load_repair_manifest(file_path) {
  if (!file_path) return new Map();
  const stat = fs.lstatSync(file_path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) fail("repair_manifest_requires_private_regular_file");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file_path, "utf8")); }
  catch { fail("invalid_repair_manifest_json"); }
  exact_keys(manifest, ["format_version", "databases"]);
  if (manifest.format_version !== 1) fail("unsupported_repair_manifest_version");
  nonempty_array(manifest.databases);
  const entries = new Map();
  for (const entry of manifest.databases) {
    exact_keys(entry, ["database_path", "source_fingerprint", "operations"]);
    if (typeof entry.database_path !== "string"
      || !/^agents\/[^/\\\u0000]+\/(sessions|archived-sessions)\/[^/\\\u0000]+\/[^/\\\u0000]+\/session\.db$/u.test(entry.database_path)
      || entry.database_path.split("/").some(segment => segment.startsWith("."))) fail("invalid_repair_database_path");
    if (entries.has(entry.database_path)) fail("duplicate_repair_database");
    hash(entry.source_fingerprint);
    nonempty_array(entry.operations);
    const targets = new Set();
    for (const operation of entry.operations) {
      const kind = operation?.kind;
      const fields = kind === "renumber_parts" ? ["kind", "message_id", "row_sha256", "parts", "evidence"]
        : kind === "remove_media_delivery" ? ["kind", "message_id", "part_id", "row_sha256"]
          : kind === "historical_inbox" ? ["kind", "message_id", "row_sha256", "parts", "background_tag"] : null;
      if (!fields) fail("unknown_repair_operation");
      exact_keys(operation, fields);
      identity(operation.message_id);
      hash(operation.row_sha256);
      const target = `${kind}\u0000${kind === "remove_media_delivery" ? operation.part_id : operation.message_id}`;
      if (targets.has(target)) fail("duplicate_repair_operation");
      targets.add(target);
      if (kind === "remove_media_delivery") identity(operation.part_id);
      else {
        nonempty_array(operation.parts);
        const part_ids = new Set();
        for (const part of operation.parts) {
          if (kind === "historical_inbox") validate_part_reference(part);
          else {
            exact_keys(part, ["part_id", "row_sha256", "source_sequence", "target_sequence"]);
            identity(part.part_id);
            hash(part.row_sha256);
            sequence(part.source_sequence);
            sequence(part.target_sequence);
          }
          if (part_ids.has(part.part_id)) fail("duplicate_repair_part");
          part_ids.add(part.part_id);
        }
        if (kind === "historical_inbox") {
          if (!["delegation_result", "task_result"].includes(operation.background_tag)) fail("unsupported_repair_background_tag");
        } else {
          exact_keys(operation.evidence, ["backup_fingerprint", "missing_interactions"]);
          hash(operation.evidence.backup_fingerprint);
          nonempty_array(operation.evidence.missing_interactions);
          const legacy_ids = new Set();
          const positions = new Set();
          for (const item of operation.evidence.missing_interactions) {
            exact_keys(item, ["source_sequence", "legacy_part_id", "legacy_row_sha256", "tool_part_id", "interaction_index", "payload_sha256"]);
            sequence(item.source_sequence);
            identity(item.legacy_part_id);
            hash(item.legacy_row_sha256);
            identity(item.tool_part_id);
            hash(item.payload_sha256);
            if (!Number.isSafeInteger(item.interaction_index) || item.interaction_index < 0) fail("invalid_repair_interaction_index");
            if (legacy_ids.has(item.legacy_part_id) || positions.has(item.source_sequence)) fail("duplicate_repair_evidence");
            legacy_ids.add(item.legacy_part_id);
            positions.add(item.source_sequence);
          }
        }
      }
    }
    entries.set(entry.database_path, entry);
  }
  return entries;
}

/** Require the complete ordered Part set, so omissions and unconsumed references block. */
function match_parts(parts, references) {
  if (parts.length !== references.length || parts.some((part, index) => part.part_id !== references[index].part_id
    || digest(part) !== references[index].row_sha256)) fail("repair_part_identity_mismatch");
}

/** Apply only exact approved operations to a separate copy; preserve the source snapshot. */
export function repair_snapshot(source, entry) {
  if (!entry) return { snapshot: source, inbox_messages: new Set(), audit: [] };
  if (source.version === 7) fail("repairs_require_legacy_database");
  if (source.fingerprint !== entry.source_fingerprint) fail("repair_source_fingerprint_mismatch");
  const snapshot = structuredClone(source);
  const grouped = group_parts_by_message(snapshot.tables.message_parts);
  const messages = new Map(source.tables.messages.map(row => [row.message_id, row]));
  const source_parts = new Map(source.tables.message_parts.map(row => [row.part_id, row]));
  const inbox_messages = new Set();
  const audit = [];
  for (const operation of entry.operations) {
    const message = messages.get(operation.message_id);
    if (!message) fail("repair_message_not_found");
    const parts = grouped.get(message.message_id) ?? [];
    const record = { kind: operation.kind, message_id: message.message_id, source_message_sha256: digest(message), source_sequence: message.sequence };
    if (operation.kind === "remove_media_delivery") {
      const part = parts.find(row => row.part_id === operation.part_id);
      const original = source_parts.get(operation.part_id);
      if (!part || digest(original) !== operation.row_sha256) fail("repair_part_identity_mismatch");
      const content = JSON.parse(part.content);
      if (part.type !== "file" || content.media_delivery !== "tool" || typeof content.media_version !== "string") fail("repair_media_precondition_failed");
      delete content.media_delivery;
      part.content = JSON.stringify(content);
      Object.assign(record, { part_id: part.part_id, source_part_sha256: digest(original), source_part_sequence: original.sequence, removed_fields: { media_delivery: "tool" }, target_content_sha256: digest(content) });
    } else {
      if (digest(message) !== operation.row_sha256) fail("repair_message_identity_mismatch");
      // Compare original rows even when another approved operation touches the same Part.
      match_parts(parts.map(part => source_parts.get(part.part_id)), operation.parts);
      if (operation.kind === "renumber_parts") {
        if (message.role !== "agent" || parts.every((part, index) => part.sequence === index + 1)) fail("repair_sequence_precondition_failed");
        const occupied = new Set(parts.map(part => part.sequence));
        const evidence = operation.evidence.missing_interactions;
        const maximum = Math.max(...parts.map(part => part.sequence));
        if (occupied.size !== parts.length || parts.some(part => !Number.isSafeInteger(part.sequence) || part.sequence < 1)
          || evidence.length !== maximum - parts.length) fail("repair_sequence_evidence_mismatch");
        for (const item of evidence) {
          const tool = parts.find(part => part.part_id === item.tool_part_id && part.type === "tool");
          const interaction = tool && JSON.parse(tool.content).interactions?.[item.interaction_index];
          if (occupied.has(item.source_sequence) || item.source_sequence > maximum || source_parts.has(item.legacy_part_id)
            || !interaction || digest(interaction) !== item.payload_sha256) fail("repair_sequence_evidence_mismatch");
        }
        for (const [index, part] of parts.entries()) {
          const reference = operation.parts[index];
          if (reference.source_sequence !== part.sequence || reference.target_sequence !== index + 1) fail("repair_sequence_mapping_mismatch");
          part.sequence = reference.target_sequence;
        }
        Object.assign(record, { part_mapping: operation.parts, evidence: operation.evidence });
      } else {
        if (message.role !== "user" || message.visibility !== "visible" || message.meta !== null || message.state !== null
          || message.origin_session_id !== null || message.origin_message_id !== null || message.origin_turn_id !== null
          || !parts.some(part => part.type === "context" && JSON.parse(part.content).tag === operation.background_tag)) fail("repair_inbox_precondition_failed");
        inbox_messages.add(message.message_id);
        Object.assign(record, { original_envelope: message, parts: operation.parts, background_tag: operation.background_tag, target: "historical_inbox_without_meta" });
      }
    }
    audit.push(record);
  }
  return { snapshot, inbox_messages, audit };
}
